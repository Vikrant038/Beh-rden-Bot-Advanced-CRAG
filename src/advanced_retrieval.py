import os
import time
import json
import numpy as np
from pathlib import Path
from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder
from dotenv import load_dotenv

from src.retrieval import retrieve as dense_retrieve

load_dotenv()

_bm25_retriever = None
_cross_encoder = None


# ==========================================
# STAGE 0: QUERY DISAMBIGUATION DETECTOR
# ==========================================
def detect_query_ambiguity(user_query: str) -> dict:
    """
    Lightweight node to detect underspecified or vague queries.
    Returns {"is_ambiguous": True, "options": [...]} if ambiguous.
    """
    q_lower = user_query.strip().lower()
    words = q_lower.split()
    
    # Fast heuristic checks for vague short queries
    vague_phrases = [
        "when i move into germany",
        "when i move to germany",
        "moving to germany",
        "study in germany",
        "germany master"
    ]
    
    is_short_and_vague = any(vp in q_lower for vp in vague_phrases) or (len(words) <= 5 and not any(w in q_lower for w in ["how to", "what document", "how much", "where", "fee"]))
    
    if not is_short_and_vague:
        return {"is_ambiguous": False, "options": []}
        
    prompt = (
        f"The user typed a broad query: '{user_query}'\n"
        f"Generate 3 specific clarifying questions/options the user might mean regarding German study/visas.\n"
        f"Format output EXACTLY as 3 bullet points, nothing else:\n"
        f"- Option A\n"
        f"- Option B\n"
        f"- Option C"
    )
    
    try:
        from src.rag import call_llm
        messages = [{"role": "user", "content": prompt}]
        response_text = call_llm(messages, max_tokens=150, temperature=0.3)
        
        options = []
        for line in response_text.strip().split("\n"):
            cleaned = line.strip().lstrip("-*123456789. ")
            if cleaned and len(cleaned) > 10:
                options.append(cleaned)
                
        if len(options) >= 2:
            return {"is_ambiguous": True, "options": options[:3]}
    except Exception as e:
        print(f"[WARN] Disambiguation detector fallback: {e}")
        
    return {"is_ambiguous": False, "options": []}


# ==========================================
# STAGE 1: QUERY EXPANSION / MULTI-QUERY
# ==========================================
def generate_sub_queries(user_query: str, retry_count: int = 0) -> list[str]:
    sub_queries = [user_query]
    
    if retry_count == 0:
        prompt = (
            f"Generate 2 alternative ways to phrase this question for searching German visa & study docs. "
            f"Return ONLY 2 rephrased questions separated by newlines, nothing else.\n\n"
            f"Original Question: {user_query}"
        )
    else:
        prompt = (
            f"The previous search for '{user_query}' had low confidence. "
            f"Generate 2 broader search queries focusing on key German study/visa legal terms. "
            f"Return ONLY 2 rephrased questions separated by newlines, nothing else."
        )

    try:
        from src.rag import call_llm
        messages = [{"role": "user", "content": prompt}]
        response_text = call_llm(messages, max_tokens=100, temperature=0.4)
        
        lines = response_text.strip().split('\n')
        for line in lines:
            cleaned = line.strip().lstrip('123456789.-* ')
            if cleaned and len(cleaned) > 5 and cleaned not in sub_queries:
                sub_queries.append(cleaned)
                
    except Exception as e:
        print(f"[WARN] Query expansion fallback: {e}")
        
    return sub_queries[:3]


class BM25SearchEngine:
    def __init__(self, chunks_path: str = "data/processed/all_chunks.json"):
        with open(chunks_path, "r", encoding="utf-8") as f:
            self.chunks = json.load(f)
            
        tokenized_corpus = [chunk["text"].lower().split() for chunk in self.chunks]
        self.bm25 = BM25Okapi(tokenized_corpus)
        print(f"[BM25] Indexed {len(self.chunks)} text chunks for sparse keyword search.")
        
    def search(self, query: str, top_k: int = 15) -> list[dict]:
        tokenized_query = query.lower().split()
        scores = self.bm25.get_scores(tokenized_query)
        top_indices = np.argsort(scores)[::-1][:top_k]
        
        results = []
        for idx in top_indices:
            if scores[idx] <= 0:
                continue
            chunk_info = self.chunks[idx].copy()
            chunk_info["bm25_score"] = float(scores[idx])
            results.append(chunk_info)
            
        return results


def get_bm25_engine() -> BM25SearchEngine:
    global _bm25_retriever
    if _bm25_retriever is None:
        _bm25_retriever = BM25SearchEngine()
    return _bm25_retriever


