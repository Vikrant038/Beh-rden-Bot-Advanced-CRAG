import json
import numpy as np
from pathlib import Path
from sentence_transformers import SentenceTransformer

EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"
EMBEDDING_DIM = 768

def load_embedding_model() -> SentenceTransformer:
    """Load local sentence-transformers model."""
    print(f"[EMBED] Loading model: {EMBEDDING_MODEL}...")
    return SentenceTransformer(EMBEDDING_MODEL)

def embed_chunks(chunks: list[dict], model: SentenceTransformer, batch_size: int = 64) -> np.ndarray:
    """Encode all text chunks into a 2D numpy array of shape (num_chunks, 384)."""
    texts = [chunk["text"] for chunk in chunks]
    print(f"[EMBED] Encoding {len(texts)} text chunks in batches of {batch_size}...")
    
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=True,
        normalize_embeddings=True
    )
    return embeddings

def save_embeddings(embeddings: np.ndarray, chunks: list[dict], output_dir: str = "data/processed"):
    """Save vector embeddings as .npy and chunk metadata as JSON."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    emb_path = Path(output_dir) / "embeddings.npy"
    meta_path = Path(output_dir) / "chunk_metadata.json"
    
    # Save 2D vector numpy array
    np.save(emb_path, embeddings)
    
    # Save chunk metadata linked by array index
    metadata = [
        {
            "global_index": i,
            "source_id": c["source_id"],
            "source_name": c["source_name"],
            "source_url": c["source_url"],
            "chunk_index": c["chunk_index"],
            "char_count": c["char_count"],
            "text": c["text"]
        }
        for i, c in enumerate(chunks)
    ]
    
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
        
    print(f"[OK] Saved vector embeddings → {emb_path} (Shape: {embeddings.shape})")
    print(f"[OK] Saved chunk metadata  → {meta_path}")

def run_embedding_pipeline():
    chunks_path = Path("data/processed/all_chunks.json")
    if not chunks_path.exists():
        raise FileNotFoundError("data/processed/all_chunks.json not found.")
        
    with open(chunks_path, "r", encoding="utf-8") as f:
        chunks = json.load(f)
        
    model = load_embedding_model()
    embeddings = embed_chunks(chunks, model)
    save_embeddings(embeddings, chunks)
    print("\n✅ Embedding Pipeline Completed Successfully!")

if __name__ == "__main__":
    run_embedding_pipeline()