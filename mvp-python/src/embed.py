"""
768-d Vector Embedding Pipeline (Disk + PostgreSQL pgvector Dual-Sync)
Follows AGENTS.md (MVP conventions) and docs/basic-prompt/CODING_STANDARDS.md.
"""

import os
import json
import asyncio
import numpy as np
from pathlib import Path
from typing import List, Dict, Optional
from sentence_transformers import SentenceTransformer

from src.logging_config import logger
from src.utils import get_data_dir, get_project_root
from src.errors import NotFoundError

FINE_TUNED_MODEL_PATH = os.path.join(get_project_root(), "models", "bge_base_german_visa_finetuned")
# Default to BGE-M3 (1024-d) to match production: the web-app persists
# document_chunks as vector(1024) and retrieval.py queries a 1024-d FAISS index.
# The legacy 768-d fine-tuned model remains selectable via EMBEDDING_MODEL.
DEFAULT_MODEL = "BAAI/bge-m3"
EMBEDDING_DIM = 1024


def load_embedding_model() -> SentenceTransformer:
    """Load the embedding model — BGE-M3 (1024-d) by default, or a legacy
    model when EMBEDDING_MODEL is set explicitly. The legacy 768-d fine-tuned
    model is NOT auto-selected anymore: production persists vector(1024), so a
    freshly built embed must land in the same 1024-d space as retrieval."""
    model_name = os.environ.get("EMBEDDING_MODEL") or DEFAULT_MODEL
    logger.info(f"[EMBED] Loading embedding model from: {model_name}...")
    return SentenceTransformer(model_name)


def embed_chunks(chunks: List[dict], model: SentenceTransformer, batch_size: int = 64) -> np.ndarray:
    """Encode all text chunks into a 2D numpy array of shape (num_chunks, 768)."""
    texts = [chunk["text"] for chunk in chunks]
    logger.info(f"[EMBED] Encoding {len(texts)} text chunks in batches of {batch_size}...")
    
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=True,
        normalize_embeddings=True
    )
    return embeddings


def save_embeddings_to_disk(embeddings: np.ndarray, chunks: List[dict], output_dir: Optional[str] = None):
    """Save vector embeddings as .npy and chunk metadata as JSON for disk/FAISS fallback."""
    if output_dir is None:
        output_dir = os.path.join(get_data_dir(), "processed")
        
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    
    emb_path = Path(output_dir) / "embeddings.npy"
    meta_path = Path(output_dir) / "chunk_metadata.json"
    
    np.save(emb_path, embeddings)
    
    metadata = [
        {
            "global_index": i,
            "source_id": c.get("source_id", "unknown"),
            "source_name": c.get("source_name", "Unknown"),
            "source_url": c.get("source_url", ""),
            "chunk_index": c.get("chunk_index", i),
            "char_count": c.get("char_count", len(c.get("text", ""))),
            "text": c["text"]
        }
        for i, c in enumerate(chunks)
    ]
    
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
        
    logger.info(f"[OK] Saved vector embeddings → {emb_path} (Shape: {embeddings.shape})")
    logger.info(f"[OK] Saved chunk metadata  → {meta_path}")


async def save_embeddings_to_postgres(embeddings: np.ndarray, chunks: List[dict]):
    """Sync text chunks and 768d vector embeddings directly into PostgreSQL pgvector database."""
    try:
        from src.database import init_db, SessionLocal, DocumentChunk
        from sqlalchemy import delete
        
        await init_db()
        async with SessionLocal() as db:
            await db.execute(delete(DocumentChunk))
            
            objects = []
            for i, c in enumerate(chunks):
                vector = embeddings[i].tolist()
                obj = DocumentChunk(
                    source_name=c.get("source_name", "Unknown Source"),
                    source_url=c.get("source_url", ""),
                    text=c.get("text", ""),
                    embedding=vector
                )
                objects.append(obj)
                
            db.add_all(objects)
            await db.commit()
            logger.info(f"✅ [POSTGRES] Successfully stored {len(objects)} chunks into PostgreSQL pgvector database!")
    except Exception as e:
        logger.warning(f"[WARN] Postgres sync skipped or failed (check DB connection): {e}")


async def run_embedding_pipeline_async():
    chunks_path = Path(os.path.join(get_data_dir(), "processed", "all_chunks.json"))
    if not chunks_path.exists():
        raise NotFoundError(f"Chunks file missing: {chunks_path}. Run src/ingest.py first.")
        
    with open(chunks_path, "r", encoding="utf-8") as f:
        chunks = json.load(f)
        
    model = load_embedding_model()
    embeddings = embed_chunks(chunks, model)
    
    # 1. Save to disk (for FAISS compatibility)
    save_embeddings_to_disk(embeddings, chunks)
    
    # 2. Sync to PostgreSQL / pgvector database
    await save_embeddings_to_postgres(embeddings, chunks)
    
    logger.info("🎉 Embedding Pipeline Completed Successfully (Disk + PostgreSQL Dual-Sync)!")


def run_embedding_pipeline():
    asyncio.run(run_embedding_pipeline_async())


if __name__ == "__main__":
    run_embedding_pipeline()