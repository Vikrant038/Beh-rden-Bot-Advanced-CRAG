# Security Exceptions Log

Per GUARDRAILS Module 5 / PIPELINE_OPS Module 2.4 — every bypassed security requirement must be logged here with an approver.

| Date | Tool / Rule | Finding | Reason for Exception | Expiration | Approver |
|---|---|---|---|---|---|
| 2026-07-31 | GUARDRAILS M2.5 (CSRF) | Auth.js session cookie uses `SameSite=Lax`; no custom double-submit CSRF middleware for tRPC mutations | **Human decision (user override).** User explicitly chose "Auth.js defaults (SameSite=Lax)" over the stricter SameSite=Strict + CSRF-token interpretation in the Phase 1 discovery Q&A. Auth.js still enforces its own CSRF token for server-side auth flows and SameSite=Lax blocks cross-site POST cookie sending. Code annotated `// @ai-exception` at `src/auth.config.ts`. | Review on CSRF incident or quarterly | [Pending — user sign-off] |
| 2026-08-02 | CSP style-src | `style-src 'unsafe-inline'` retained | Tailwind CSS v4 injects critical inline styles at runtime; removing unsafe-inline breaks rendering. Script-src now uses nonces. | Review when Tailwind CSS v5 supports nonce-based style injection | [Pending — user sign-off] |
| 2026-08-02 | CircuitBreaker / RateLimiter in-memory state | State does not persist across serverless cold starts | Accepted design trade-off; Upstash Redis must be configured in production. Documented in class JSDoc. | Production gate: UPSTASH_REDIS_URL must be set before go-live | [Pending — user sign-off] |

## Related annotations

- `src/auth.config.ts` — session strategy (JWT), SameSite default left at Auth.js value per user override.
- `prisma/schema.prisma` — enum casing deviation logged (`@ai-exception`).
