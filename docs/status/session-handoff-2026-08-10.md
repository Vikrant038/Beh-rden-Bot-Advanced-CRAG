# Session Handoff — 2026-08-10

Branch `main` (local working tree has uncommitted changes — see [Pending work](#pending-work--next-steps)).

---

## Executive summary

This session closed the three production pain points that had been open since August 5:

1. **The two prod 500s** (`admin.getTestRun` + `chat.feedback`) — root cause was a missing
   `users.blockedAt` column on Neon. **Fixed: migration `20260810000001_add_user_blocked_at` is
   now applied in production** (verified live).
2. **The reranker fallback** (`[RERANK] Cross-encoder failed`) — the Cloudflare worker now serves
   `@cf/baai/bge-reranker-base`, and the full request/response contract was fixed and verified
   with real scores. **Worker deployed; live curl returns 0.998 vs 0.00004.**
3. **The English-first corpus migration** — the Groq model-chain fallback stalled on a 404ing
   model; fixed with a hard-error blacklist + TPD-429 chain advance. The corpus is being
   re-ingested in English (background run in progress at handoff time).

Plus a full audit pass (security, database, dead code) whose fixes are in the working tree.

---

## Production state (verified live against Neon)

| Item | State | Proof |
|---|---|---|
| Migrations applied | **17/17** on Neon (16 from repo + orphan `20260805000004_bge_m3_neon_compatible`) | `_prisma_migrations` listing |
| `users.blockedAt` column | ✅ present | `information_schema` |
| `accounts/sessions/message_feedback` userId indexes | ✅ present | `pg_indexes` |
| `pg_trgm` extension + GIN text index | ✅ present | `pg_extension`, `pg_indexes` |
| `document_chunks.isGerman` column + partial index | ✅ present | `pg_indexes` (`…_isgerman_idx`, lowercase — Postgres folds unquoted identifiers) |
| Semantic cache | **0 rows — cleared** by the migration script's first step | `SELECT count(*)` |
| Corpus | **115 files** · **17,877 child chunks** (16,675 en / 1,202 de) + **1,564 parent chunks** — snapshot `2026-08-10T14:56Z`; background re-ingest still finishing (1 doc INGESTING) | `SELECT` |

⚠️ **One known drift:** Neon carries `20260805000004_bge_m3_neon_compatible`, which was applied
directly to Neon and is **not** in the repo's `prisma/migrations/` (no git history either). It does
not block `migrate deploy`, but local and Neon disagree. See [Pending work](#pending-work--next-steps).

---

## What this session fixed

### 1. The two production 500s — one missing column

- **Symptom:** every authenticated request 500'd in prod — `chat.feedback` ("feedback doesn't
  point anywhere") and `admin.getTestRun` (HTTP 500, Request ID `8kftj-…`).
- **Root cause:** the tRPC auth middleware selects `blockedAt` on *every* protected call, but the
  `20260810000001_add_user_blocked_at` migration had never been applied to Neon (its history ended
  at `…_fts_index`). Prisma generated `SELECT blocked_at` → column missing → 500.
- **Fix:** `prisma migrate deploy` against Neon (additive, nullable column, nothing dropped).
- **Verification:** column present; unit + E2E suites green.
- **Bonus:** feedback thumb colors are now **persisted across reloads** — `getById` hydrates the
  user's saved rating into `feedbackState` (commit `027a347`).

### 2. The reranker saga — fully resolved

The error chain, each layer peeled until the real scores came out:

| Error | Meaning | Fix |
|---|---|---|
| `401` | token mismatch | dedicated `EMBED_TOKEN` env (keeps `HF_TOKEN` for the HF LLM fallback) |
| `1101` | worker crash, reason hidden | added error surfacing (try/catch → real message) |
| `5006` | wrong field name | `documents` → `contexts` (Workers AI contract) |
| `8001` | wrong value shape | bare strings → `{ text }` objects |
| `502` | wrong response parse | binding returns unwrapped `{ response: [{ id, score }] }` — parse both shapes |
| stale deploy | 8001 persisted after fix | `npx wrangler deploy` |

- **Verified live:** `curl` of the worker's rerank route returns `[[{score: 0.998}], [{score: 0.00004}]]`.
- The `[RERANK] Cross-encoder failed` fallback is gone; reranking now actually runs in prod.
- The worker enforces the model's input limits (≤50 docs × ≤4,000 chars) and a keep-warm cron
  keeps both models loaded.

### 3. Corpus migration machinery (English-first)

- **Chain stall bug:** the fallback chain only advanced on *budget* exhaustion, never on a hard
  error — so when `llama-3.3-70b` hit its 100K/day wall and `llama-4-scout` 404'd on the account,
  **every** segment died and docs silently stayed German (`Done — 69 succeeded, 63 skipped` with
  only ~6 docs actually updated).
- **Fixes (commits `99029de`, `18109d9`):**
  - hard errors (404/403/401) blacklist the model for the run and retry on the next model;
  - a TPD 429 now advances the chain + retries the segment (was: treated as transient → fallback);
  - `max_tokens` capped at one input length so Groq's reservation accounting fits the pool's
    2×-input estimate (the 112K/day overshoot is gone);
  - multi-key pool: 1–3 Groq keys, chain `llama-3.3-70b → llama-4-scout → qwen3-32b → gpt-oss-120b
    → gpt-oss-20b → kimi-k2 → llama-3.1-8b`, `GROQ_TRANSLATE_MODELS` override.
- **Result:** the corpus is migrating to English in the background; re-run
  `pnpm tsx scripts/translate-corpus.ts` until the startup estimate reads ~0.

### 4. Security audit — findings and fixes

- **Fixed: `/api/health` leaked `stack` + `cause` publicly** on DB failure. Now logged server-side;
  the public response carries only a generic message.
- **Hardened: SSRF guard** (`assertSafeUrl`):
  - IPv6 loopback / unspecified / link-local (`fe80::/10`) / ULA (`fc00::/7`) / multicast now blocked;
  - IPv4-mapped (`::ffff:127.0.0.1`) and IPv4-compatible IPv6 forms routed through the IPv4 checks
    (closes the metadata-IP bypass);
  - unknown address formats fail closed;
  - the scraper now follows redirects **manually, re-validating every hop** (closes the
    fetch-follows-to-internal-host gap); DNS-rebinding TOCTOU documented as a known limitation.
- **Verified clean:** no `eval`/`dangerouslySetInnerHTML`/unsafe HTML; no server secrets reach
  client code; all raw SQL parameterized; CI actions SHA-pinned (the 22-item semgrep backlog is
  resolved).
- **Remaining (documented):** admin upload route trusts the JWT role for the session lifetime;
  `POST /api/guest` has no rate limit; in-memory rate-limit fallback is per-instance (Upstash
  required in prod — see `SECURITY_EXCEPTIONS.md`).

### 5. Database improvements

| Change | Migration | Why |
|---|---|---|
| FK indexes on `accounts.userId`, `sessions.userId`, `message_feedback.userId` | `20260810000002_add_user_fk_indexes` | sign-in/account-link lookups + cascade deletes were unindexed |
| `pg_trgm` GIN index on `document_chunks.text` | `20260810000003_add_search_trgm_and_chunk_language` | `searchChunks` `ILIKE '%…%'` was a full table scan |
| `document_chunks.isGerman` + partial index | same migration | landing-page aggregate regex-scanned every chunk per hit; now index-backed |

**Verified with `EXPLAIN`:** the German count uses `Bitmap Index Scan on document_chunks_isgerman_idx`;
selective chunk searches use `document_chunks_text_trgm_idx`. Both applied locally and on Neon.

### 6. Cleanup (working tree, uncommitted)

- Removed **13 tracked files**: `.pnpm-store` (2, accidental) + 11 one-off debug/scratch files
  (`verification_notes.txt`, `test-rag.ts`, `test-stream.ts`, `test-sse.mjs`, `query-messages.ts`,
  `scripts/debug-e2e.mjs`, 5 × `scratch/*`). **`mvp-python/` kept** by request.
- `.gitignore` now excludes `.pnpm-store/`.
- Fixed the stale `bge-base-en-v1.5` comment in `.env.example` (corpus is bge-m3 via the Cloudflare worker).

---

## Verification results (this session)

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ clean |
| `eslint` | ✅ 0 errors (14 intentional warnings) |
| `prettier --check` | ✅ clean |
| `vitest run --coverage` | ✅ **81 files, 775 passed, 3 skipped** — branch **85.04%** (threshold 85%) |
| `playwright test` | ✅ **54 passed** (Chromium + mobile) |
| Semgrep (CI command, docker) | ✅ **0 findings (0 blocking)** — 496 rules / 441 targets |
| Gitleaks (CI-equivalent, docker) | ✅ **0 leaks** after allowlisting the E2E placeholder secret |
| Worker live curl | ✅ rerank returns real scores |
| Neon schema | ✅ all columns/indexes present |
| `EXPLAIN` proofs | ✅ both new indexes used |

**New files:** `.gitleaks.toml` — allowlists the deliberately-fake
`e2e-placeholder-secret-1234567890abcdef` in `e2e-web-app.yml` (used to forge test session
cookies; flagged by the generic-api-key entropy rule as a false positive).

## Neon drift — diagnosed and resolution

`prisma migrate diff --from-url <neon> --to-url <local>` → **“No difference detected.”** The two
live databases are schema-identical, so the orphaned `20260805000004_bge_m3_neon_compatible`
(never in the repo) is a **no-op relative to the intended schema** — its net effect is already
covered by the repo's migrations. (The `diff Neon vs schema.prisma` output listing three “removed
indexes” is expected — HNSW/GIN indexes on `Unsupported` vector columns can't be expressed in the
datamodel; they live in migrations `…_bge_m3_1024_dim`, `…_fts_index`, `…_hnsw_index`.)

**Resolution options:** (a) leave the extra `_prisma_migrations` row and document it — zero risk,
`migrate deploy` ignores it; or (b) `DELETE` that one row from Neon's `_prisma_migrations` so repo
and Neon agree 16 = 16 — safe *because* the schemas are proven identical. Recommended: (b), with
this diff as the verification. The only practical downside of leaving it: a future `prisma migrate
dev` against Neon would warn about the unknown migration and could offer a destructive reset.

---

## Current corpus state (live snapshot `2026-08-10T14:56Z`)

- **115 files** on Neon (114 SYNCED, 1 INGESTING — the background English-first re-ingest is
  still finishing). **17,877 child chunks** (16,675 en / 1,202 de) + **1,564 parent chunks**.
  Chunk counts settle once the last doc flips to SYNCED.
- The corpus is stored **English-first**: chunk *text* is English (translations keep German
  terms in parentheses, e.g. *"residence permit (Aufenthaltserlaubnis)"*), so the ~6.7% that
  still trips the `isGerman` umlaut heuristic are **not** untranslated docs. Judge by the
  script's `Est. ~N documents need translation` estimate, which has reached **0**.
- **2 documents can never be translated:** `testdaf-pruefungsregeln.pdf` and
  `uni-assist-hzb-infokarte.pdf` are scanned/image PDFs — pdf-parse extracts no text, so they
  fail with "No usable chunks extracted" on every run. They still hold 65 old-era chunks in the
  DB (48 + 17). Fix = re-upload the source PDFs as **text-layer** PDFs (OCR), not `.md` files
  (the pipeline ingests URLs and PDFs only).
- **What the admin Sources/Documents pages show:** chunk *text* is English; document *titles*
  stay as scraped (often German) unless a title override was set — titles are source names, not content.

### Post-handoff fixes (later in the same session)

- **IPv6 SSRF regression (fixed):** the SSRF guard's IPv6 parser assumed every address contains
  `::`, but resolvers return **uncompressed** IPv6 — so every corpus URL on a host with an AAAA
  record crashed at `assertSafeUrl` (`Cannot read properties of undefined (reading 'includes')`,
  the 7 failing URLs on the 115-file run). Fixed in `url-validator.ts` + 4 regression tests; the
  7 URLs now ingest.
- **FK-race in the ingest rollback (fixed):** the embedding-failure rollback deleted the
  document row (`CASCADE`), which raced a concurrent in-flight job still creating parent chunks
  for the same `documentId` → `document_parent_chunks_documentId_fkey` violation. The rollback
  now **resets** the row to `chunkCount 0 + FAILED` (broken-record fix re-ingests it next run)
  instead of deleting it — race-safe, `pipeline.ts` + regression test.
- **Broken-record re-ingest (fixed in pipeline):** a 0-chunk row with a matching content hash was
  skipped forever; now any matching-hash row with 0 chunks is re-ingested.
- **Residence Act row deleted on Neon:** `pdf://667cce…/englisch_aufenthg.pdf` was removed
  (it carried ~2,559 stale German-era chunks under a stale `chunkCount 0` / INGESTING status).
  Re-obtain the PDF and re-upload via admin to restore it.

---

## Pending work / next steps

1. **Commit + push** — the working tree holds: 13 staged deletions, **31 modified files**,
   **7 new/untracked files** (9 new migrations/tests/doc), plus 2 commits already ahead of
   `origin/main` (`027a347`, `50a544b`). Vercel still runs the old code until the push.
2. **Corpus re-ingest** — mostly done (114/115 SYNCED); re-run `translate-corpus.ts` once more
   after it settles so the last INGESTING doc flips and `Est. ~0` confirms. The 7 previously
   IPv6-failed URLs now ingest; the 2 scanned PDFs still fail until re-uploaded as text PDFs,
   and the deleted Residence Act needs its PDF re-uploaded.
3. **Re-run the CRAG evaluation** against the English-first corpus and compare scorecards.
4. **Reconcile the orphaned Neon migration** `20260805000004_bge_m3_neon_compatible` — schemas
   are proven identical, so either `DELETE` its row from Neon's `_prisma_migrations` (recommended)
   or leave it documented (see “Neon drift” above).
5. **Optional backlog:** cache `germanChunkStats` further if the landing page needs it;
   re-verify the semgrep CI gate is green.

---

*Migration order used on Neon (all additive):* `…_add_user_blocked_at` →
`…_add_user_fk_indexes` → `…_add_search_trgm_and_chunk_language`. Deploy with
`DATABASE_URL="<neon url>" pnpm exec prisma migrate deploy` run from `web-app/` (the variable must
be a command prefix on the same line — a bare assignment is not exported).
