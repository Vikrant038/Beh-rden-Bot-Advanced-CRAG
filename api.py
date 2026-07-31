"""
FastAPI REST API Server & Server-Sent Events (SSE) Streaming Backend (Behoerden-Bot 3.0)
Complies with AGENTS.md §1 & §2, and CODING_STANDARDS.md.
"""

import uvicorn
from contextlib import asynccontextmanager
from typing import Dict, List, Optional, Union
from fastapi import FastAPI, Request, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from src.agentic_rag import run_agentic_rag_pipeline_stream, run_agentic_rag_pipeline
from src.rag import rag_answer, RAGQueryRequest
from src.pii_masker import mask_pii
from src.document_sync import sync_document_transactional
from src.logging_config import logger
from src.errors import DomainError, NotFoundError, ValidationError, LLMProviderError
from src.tracing import flush_telemetry, langfuse_client, observe, propagate_attributes, update_current_observation


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[FASTAPI] Starting Behörden-Bot 3.0 Enterprise REST API Backend...")
    yield
    logger.info("[FASTAPI] Shutting down backend. Flushing telemetry queues...")
    await flush_telemetry()

app = FastAPI(title="Behörden-Bot 3.0 API", description="3-Agent ReAct RAG with PostgreSQL", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    query: str = Field(..., max_length=1000, description="The user query")
    session_id: str = "default"
    user_id: str = "anonymous"
    stream: bool = True
    mode: str = "agentic"  # "agentic" or "standard"
    bypass_cache: bool = False


class SyncRequest(BaseModel):
    source_name: str
    source_url: str
    raw_text: str
    source_id: str = "custom_sync"


@app.post("/query")
@observe(name="api_query_endpoint")
async def process_query(request: QueryRequest):
    """
    Unified Query Endpoint supporting 3-Agent ReAct streaming and Standard CRAG mode.
    """
    logger.info(f"[API] Processing query request: '{request.query[:50]}...' (Mode: {request.mode}, Stream: {request.stream})")
    
    with propagate_attributes(user_id=request.user_id, session_id=request.session_id):
        safe_query, pii_detected = mask_pii(request.query)
        if pii_detected:
            logger.info("[API PII] PII detected and masked in request payload.")
            update_current_observation(metadata={"pii_detected": True, "original_length": len(request.query)})

        try:
            if request.mode == "standard":
                req = RAGQueryRequest(question=safe_query, top_k=5, session_id=request.session_id, bypass_cache=request.bypass_cache)
                res = await rag_answer(req)
                return {
                    "answer": res.answer,
                    "sources": [s.model_dump() for s in res.sources],
                    "latency": res.latency_ms,
                    "cached": res.is_cached,
                    "path": res.retrieval_path
                }

            if request.stream:
                return StreamingResponse(
                    run_agentic_rag_pipeline_stream(safe_query, request.session_id, request.user_id, bypass_cache=request.bypass_cache),
                    media_type="text/event-stream"
                )
            else:
                res = await run_agentic_rag_pipeline(safe_query, request.session_id, request.user_id, bypass_cache=request.bypass_cache)
                return {
                    "answer": res.final_answer,
                    "sources": res.sources,
                    "latency": res.total_latency_ms,
                    "cached": False,
                    "path": "3_AGENT_REACT_ORCHESTRATOR"
                }

        except DomainError as e:
            logger.warning(f"[API DOMAIN ERROR] {e.message}")
            raise HTTPException(status_code=e.status_code, detail={"code": e.code, "message": e.message})
        except Exception as e:
            logger.warning(f"[API UNHANDLED ERROR] {e}")
            raise HTTPException(status_code=500, detail=f"Internal server error: {e}")


@app.get("/health")
def health_check() -> Dict[str, str]:
    return {"status": "healthy"}


@app.post("/documents/sync")
async def sync_document(request: SyncRequest, background_tasks: BackgroundTasks) -> Dict[str, str]:
    logger.info(f"[API SYNC] Queuing transactional document sync for: {request.source_name}")
    background_tasks.add_task(
        sync_document_transactional,
        request.source_name,
        request.source_url,
        request.raw_text,
        request.source_id
    )
    return {"message": f"Sync started for {request.source_name}", "status": "Accepted"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