def reciprocal_rank_fusion(retrieval_lists: list[list[dict]], k_rrf: int = 60) -> list[dict]:
    rrf_scores = {}
    
    for list_idx, chunk_list in enumerate(retrieval_lists):
        for rank, chunk in enumerate(chunk_list, start=1):
            chunk_key = (chunk["source_id"], chunk["chunk_index"])
            rrf_score = 1.0 / (k_rrf + rank)
            
            if chunk_key not in rrf_scores:
                rrf_scores[chunk_key] = {"rrf_score": rrf_score, "chunk": chunk}
            else:
                rrf_scores[chunk_key]["rrf_score"] += rrf_score
                
    sorted_items = sorted(rrf_scores.values(), key=lambda x: x["rrf_score"], reverse=True)
    
    fused_chunks = []
    for item in sorted_items:
        c = item["chunk"].copy()
        c["rrf_score"] = float(item["rrf_score"])
        fused_chunks.append(c)
        
    return fused_chunks


def get_cross_encoder() -> CrossEncoder:
    global _cross_encoder
    if _cross_encoder is None:
        print("[RE-RANKER] Loading Cross-Encoder (BAAI/bge-reranker-base)...")
        _cross_encoder = CrossEncoder("BAAI/bge-reranker-base")
    return _cross_encoder


def rerank_cross_encoder(query: str, candidate_chunks: list[dict], top_k: int = 5) -> list[dict]:
    if not candidate_chunks:
        return []
        
    encoder = get_cross_encoder()
    pairs = [[query, chunk["text"]] for chunk in candidate_chunks]
    scores = encoder.predict(pairs)
    
    for i, chunk in enumerate(candidate_chunks):
        chunk["cross_score"] = float(scores[i])
        
    reranked = sorted(candidate_chunks, key=lambda x: x["cross_score"], reverse=True)
    
    final_chunks = []
    seen_texts = set()
    for chunk in reranked:
        prefix = chunk["text"][:100].strip().lower()
        if prefix not in seen_texts:
            seen_texts.add(prefix)
            final_chunks.append(chunk)
            if len(final_chunks) == top_k:
                break
                
    return final_chunks


def advanced_crag_retrieve(
    user_query: str,
    final_top_k: int = 5,
    crag_cross_threshold: float = 0.50,
    max_retries: int = 2
) -> dict:
    start_time = time.time()
    bm25_engine = get_bm25_engine()
    
    print(f"\n==================================================")
    print(f"[ADVANCED CRAG ENGINE] User Query: '{user_query}'")
    
    for attempt in range(max_retries):
        print(f"\n--- CRAG Attempt {attempt + 1}/{max_retries} ---")
        
        sub_queries = generate_sub_queries(user_query, retry_count=attempt)
        print(f"[STAGE 1] Sub-Queries Generated ({len(sub_queries)}):")
        for q in sub_queries:
            print(f"   - {q}")
            
        all_retrieval_lists = []
        for q in sub_queries:
            all_retrieval_lists.append(dense_retrieve(q, k=15, min_similarity=0.30))
            all_retrieval_lists.append(bm25_engine.search(q, top_k=15))
            
        fused_candidates = reciprocal_rank_fusion(all_retrieval_lists, k_rrf=60)
        top_candidates = fused_candidates[:20]
        
        reranked_chunks = rerank_cross_encoder(user_query, top_candidates, top_k=final_top_k)
        
        best_cross_score = reranked_chunks[0]["cross_score"] if reranked_chunks else 0.0
        print(f"[STAGE 4 EVALUATION] Best Cross-Encoder Score: {best_cross_score:.4f}")
        
        if best_cross_score >= crag_cross_threshold:
            elapsed = (time.time() - start_time) * 1000
            print(f"[CRAG SUCCESS] Top Cross-Score High ({best_cross_score:.4f} >= {crag_cross_threshold}). Latency: {elapsed:.1f}ms")
            return {
                "path_used": f"CRAG_ATTEMPT_{attempt + 1}",
                "confidence_score": best_cross_score,
                "retries": attempt,
                "latency_ms": elapsed,
                "chunks": reranked_chunks,
                "needs_web_fallback": False
            }
            
        print(f"[CRAG RETRY TRIGGERED] Cross-Score ({best_cross_score:.4f} < {crag_cross_threshold}). Attempting re-expansion...")

    elapsed = (time.time() - start_time) * 1000
    print(f"[CRAG AMBIGUOUS] All retries below threshold. Flagging for web search / fallback.")
    return {
        "path_used": "CRAG_EXHAUSTED",
        "confidence_score": best_cross_score if 'best_cross_score' in locals() else 0.0,
        "retries": max_retries,
        "latency_ms": elapsed,
        "chunks": reranked_chunks if 'reranked_chunks' in locals() else [],
        "needs_web_fallback": True
    }


if __name__ == "__main__":
    test_q = "When I move into germany for pursuing masters"
    amb = detect_query_ambiguity(test_q)
    print(f"AMBIGUITY CHECK: {amb}")
