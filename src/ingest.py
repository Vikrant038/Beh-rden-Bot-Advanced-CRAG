import trafilatura
import pdfplumber
import json
import os
from pathlib import Path
from langchain_text_splitters import RecursiveCharacterTextSplitter
from src.utils import ChunkModel, clean_text

def chunk_text(
    text: str,
    source_id: str,
    source_name: str,
    source_url: str,
    chunk_size: int = 600,
    chunk_overlap: int = 150
) -> list[dict]:
    """Split text into overlapping chunks and validate with Pydantic."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", ". ", "! ", "? ", " ", ""]
    )
    
    raw_chunks = splitter.split_text(text)
    
    validated_chunks = []
    for i, chunk_str in enumerate(raw_chunks):
        if len(chunk_str.strip()) < 100:  # Skip noise
            continue
            
        try:
            # Pydantic validation step!
            chunk_obj = ChunkModel(
                text=chunk_str,
                source_id=source_id,
                source_name=source_name,
                source_url=source_url,
                chunk_index=i,
                char_count=len(chunk_str)
            )
            # Dump to dict for JSON serialization
            validated_chunks.append(chunk_obj.model_dump())
        except Exception as e:
            print(f"[WARN] Chunk validation failed for {source_id} index {i}: {e}")
            
    return validated_chunks

def process_all_chunks(
    sources_file: str = "data/sources.json",
    raw_dir: str = "data/raw",
    output_file: str = "data/processed/all_chunks.json"
):
    """Clean and chunk all raw .txt files into a single processed JSON file."""
    with open(sources_file, "r", encoding="utf-8") as f:
        sources = json.load(f)
        
    Path("data/processed").mkdir(parents=True, exist_ok=True)
    all_chunks = []
    
    for source in sources:
        source_id = source["id"]
        txt_path = os.path.join(raw_dir, f"{source_id}.txt")
        
        if not os.path.exists(txt_path):
            print(f"[SKIP] No txt file for {source_id}")
            continue
            
        with open(txt_path, "r", encoding="utf-8") as f:
            raw_text = f.read()
            
        cleaned = clean_text(raw_text)
        chunks = chunk_text(
            text=cleaned,
            source_id=source_id,
            source_name=source["name"],
            source_url=source["url"]
        )
        all_chunks.extend(chunks)
        print(f"[CHUNKED] {source_id}: {len(chunks)} chunks created")
        
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(all_chunks, f, ensure_ascii=False, indent=2)
        
    print(f"\n✅ Total Chunks Generated: {len(all_chunks)} -> saved to {output_file}")

def scrape_web_page(url: str, source_id: str) -> str | None:
    """Scrape clean article text from a Web URL using trafilatura."""
    try:
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            print(f"[WARN] Could not fetch {url}")
            return None
        
        text = trafilatura.extract(
            downloaded,
            include_comments=False,
            include_tables=True,
            no_fallback=False
        )
        
        if not text or len(text) < 200:
            print(f"[WARN] Extracted text too short from {url}: {len(text) if text else 0} chars")
            return None
        
        print(f"[OK] Scraped {source_id}: {len(text)} characters")
        return text
    
    except Exception as e:
        print(f"[ERROR] Failed to scrape {url}: {e}")
        return None


def extract_text_from_pdf(pdf_path: str, source_id: str) -> str | None:
    """Extract text from a local PDF using pdfplumber."""
    try:
        with pdfplumber.open(pdf_path) as pdf:
            full_text = ""
            for page_num, page in enumerate(pdf.pages):
                page_text = page.extract_text()
                if page_text:
                    full_text += f"\n--- Page {page_num + 1} ---\n"
                    full_text += page_text
            
            if len(full_text.strip()) < 100:
                print(f"[WARN] {source_id}: Extracted text too short — likely scanned PDF. Discarding.")
                return None
            
            print(f"[OK] Extracted PDF {source_id}: {len(full_text)} characters across {len(pdf.pages)} pages")
            return full_text
    except Exception as e:
        print(f"[ERROR] Failed to extract PDF {pdf_path}: {e}")
        return None


def save_raw_text(text: str, source_id: str, raw_dir: str = "data/raw") -> str:
    """Save extracted text to a .txt file. Returns the file path."""
    Path(raw_dir).mkdir(parents=True, exist_ok=True)
    filepath = os.path.join(raw_dir, f"{source_id}.txt")
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(text)
    return filepath


def process_all_registered_sources(sources_file: str = "data/sources.json", raw_dir: str = "data/raw"):
    """Process all web + pdf sources listed in sources.json into data/raw/<id>.txt"""
    with open(sources_file, "r", encoding="utf-8") as f:
        sources = json.load(f)
    
    results = {}
    for source in sources:
        source_id = source["id"]
        source_type = source["type"]
        
        print(f"\nProcessing [{source_id}] ({source_type}): {source['name']}...")
        text = None
        
        if source_type == "web":
            text = scrape_web_page(source["url"], source_id)
        elif source_type == "pdf":
            filename = source.get("filename")
            pdf_path = os.path.join(raw_dir, filename) if filename else None
            if pdf_path and os.path.exists(pdf_path):
                text = extract_text_from_pdf(pdf_path, source_id)
            else:
                print(f"[WARN] Local PDF file not found at: {pdf_path}")
        
        if text:
            filepath = save_raw_text(text, source_id, raw_dir)
            results[source_id] = {"status": "ok", "path": filepath, "chars": len(text)}
        else:
            results[source_id] = {"status": "failed", "path": None}
    
    ok = sum(1 for r in results.values() if r["status"] == "ok")
    print(f"\n==================================================")
    print(f"=== Ingestion Complete: {ok}/{len(results)} sources extracted ===")
    print(f"==================================================")
    return results



if __name__ == "__main__":
    process_all_registered_sources()
    process_all_chunks()