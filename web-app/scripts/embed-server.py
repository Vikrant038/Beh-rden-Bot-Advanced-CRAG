#!/usr/bin/env python3
"""
embed-server.py — local sentence-transformers embedding server (bge-base).

Speaks the exact contract of the web-app's `HfEmbeddingClient`, so corpus
ingestion can run through sentence-transformers locally with NO web-app code
changes: the client POSTs to `{url}/pipeline/feature-extraction/{model}` with
`{"inputs": [...], "options": {"wait_for_model": true}}` and expects
`number[][]` (768-dim) back. Point `HF_INFERENCE_URL` at this server and set
a non-empty `HF_TOKEN` (any value) when running `pnpm ingest`.

Same model weights as Cloudflare's `@cf/baai/bge-base-en-v1.5` (BAAI/bge-base-
en-v1.5) → the corpus and query vectors live in the SAME space, which is what
pgvector cosine retrieval requires.

Usage:
    .venv/bin/python web-app/scripts/embed-server.py [--port 8765] [--model BAAI/bge-base-en-v1.5]

Defaults: port 8765, model BAAI/bge-base-en-v1.5, device = MPS if available.
"""

from __future__ import annotations

import argparse
import logging
import sys

import torch
from fastapi import FastAPI, Request
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer

logger = logging.getLogger("embed-server")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

app = FastAPI(title="sentence-transformers embed server")


class EmbedRequest(BaseModel):
    inputs: list[str] = Field(min_length=1)
    options: dict = {}


@app.post("/pipeline/feature-extraction/{model:path}")
async def feature_extraction(model: str, request: EmbedRequest) -> list[list[float]]:
    """HF-style feature-extraction contract: texts in, 768-dim vectors out."""
    if model != app.state.model_name:
        logger.warning("requested model %r != loaded %r — using loaded model", model, app.state.model_name)
    texts = request.inputs
    logger.info("embedding %d text(s)", len(texts))
    vectors = app.state.model.encode(
        texts,
        normalize_embeddings=False,  # client normalizes; keep raw to match HF behavior
        batch_size=128,
        show_progress_bar=False,
    )
    return vectors.tolist()


@app.get("/healthz")
async def healthz() -> dict:
    return {"ok": True, "model": app.state.model_name, "device": str(app.state.device)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--model", default="BAAI/bge-base-en-v1.5")
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    logger.info("loading %s on %s (this downloads weights once)", args.model, device)
    model = SentenceTransformer(args.model, device=device)

    app.state.model = model
    app.state.model_name = args.model
    app.state.device = device

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    sys.exit(main())
