import os
import json
import faiss
import numpy as np
from pathlib import Path
from sentence_transformers import SentenceTransformer

FAISS_INDEX_PATH = "data/processed/faiss_index.bin"
CHUNK_METADATA_PATH = "data/processed/chunk_metadata.json"
EMBEDDING_MODEL_NAME = "BAAI/bge-base-en-v1.5"

# Module-level caches
_model = None
_index = None
_metadata = None


def get_embedding_model() -> SentenceTransformer:
    """Lazy-load the BAAI/bge-base-en-v1.5 model once."""
    global _model
    if _model is None:
        print(f"[RETRIEVAL] Loading embedding model: {EMBEDDING_MODEL_NAME}...")
        _model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    return _model


def build_and_save_faiss_index(embeddings_path: str = "data/processed/embeddings.npy"):
    """Build a FAISS IndexFlatIP from embeddings.npy and save to disk."""
    if not os.path.exists(embeddings_path):
        raise FileNotFoundError(f"{embeddings_path} not found! Run src/embed.py first.")
        
    embeddings = np.load(embeddings_path).astype(np.float32)
    num_vectors, dim = embeddings.shape
    
    print(f"[FAISS] Building IndexFlatIP for {num_vectors} vectors (dim={dim})...")
    
    # IndexFlatIP = Inner Product search (equivalent to Cosine Sim for normalized vectors)
    index = faiss.IndexFlatIP(dim)
    index.add(embeddings)
    
    Path(os.path.dirname(FAISS_INDEX_PATH)).mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, FAISS_INDEX_PATH)
    print(f"[FAISS] Saved index to {FAISS_INDEX_PATH} (total vectors: {index.ntotal})")
    return index


def get_index_and_metadata() -> tuple[faiss.Index, list[dict]]:
    """Lazy-load FAISS index and chunk metadata."""
    global _index, _metadata
    if _index is None:
        if not os.path.exists(FAISS_INDEX_PATH):
            build_and_save_faiss_index()
        _index = faiss.read_index(FAISS_INDEX_PATH)
        print(f"[RETRIEVAL] Loaded FAISS index ({_index.ntotal} vectors)")
        
    if _metadata is None:
        with open(CHUNK_METADATA_PATH, "r", encoding="utf-8") as f:
            _metadata = json.load(f)
            
    return _index, _metadata


def retrieve(query: str, k: int = 5, min_similarity: float = 0.35) -> list[dict]:
    """
    Retrieve top-k relevant chunks for a user query.
    
    Args:
        query: User question string
        k: Number of chunks to retrieve
        min_similarity: Threshold to discard noise (default 0.35)
        
    Returns:
        List of chunk dicts sorted by similarity score
    """
    model = get_embedding_model()
    index, metadata = get_index_and_metadata()
    
    # BGE models recommend query instruction for optimal retrieval
    # (BGE recommendation: "Represent this sentence for searching relevant passages: ")
    query_text = f"Represent this sentence for searching relevant passages: {query.strip()}"
    
    # Encode query to 768-dim vector
    query_vector = model.encode([query_text], normalize_embeddings=True).astype(np.float32)
    
    # Search FAISS index
    similarities, indices = index.search(query_vector, k)
    
    results = []
    for similarity, idx in zip(similarities[0], indices[0]):
        if idx == -1 or similarity < min_similarity:
            continue
            
        chunk_info = metadata[idx].copy()
        chunk_info["similarity_score"] = float(similarity)
        results.append(chunk_info)
        
    return results


if __name__ == "__main__":
    print("=== Building & Testing FAISS Index ===")
    build_and_save_faiss_index()
    
    test_query = "What documents do I need for a German student visa from India?"
    print(f"\n[TEST QUERY] '{test_query}'")
    matches = retrieve(test_query, k=3)
    
    for i, match in enumerate(matches, 1):
        print(f"\n--- Match {i} (Score: {match['similarity_score']:.4f}) ---")
        print(f"Source: {match['source_name']} ({match['source_id']})")
        print(f"URL: {match['source_url']}")
        print(f"Text Snippet: {match['text'][:150]}...")