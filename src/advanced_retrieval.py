"""
Advanced CRAG (Corrective RAG) Engine with Hybrid Search & Cross-Encoder Reranking
Complies with AGENTS.md §1 & §2, and CODING_STANDARDS.md.
"""

import os
import json
import asyncio
from typing import List, Dict, Tuple, Optional, Union
import numpy as np
from dotenv import load_dotenv

from sentence_transformers import CrossEncoder

from src.retrieval import dense_retrieve, get_embedding_model
from src.llm_client import call_llm
from src.logging_config import logger
from src.utils import get_data_dir
from src.errors import NotFoundError, LLMProviderError
from src.tracing import observe, update_current_observation

load_dotenv()

_BM25_ENGINE_INSTANCE: Optional['BM25SearchEngine'] = None
_CROSS_ENCODER_MODEL: Optional[CrossEncoder] = None


# ==========================================
# DOMAIN VALIDATION GUARDRAIL (STAGE 0A)
# ==========================================
@observe(name="stage_0a_domain_guardrail", as_type="guardrail")
async def is_query_out_of_domain(query: str) -> bool:
    """
    Stage 0A Domain Classifier: Uses a fast LLM zero-shot classifier to whitelist 
    queries strictly related to German immigration & education.
    """
    prompt = (
        "You are a strict safety guardrail for a German Immigration Assistant.\n"
        "Your job is to block two categories of queries:\n"
        "  1. SPAM: Queries completely unrelated to German immigration/education (crypto, cooking, sports, programming, etc).\n"
        "  2. UNSAFE: Queries asking for illegal advice, even if immigration-related.\n\n"
        "RULE: If the query is asking for factual information (costs, timelines, requirements, processes) about studying or working in Germany, ACCEPT it.\n"
        "RULE: If the query seeks to circumvent, defraud, or illegally exploit German immigration law, REJECT it.\n"
        "RULE: If the query is totally unrelated to Germany/immigration/education, REJECT it.\n\n"
        f"User Query: {query}\n\n"
        "Is this query safe and relevant to German immigration, universities, or student life?\n"
        "Reply ONLY with 'YES' or 'NO'."
    )
    try:
        messages = [{"role": "user", "content": prompt}]
        res_text = await call_llm(messages, max_tokens=10, temperature=0.0)
        res_text = res_text.strip().upper()
        
        if "YES" in res_text:
            return False
        return True
    except Exception as e:
        logger.warning(f"[GUARDRAIL WARN] Domain check failed: {e}. Defaulting to safe (False).")
        return False


# ==========================================
# BM25 SPARSE RANKER
# ==========================================
class BM25SearchEngine:
    """BM25 Okapi Sparse Keyword Ranker built over disk JSON chunks."""

    def __init__(self, chunks_path: str = os.path.join(get_data_dir(), "processed", "all_chunks.json")):
        self.chunks_path = chunks_path
        self.chunks: List[dict] = []
        self.bm25 = None
        self._load_corpus()

    def _load_corpus(self):
        if not os.path.exists(self.chunks_path):
            logger.warning(f"[BM25 WARN] Corpus file missing: {self.chunks_path}")
            return
            
        try:
            with open(self.chunks_path, "r", encoding="utf-8") as f:
                self.chunks = json.load(f)
                
            tokenized_corpus = [c["text"].lower().split() for c in self.chunks]
            from rank_bm25 import BM25Okapi
            self.bm25 = BM25Okapi(tokenized_corpus)
            logger.info(f"[BM25] Initialized BM25 index over {len(self.chunks)} chunks.")
        except Exception as e:
            logger.warning(f"[BM25 ERROR] Failed to load BM25 corpus: {e}")

    def search(self, query: str, top_k: int = 50) -> List[dict]:
        if not self.bm25 or not self.chunks:
            return []
            
        tokenized_query = query.lower().split()
        scores = self.bm25.get_scores(tokenized_query)
        top_indices = np.argsort(scores)[::-1][:top_k]
        
        results = []
        for idx in top_indices:
            score = float(scores[idx])
            if score > 0.0:
                chunk_meta = self.chunks[idx].copy()
                chunk_meta["bm25_score"] = score
                results.append(chunk_meta)
        return results


def get_bm25_engine() -> BM25SearchEngine:
    global _BM25_ENGINE_INSTANCE
    if _BM25_ENGINE_INSTANCE is None:
        _BM25_ENGINE_INSTANCE = BM25SearchEngine()
    return _BM25_ENGINE_INSTANCE


# ==========================================
# MULTI-QUERY EXPANSION (STAGE 1)
# ==========================================
@observe(name="stage_1_query_expansion", as_type="span")
async def generate_sub_queries(query: str, num_queries: int = 3) -> List[str]:
    """
    Stage 1: Multi-Query Expansion via Groq LLM.
    Assumes entrypoint has already performed domain validation.
    """
    prompt = (
        f"You are an AI research assistant for German university admissions and student visas.\n"
        f"Generate {num_queries-1} alternative search queries in English for: '{query}'.\n"
        f"Return ONLY a JSON list of strings, e.g. [\"query 1\", \"query 2\"]."
    )
    
    try:
        messages = [{"role": "user", "content": prompt}]
        res_text = await call_llm(messages, max_tokens=150, temperature=0.2)
        parsed = json.loads(res_text)
        if isinstance(parsed, list):
            return [query] + [str(q) for q in parsed if str(q) != query]
    except Exception as e:
        logger.warning(f"[SUB-QUERY WARN] Failed to expand query: {e}")
        
    return [query]


