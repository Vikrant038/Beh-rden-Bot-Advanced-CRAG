# Phase 3 — RFC: Status

- **Status:** COMPLETE
- **Date:** 2026-07-31
- **Gate:** Approved as part of `Docs/WEB_APP_PLAN.md` (user-authored PRD/RFC).

## Deliverables
- Tech stack table (§2), repo structure (§3), Prisma schema — 7 models (§5), tRPC router map + SSE event contract (§6), RAG pipeline design (§7), NextAuth config + RBAC matrix (§8), design tokens (§9), SSE architecture (§10), observability (§11), testing strategy (§12), deployment + env inventory (§13).

## Key Trade-off Decisions
| Decision | Winner | Reason |
|---|---|---|
| Dense search | pgvector (not FAISS) | Single DB, no Python runtime |
| Embeddings | HF Inference API (not Transformers.js) | Serverless-safe, no 438MB cold start |
| Re-ranking | HF Inference API (bge-reranker-base) | No ONNX/Python dependency |
| BM25 | TS port (wink-bm25 or custom) | Stateless, rebuild per request (<1000 chunks) |
| Streaming | SSE route (not tRPC subscription) | Vercel-compatible, no WebSockets |
| Session | NextAuth JWT (HttpOnly cookie) | Stateless, Vercel-native |
