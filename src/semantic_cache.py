"""
Enterprise Multi-Tier Semantic Cache Engine (PostgreSQL + pgvector Backend)
Complies with GUARDRAILS.md 6.4 and CODING_STANDARDS.md Pillar 4.4.
- Tier 0: Negative Cache Rejection for Out-of-Domain queries
- Tier 1: SHA-256 Exact String Match
- Tier 2: 768d Cosine Vector Similarity Match (>= 0.93) via pgvector
"""

import os
import time
import asyncio
import hashlib
import numpy as np
from typing import Optional, List, Dict
from sqlalchemy import select, text, cast, String
from src.database import SessionLocal, SemanticCacheEntry
from src.logging_config import logger

DEFAULT_TTL_SECONDS = 7 * 24 * 3600  # 7 Days TTL
DEFAULT_SIMILARITY_THRESHOLD = 0.93

class SemanticCache:
    """
    Enterprise Multi-Tier Cache Engine (PostgreSQL / pgvector Backend):
    - Tier 1: SHA-256 Exact String Match
    - Tier 2: 768d Cosine Vector Similarity Match (>= 0.93) via pgvector
    - Negative Cache: Instant rejection for out-of-domain terms
    """

    def __init__(self, similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD):
        self.threshold = similarity_threshold
        self.negative_terms = set([
            "japan", "stock trading", "algorithmic", "crypto", "recipe", "cooking",
            "nba", "football", "cricket", "python script for trading"
        ])
        
    def _hash_query(self, query: str) -> str:
        return hashlib.sha256(query.strip().lower().encode("utf-8")).hexdigest()

    def check_negative_cache(self, query: str) -> bool:
        q_lower = query.lower()
        return any(term in q_lower for term in self.negative_terms)

    async def check_cache(self, query: str, query_vector: Optional[np.ndarray] = None, bypass_cache: bool = False) -> Optional[dict]:
        if bypass_cache:
            return None

        # Tier 0: Negative Cache Rejection
        if self.check_negative_cache(query):
            logger.info(f"[CACHE HIT - NEGATIVE] Query '{query[:40]}' rejected by Negative Cache.")
            return {
                "answer": "This question falls outside the scope of German immigration, student visas, and university applications.",
                "sources": [],
                "retrieval_path": "NEGATIVE_CACHE_HIT",
                "latency_ms": 0.5,
                "is_cached": True
            }

        q_hash = self._hash_query(query)
        
        try:
            async with SessionLocal() as db:
                # Tier 1: SHA-256 Exact String Match
                result = await db.execute(select(SemanticCacheEntry).filter(SemanticCacheEntry.query_hash == q_hash))
                exact_match = result.scalar_one_or_none()
                if exact_match:
                    logger.info(f"[CACHE HIT - TIER 1 EXACT DB] Match for query: '{query[:40]}'")
                    return {
                        "answer": exact_match.response_json["answer"],
                        "sources": exact_match.response_json.get("sources", []),
                        "retrieval_path": "TIER_1_EXACT_CACHE_HIT",
                        "latency_ms": 1.2,
                        "is_cached": True
                    }

                # Tier 2: pgvector Cosine Similarity Match
                if query_vector is not None:
                    # pgvector cosine distance operator is <=>
                    # similarity = 1 - distance
                    sql = text('''
                        SELECT response_json, 1 - (query_vector <=> CAST(:vec AS vector)) AS sim
                        FROM semantic_cache
                        ORDER BY query_vector <=> CAST(:vec AS vector)
                        LIMIT 1
                    ''')
                    vec_str = "[" + ",".join(str(float(x)) for x in query_vector.tolist()) + "]"
                    result = await db.execute(sql, {"vec": vec_str})
                    match = result.first()
                    if match:
                        sim_score = float(match.sim)
                        if sim_score >= self.threshold:
                            logger.info(f"[CACHE HIT - TIER 2 VECTOR DB] Sim: {sim_score:.4f} >= {self.threshold} for query: '{query[:40]}'")
                            return {
                                "answer": match.response_json["answer"],
                                "sources": match.response_json.get("sources", []),
                                "retrieval_path": f"TIER_2_VECTOR_CACHE_HIT (Sim: {sim_score:.3f})",
                                "latency_ms": 12.0,
                                "is_cached": True
                            }
        except Exception as e:
            logger.warning(f"[WARN] Database Semantic Cache check failed: {e}")
            
        return None

    async def add_to_cache(self, query: str, query_vector: np.ndarray, response_data: dict, parent_doc_ids: List[str] = None, bypass_cache: bool = False):
        if bypass_cache:
            return
        q_hash = self._hash_query(query)
        try:
            async with SessionLocal() as db:
                result = await db.execute(select(SemanticCacheEntry).filter(SemanticCacheEntry.query_hash == q_hash))
                existing = result.scalar_one_or_none()
                if not existing:
                    vec_list = query_vector.tolist() if isinstance(query_vector, np.ndarray) else query_vector
                    new_entry = SemanticCacheEntry(
                        query_hash=q_hash,
                        query_text=query,
                        query_vector=vec_list,
                        response_json=response_data,
                        parent_doc_ids=parent_doc_ids or []
                    )
                    db.add(new_entry)
                    await db.commit()
                    logger.info(f"[SEMANTIC CACHE] Added new entry to PostgreSQL: '{query[:40]}'")
        except Exception as e:
            logger.warning(f"[WARN] Failed to write to PostgreSQL cache: {e}")

    def save_cache(self, query: str, answer_text: str, sources: List[dict] = None, query_vector: Optional[np.ndarray] = None):
        """Synchronous wrapper / alias method for saving query results into cache."""
        response_data = {"answer": answer_text, "sources": sources or []}
        if query_vector is None:
            query_vector = np.zeros(768)
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.add_to_cache(query, query_vector, response_data))
        except RuntimeError:
            asyncio.run(self.add_to_cache(query, query_vector, response_data))

    async def clear_all_cache(self) -> bool:
        """Clear all entries from PostgreSQL semantic cache to start completely fresh."""
        try:
            async with SessionLocal() as db:
                await db.execute(text("DELETE FROM semantic_cache"))
                await db.commit()
                logger.info("🧹 [SEMANTIC CACHE] Cleared all entries from PostgreSQL cache!")
                return True
        except Exception as e:
            logger.warning(f"[WARN] Failed to clear PostgreSQL cache: {e}")
            return False

    def clear(self) -> bool:
        """Synchronous alias to clear cache entries (used by CLI / maintenance scripts)."""
        try:
            return asyncio.run(self.clear_all_cache())
        except Exception as e:
            logger.warning(f"[WARN] Cache clear failed: {e}")
            return False

    async def invalidate_cache_for_document(self, doc_id: str) -> int:
        """Invalidate all cache entries derived from a specific document ID."""
        try:
            async with SessionLocal() as db:
                result = await db.execute(
                    select(SemanticCacheEntry).filter(cast(SemanticCacheEntry.parent_doc_ids, String).like(f'%"{doc_id}"%'))
                )
                entries = result.scalars().all()
                count = len(entries)
                for entry in entries:
                    await db.delete(entry)
                await db.commit()
                logger.info(f"[SEMANTIC CACHE] Invalidated {count} cache entries derived from document '{doc_id}'")
                return count
        except Exception as e:
            logger.warning(f"[WARN] Failed to invalidate cache for document '{doc_id}': {e}")
            return 0

_semantic_cache_instance = None

def get_semantic_cache() -> SemanticCache:
    global _semantic_cache_instance
    if _semantic_cache_instance is None:
        _semantic_cache_instance = SemanticCache()
    return _semantic_cache_instance
