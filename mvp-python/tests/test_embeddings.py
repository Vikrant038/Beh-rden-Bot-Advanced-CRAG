"""
Embedding Model Sanity & Semantic Ranking Unit Tests (test_embeddings.py)
Follows AGENTS.md (MVP conventions) and docs/basic-prompt/CODING_STANDARDS.md.
"""

import os
import sys
import pytest
import numpy as np
from typing import List
from sklearn.metrics.pairwise import cosine_similarity

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.embed import load_embedding_model
from src.logging_config import logger
from src.tracing import observe


@observe(name="test_semantic_similarity", as_type="evaluator")
def test_semantic_similarity() -> None:
    """Verify vector similarity ranking using local sentence-transformers model."""
    logger.info("[TEST] Loading local embedding model...")
    model = load_embedding_model()
    
    sentences: List[str] = [
        "What documents do I need for a German student visa?",          # Query (Index 0)
        "Required papers for studying in Germany as an international",   # High similarity
        "How to apply for APS certificate from India",                   # Medium similarity
        "The best recipe for authentic Italian pizza",                  # Unrelated
    ]
    
    embeddings = model.encode(sentences, normalize_embeddings=True)
    query_vector = embeddings[0].reshape(1, -1)
    
    labels: List[str] = ["[QUERY]", "[HIGH SIMILARITY]", "[MEDIUM SIMILARITY]", "[UNRELATED]"]
    sims: List[float] = []
    
    for label, emb in zip(labels, embeddings):
        sim: float = float(cosine_similarity(query_vector, emb.reshape(1, -1))[0][0])
        sims.append(sim)
        logger.info(f"  {label:<20}: {sim:.4f}")
        
    assert sims[1] > sims[2] > sims[3], "Vector ranking failed — check model"
    assert embeddings.shape[1] in [384, 768, 1024], f"Unexpected embedding dimension: {embeddings.shape[1]}"
    logger.info(f" ✅ Similarity test passed successfully! Embedding dimension: {embeddings.shape[1]}")


if __name__ == "__main__":
    test_semantic_similarity()