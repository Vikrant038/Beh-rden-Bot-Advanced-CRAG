"""
FAISS Vector Search Retrieval Engine (BGE-M3 1024-d by default).

Defaults to BAAI/bge-m3 (1024-d) to match production — the web-app stores
document_chunks as vector(1024) and the corpus is exported to a 1024-d FAISS
index. A legacy 768-d fine-tuned model remains selectable via EMBEDDING_MODEL
for anyone still building a 768-d index; the query vector must match the index.
Complies with AGENTS.md §1 & §2, and CODING_STANDARDS.md.
"""

import os
import json
import faiss
import numpy as np
from typing import List, Dict, Tuple, Optional
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

from src.logging_config import logger
from src.utils import get_data_dir, get_project_root
from src.errors import NotFoundError

load_dotenv()

_EMBEDDING_MODEL: Optional[SentenceTransformer] = None
_FAISS_INDEX: Optional[faiss.Index] = None
_METADATA_CACHE: Optional[List[dict]] = None


def get_model_path() -> str:
    # Production truth is 1024-d BGE-M3: the web-app stores document_chunks as
    # vector(1024) and the eval exports the corpus to a 1024-d FAISS index
    # (scratch/export_corpus_to_faiss.py). The legacy 768-d fine-tuned model
    # (models/bge_base_german_visa_finetuned) is kept importable via
    # EMBEDDING_MODEL for anyone who still builds a 768-d index, but the query
    # vector MUST match the loaded index's dimension — so default to BGE-M3.
    override = os.environ.get("EMBEDDING_MODEL")
    if override:
        return override
    return "BAAI/bge-m3"


def get_embedding_model() -> SentenceTransformer:
    global _EMBEDDING_MODEL
    if _EMBEDDING_MODEL is None:
        path = get_model_path()
        logger.info(f"[RETRIEVAL] Loading embedding model from: {path}")
        _EMBEDDING_MODEL = SentenceTransformer(path)
    return _EMBEDDING_MODEL


def load_index_and_metadata() -> Tuple[faiss.Index, List[dict]]:
    data_dir = get_data_dir()
    index_path = os.path.join(data_dir, "processed", "faiss_index.bin")
    meta_path = os.path.join(data_dir, "processed", "chunk_metadata.json")
    
    if not os.path.exists(index_path) or not os.path.exists(meta_path):
        raise NotFoundError(f"FAISS index or metadata missing: {index_path}, {meta_path}. Run src/embed.py first.")

    index = faiss.read_index(index_path)
    with open(meta_path, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    logger.info(f"[RETRIEVAL] Loaded FAISS index ({index.ntotal} vectors, {index.d}d) and {len(metadata)} metadata items.")
    return index, metadata


def get_index_and_metadata() -> Tuple[faiss.Index, List[dict]]:
    global _FAISS_INDEX, _METADATA_CACHE
    if _FAISS_INDEX is None or _METADATA_CACHE is None:
        _FAISS_INDEX, _METADATA_CACHE = load_index_and_metadata()
    return _FAISS_INDEX, _METADATA_CACHE


def retrieve(query: str, k: int = 5, min_similarity: float = 0.20) -> List[dict]:
    """
    Retrieve top-k relevant chunks for a user query using fine-tuned model.
    """
    model = get_embedding_model()
    index, metadata = get_index_and_metadata()
    
    query_text = f"Represent this sentence for searching relevant passages: {query.strip()}"
    query_vector = model.encode([query_text], normalize_embeddings=True).astype(np.float32)
    
    similarities, indices = index.search(query_vector, k)
    
    results = []
    for similarity, idx in zip(similarities[0], indices[0]):
        if idx == -1 or similarity < min_similarity:
            continue
            
        chunk_info = metadata[idx].copy()
        chunk_info["similarity_score"] = float(similarity)
        results.append(chunk_info)
        
    return results

# Backward compatibility alias
dense_retrieve = retrieve


if __name__ == "__main__":
    test_q = "What is the blocked account requirement for German student visa?"
    res = retrieve(test_q, k=3)
    logger.info(f"Retrieved {len(res)} chunks for test query.")
    for r in res:
        logger.info(f"  • [{r.get('source_name')}] Score: {r.get('similarity_score'):.4f} - {r.get('text')[:60]}...")