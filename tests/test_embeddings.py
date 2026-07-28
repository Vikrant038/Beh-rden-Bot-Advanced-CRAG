from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

def test_semantic_similarity():
    """Verify vector similarity ranking using sentence-transformers."""
    print("[TEST] Loading local embedding model (all-MiniLM-L6-v2)...")
    model = SentenceTransformer("all-MiniLM-L6-v2")
    
    sentences = [
        "What documents do I need for a German student visa?",          # Query (Index 0)
        "Required papers for studying in Germany as an international",   # High similarity
        "How to apply for APS certificate from India",                   # Medium similarity
        "The best recipe for authentic Italian pizza",                  # Unrelated
    ]
    
    # Encode all 4 sentences into 384-dimensional vectors
    embeddings = model.encode(sentences, normalize_embeddings=True)
    
    query_vector = embeddings[0].reshape(1, -1)
    
    print("\n=== Cosine Similarity to Query ===")
    labels = ["[QUERY]", "[HIGH SIMILARITY]", "[MEDIUM SIMILARITY]", "[UNRELATED]"]
    
    sims = []
    for label, emb in zip(labels, embeddings):
        sim = cosine_similarity(query_vector, emb.reshape(1, -1))[0][0]
        sims.append(sim)
        print(f"  {label:<20}: {sim:.4f}")
        
    assert sims[1] > sims[2] > sims[3], "Vector ranking failed — check model"
    print("\n✅ Similarity test passed successfully!")
    print(f"   Embedding vector shape: {embeddings.shape}")

if __name__ == "__main__":
    test_semantic_similarity()