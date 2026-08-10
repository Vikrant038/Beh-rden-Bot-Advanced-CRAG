# Security Exceptions Log

Per GUARDRAILS Module 5 / PIPELINE_OPS Module 2.4 — every bypassed security requirement must be logged here with an approver.

| Date | Tool / Rule | Finding | Reason for Exception | Expiration | Approver |
|---|---|---|---|---|---|
| 2026-07-31 | GUARDRAILS M2.5 (CSRF) | Auth.js session cookie uses `SameSite=Lax`; no custom double-submit CSRF middleware for tRPC mutations | **Human decision (user override).** User explicitly chose "Auth.js defaults (SameSite=Lax)" over the stricter SameSite=Strict + CSRF-token interpretation in the Phase 1 discovery Q&A. Auth.js still enforces its own CSRF token for server-side auth flows and SameSite=Lax blocks cross-site POST cookie sending. Code annotated `// @ai-exception` at `src/auth.config.ts`. | Review on CSRF incident or quarterly | [Pending — user sign-off] |
| 2026-08-02 | CSP style-src | `style-src 'unsafe-inline'` retained | Tailwind CSS v4 injects critical inline styles at runtime; removing unsafe-inline breaks rendering. Script-src now uses nonces. | Review when Tailwind CSS v5 supports nonce-based style injection | [Pending — user sign-off] |
| 2026-08-02 | CircuitBreaker / RateLimiter in-memory state | State does not persist across serverless cold starts | Accepted design trade-off; Upstash Redis must be configured in production. Documented in class JSDoc. | Production gate: UPSTASH_REDIS_URL must be set before go-live | [Pending — user sign-off] |
| 2026-08-02 | Guardrail prompt injection (LLM-based classifier) | `isQueryOutOfDomain` uses an instruction-following LLM, not a dedicated classifier model. Prompt-injection via crafted queries can still manipulate the verdict despite XML delimiter mitigation. | A fine-tuned text-classification model (e.g. BERT) would be more robust, but adds a new model dependency and inference latency. Current mitigations (500-char truncation, XML delimiters, system/user message split) raise the bar substantially. **Updated 2026-08-08:** the LLM is no longer the only layer — both the TS and Python guardrails now run a deterministic negative/intent term cache (`NEGATIVE_TERMS` + `SAFETY_TERMS`) before any LLM call, covering the highest-confidence out-of-domain and illegal-advice (fraud/forgery) cases with zero injection surface and zero LLM cost. The safety class (fraud/forgery) fails closed via the term cache and is never subject to LLM error. | Review if guardrail bypass incidents occur in production | [Pending — user sign-off] |
| 2026-08-02 | Message.sources stored as `Json?` blob | `Message.sources` is a `Json?` column rather than a normalised `MessageSource` relation, making SQL-level source-citation analytics impossible. | Sources are only ever read as part of their parent message and never joined independently. A relation adds schema complexity with no current query benefit. The read boundary is now Zod-validated in `conversation.ts`. Revisit when citation-frequency analytics are required. | Revisit if citation analytics feature is planned | [Pending — user sign-off] |
| 2026-08-02 | Ingest pipeline runs synchronously in request handler | `syncAllDocuments` runs inside the serverless function; for large corpora it can hit the 60 s Vercel timeout. | A background job queue (BullMQ / Vercel Cron + DB table) is the correct long-term fix but adds operational complexity disproportionate to the current corpus size. `IngestQueue` (serial, one doc at a time) is the interim mitigation. | Revisit when corpus exceeds ~20 documents or timeout incidents occur | [Pending — user sign-off] |

## Related annotations

- `src/auth.config.ts` — session strategy (JWT), SameSite default left at Auth.js value per user override.
- `prisma/schema.prisma` — enum casing deviation logged (`@ai-exception`).
- `src/server/rag/guardrail.ts` — `sanitizeQueryForPrompt`, XML delimiters, and system/user split documented inline.
- `src/advanced_retrieval.py` — Python-side `is_query_out_of_domain`/`check_query_guardrail`: same term-cache + LLM-classifier layering, `OUT_OF_DOMAIN_MESSAGE`/`UNSAFE_QUERY_MESSAGE` shared with `src/rag.py` and `src/agentic_rag.py`.
- `src/server/routers/conversation.ts` — `parseSourcesJson` JSDoc explains the `Json?` trade-off.
- `src/server/ingest/pipeline.ts` — module-level JSDoc documents the backpressure limitation and `IngestQueue` mitigation.
- `src/server/llm/circuit-breaker.ts` — `⚠️ SERVERLESS LIMITATION` in class JSDoc.
- `src/server/lib/security/rate-limiter.ts` — `⚠️ SERVERLESS LIMITATION` in class JSDoc.