# ==========================================
# HYBRID RECIPROCAL RANK FUSION (STAGE 2)
# ==========================================
@observe(name="stage_2_rrf_fusion", as_type="span")
def reciprocal_rank_fusion(rankings_list: List[List[dict]], k_rrf: int = 60) -> List[dict]:
    """
    Combines N ranked lists (Dense + Sparse) using Reciprocal Rank Fusion.
    Score = sum(1.0 / (k_rrf + rank))
    """
    chunk_map: Dict[str, dict] = {}
    rrf_scores: Dict[str, float] = {}
    
    for rank_list in rankings_list:
        for rank, chunk in enumerate(rank_list, start=1):
            chunk_id = f"{chunk.get('source_name', 'src')}_{chunk.get('chunk_index', rank)}_{hash(chunk.get('text', ''))}"
            chunk_map[chunk_id] = chunk
            rrf_scores[chunk_id] = rrf_scores.get(chunk_id, 0.0) + (1.0 / (k_rrf + rank))
            
    sorted_ids = sorted(rrf_scores.keys(), key=lambda cid: rrf_scores[cid], reverse=True)
    
    fused_results = []
    for cid in sorted_ids:
        chunk_obj = chunk_map[cid].copy()
        chunk_obj["rrf_score"] = float(rrf_scores[cid])
        fused_results.append(chunk_obj)
        
    return fused_results


# ==========================================
# CROSS-ENCODER RERANKING (STAGE 3)
# ==========================================
def get_cross_encoder() -> CrossEncoder:
    global _CROSS_ENCODER_MODEL
    if _CROSS_ENCODER_MODEL is None:
        model_name = "BAAI/bge-reranker-base"
        logger.info(f"[CROSS-ENCODER] Loading model: {model_name}...")
        _CROSS_ENCODER_MODEL = CrossEncoder(model_name)
    return _CROSS_ENCODER_MODEL


@observe(name="stage_3_cross_encoder_rerank", as_type="span")
def rerank_cross_encoder(query: str, chunks: List[dict], top_k: int = 10) -> List[dict]:
    if not chunks:
        return []
        
    try:
        reranker = get_cross_encoder()
        pairs = [[query, c.get("text", "")] for c in chunks]
        scores = reranker.predict(pairs)
        
        scores_sig = 1.0 / (1.0 + np.exp(-scores))
        
        reranked_chunks = []
        for idx, chunk in enumerate(chunks):
            c_copy = chunk.copy()
            c_copy["cross_score"] = float(scores_sig[idx])
            reranked_chunks.append(c_copy)
            
        reranked_chunks.sort(key=lambda x: x["cross_score"], reverse=True)
        return reranked_chunks[:top_k]
    except Exception as e:
        logger.warning(f"[RERANK ERROR] Cross-Encoder failed: {e}. Returning original ranking.")
        fallback_chunks = []
        for c in chunks[:top_k]:
            c_copy = c.copy()
            if "cross_score" not in c_copy:
                c_copy["cross_score"] = c_copy.get("similarity_score", c_copy.get("rrf_score", 0.75))
            fallback_chunks.append(c_copy)
        return fallback_chunks


# ==========================================
# ADVANCED CRAG RETRIEVAL ORCHESTRATOR
# ==========================================
@observe(name="advanced_crag_retrieve", as_type="retriever")
async def advanced_crag_retrieve(query: str, final_top_k: int = 5, confidence_threshold: float = 0.50) -> Dict[str, Union[str, float, bool, list]]:
    logger.info(f"[ADVANCED CRAG ENGINE] User Query: '{query[:50]}'")

    sub_queries = await generate_sub_queries(query, num_queries=3)
    bm25_engine = get_bm25_engine()
    
    dense_rankings: List[List[dict]] = []
    sparse_rankings: List[List[dict]] = []
    
    for q in sub_queries:
        d_res = dense_retrieve(q, k=30, min_similarity=0.20)
        s_res = bm25_engine.search(q, top_k=30)
        dense_rankings.append(d_res)
        sparse_rankings.append(s_res)
        
    all_rankings = dense_rankings + sparse_rankings
    fused_chunks = reciprocal_rank_fusion(all_rankings, k_rrf=60)
    logger.info(f"   • Hybrid RRF Fusion produced {len(fused_chunks)} unique context candidate chunks.")
    
    reranked_chunks = rerank_cross_encoder(query, fused_chunks[:30], top_k=final_top_k)
    
    best_score = reranked_chunks[0].get("cross_score", 0.0) if reranked_chunks else 0.0
    logger.info(f"   • Top Cross-Encoder Reranked Score: {best_score:.4f} (Threshold: {confidence_threshold:.2f})")
    
    needs_web = False
    path_used = "HYBRID_RRF_CROSS_ENCODER"
    
    if best_score < confidence_threshold:
        logger.info(f"   • Confidence Gate FAIL ({best_score:.4f} < {confidence_threshold:.2f}). Triggering Live Web Fallback!")
        needs_web = True
        path_used = "CRAG_CONFIDENCE_GATE_WEB_FALLBACK"
        
    return {
        "query": query,
        "chunks": reranked_chunks,
        "best_cross_score": best_score,
        "needs_web_fallback": needs_web,
        "path_used": path_used
    }
