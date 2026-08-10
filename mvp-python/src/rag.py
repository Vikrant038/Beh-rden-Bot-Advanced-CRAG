"""
Production Baseline & Standard Advanced CRAG RAG Module
Complies with AGENTS.md §1 & §2, and CODING_STANDARDS.md.
"""

import os
import json
import time
import asyncio
import numpy as np
from typing import List, Dict, Optional, Union
from pydantic import BaseModel, Field, field_validator, model_validator
from dotenv import load_dotenv

from src.llm_client import call_llm
from src.retrieval import retrieve as dense_retrieve, get_embedding_model
from src.semantic_cache import get_semantic_cache
from src.memory import get_session_memory
from src.logging_config import logger
from src.errors import ValidationError
from src.tracing import observe, update_current_observation

load_dotenv()


# ==========================================
# PYDANTIC DATA MODELS
# ==========================================
class RAGQueryRequest(BaseModel):
    question: str
    session_id: str = "default"
    user_id: str = "anonymous"
    top_k: int = 5
    bypass_cache: bool = False


class SourceModel(BaseModel):
    name: str
    url: str = "#"
    score: float = 0.0

    @model_validator(mode="before")
    @classmethod
    def map_legacy_fields(cls, values: dict) -> dict:
        if isinstance(values, dict):
            if "name" not in values and "source_name" in values:
                values["name"] = values["source_name"]
            if "url" not in values and "source_url" in values:
                values["url"] = values["source_url"]
            if "score" not in values:
                values["score"] = values.get("cross_score", values.get("similarity_score", 0.0))
        return values


class RAGResponse(BaseModel):
    question: str
    answer: str
    sources: List[SourceModel]
    retrieval_path: str
    latency_ms: float
    is_grounded: bool
    is_cached: bool = False
    is_ambiguous: bool = False
    clarification_options: List[str] = Field(default_factory=list)


# ==========================================
# SYSTEM PROMPTS & TEMPLATES
# ==========================================
SYSTEM_PROMPT = (
    "You are Behoerden-Bot, an official expert assistant for German university admissions, "
    "student visa processes, APS certification, and blocked accounts.\n"
    "Your answers must be clear, factual, well-structured, and strictly grounded in the provided official context."
)

USER_PROMPT_TEMPLATE = (
    "{memory_context}\n\n"
    "OFFICIAL CONTEXT CHUNKS:\n"
    "{context_text}\n\n"
    "USER QUESTION:\n"
    "{question}\n\n"
    "Generate a structured, professional markdown response with subheadings, bullet points, and an 'Actionable Next Steps' section."
)


def format_context_for_prompt(chunks: List[dict]) -> str:
    if not chunks:
        return "No relevant context found."
    parts = []
    for c in chunks:
        name = c.get("source_name", "Official Source")
        url = c.get("source_url", "#")
        parts.append(f"[Source: {name} ({url})]\n{c.get('text', '')}")
    return "\n\n".join(parts)


@observe(name="trace_standard_crag_pipeline")
async def rag_answer(request: RAGQueryRequest) -> RAGResponse:
    from src.advanced_retrieval import advanced_crag_retrieve, check_query_guardrail
    
    start_time = time.time()

    # Stage 0A — deterministic term cache (spam + illegal-advice/safety terms)
    # with an LLM classifier fallback. Blocked queries are refused up front:
    # no retrieval, no cache write, no LLM answer generation.
    guard = await check_query_guardrail(request.question)
    if guard["blocked"]:
        total_latency = (time.time() - start_time) * 1000
        logger.info(f"[RAG] Guardrail blocked query ({guard['reason']}): {request.question[:60]}")
        return RAGResponse(
            question=request.question,
            answer=guard["message"],
            sources=[],
            retrieval_path="GUARDRAIL_BLOCKED",
            latency_ms=total_latency,
            is_grounded=False,
        )

    cache = get_semantic_cache()
    memory = get_session_memory(request.session_id)

    embed_model = get_embedding_model()
    q_vector = embed_model.encode([f"Represent this sentence for searching relevant passages: {request.question.strip()}"], normalize_embeddings=True)[0].astype(np.float32)

    cached_res = await cache.check_cache(request.question, query_vector=q_vector, bypass_cache=request.bypass_cache)
    if cached_res:
        total_latency = (time.time() - start_time) * 1000
        sources_models = [SourceModel(**s) for s in cached_res.get("sources", [])]
        await memory.add_turn(request.question, cached_res["answer"])
        return RAGResponse(
            question=request.question,
            answer=cached_res["answer"],
            sources=sources_models,
            retrieval_path=cached_res.get("retrieval_path", "SEMANTIC_CACHE_HIT"),
            latency_ms=total_latency,
            is_grounded=True,
            is_cached=True
        )

    retrieval_res = await advanced_crag_retrieve(request.question, final_top_k=request.top_k)
    raw_chunks = retrieval_res.get("chunks", [])
    needs_fallback = retrieval_res.get("needs_web_fallback", False)

    filtered_chunks = [c for c in raw_chunks if c.get("cross_score", c.get("similarity_score", 0.0)) >= 0.20]
    
    if not filtered_chunks or needs_fallback:
        answer_text = "I do not have sufficient official information in my knowledge base to answer this question reliably."
        is_grounded = False
        path_used = "CRAG_FALLBACK_UNGROUNDED"
    else:
        mem_context = await memory.get_context_formatted()
        formatted_ctx = format_context_for_prompt(filtered_chunks)
        user_prompt = USER_PROMPT_TEMPLATE.format(memory_context=mem_context, context_text=formatted_ctx, question=request.question)
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt}
        ]
        answer_text = await call_llm(messages, max_tokens=600, temperature=0.2)
        is_grounded = True
        path_used = retrieval_res.get("path_used", "HYBRID_RRF_CROSS_ENCODER")

    total_latency = (time.time() - start_time) * 1000
    sources_models = [SourceModel(**c) for c in filtered_chunks]

    await cache.add_to_cache(request.question, q_vector, {"answer": answer_text, "sources": [s.model_dump() for s in sources_models]}, bypass_cache=request.bypass_cache)
    await memory.add_turn(request.question, answer_text)

    return RAGResponse(
        question=request.question,
        answer=answer_text,
        sources=sources_models,
        retrieval_path=path_used,
        latency_ms=total_latency,
        is_grounded=is_grounded,
        is_cached=False
    )
