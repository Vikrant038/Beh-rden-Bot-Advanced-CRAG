# Session Handoff — 2026-08-06

Branch `web-app`. **Pushed and in sync with `origin/web-app`** after this session.

---

## What this session changed

### 1. Dense-search latency (13 680 ms) — verified fixed, not a live bug

- The 13.6 s dense reading came from commit `6738871`; the current build was already
  ahead of it with **batch query embeddings** (all 5 sub-queries embedded in one
  `embedTexts` call instead of 5 serial worker round-trips) and **parallel dense
  pgvector lookups** (`Promise.all` in `HybridRetriever.retrieve`).
- Verified the `document_chunks_embedding_idx` HNSW index (`vector_cosine_ops`) exists
  in migration `20260805000002_bge_m3_1024_dim` — dense stays approximate-NN, not a
  sequential scan.
- **Gap closed:** `scripts/seed-corpus.sh` only guarded the FTS GIN index on a
  data-only seed. It now also creates the pgvector HNSW index if missing, so a seeded
  Neon target can never silently degrade to a multi-second dense scan.

### 2. Login-loop from the home button — fixed

- Landing page CTAs are session-aware (`useSession`): "Get started" / "Start asking"
  → `/chat` when signed in, `/login` when not; "Browse the knowledge base" →
  `/sources` when signed in.
- `/login` redirects already-authenticated users to `/chat` — unless an OAuth `error`
  param is present (so `AccessDenied`-style banners are not swallowed).
- e2e `landing.spec.ts` still passes (5/5) because unauthenticated visitors keep the
  `/login` path.

### 3. Pipeline tester run retention (keep latest 5)

- `executePipelineTest` now prunes `pipelineRun` history after every terminal run:
  keeps the newest 5 rows, `deleteMany` the rest (best-effort, failure swallowed).
- RUNNING rows are never deleted while the tester UI may still be polling them.
- Unit tests: newest-5 keep/delete contract + prune-failure-is-swallowed.
- Rebase note: the pushed branch now sits on top of `6738871` (pipeline tester
  pre/post-processing, per-agent costs, **closed accordions**). The remote's
  closed-by-default StageNode design won over this session's open-by-default
  accordions; the non-conflicting responsive wins (action-label truncation,
  touch-sized chevron) were kept. A new `pipeline-visualizer` test suite covers
  the remote-added pre/post-processing + telemetry branches.

### 4. Coverage gate closure (85 % everywhere)

- `vitest.config.mts` raised thresholds to 85 % (statements/branches/functions/lines)
  and added the branch threshold; CI runs `vitest run --coverage`, so this gate is live.
- Dragging the landing page, login content, and theme toggle into the coverage
  denominator dropped branches below the gate; closed it with new unit tests:
  `src/app/page.test.tsx` (page.tsx now 100 %), `src/app/login/login-content.test.tsx`,
  `src/components/ui/theme-toggle.test.tsx`.
- Final (post-rebase): **596 tests, 92.8 % stmts / 85.1 % branch / 89.7 % funcs / 92.9 % lines** — gate green.

### 5. Responsive mobile UI upgrade (committed as `41457f6`)

- 44 px touch targets, safe-area insets, `overflow-x: clip`, no tap-highlight,
  16 px inputs (iOS zoom), hover-only reveal fallback for touch, scaled headings,
  swipeable tables/code, drawer + fade keyframes, `touch-action: pan-y` on messages,
  reduced-motion + reduced-transparency guards. Checklist:
  `web-app/docs/responsive-ui-upgrade-checklist.md`.

### 6. Housekeeping

- `tests/unit/logger-env.test.ts` (untracked) failed typecheck with TS2540
  (`process.env.NODE_ENV` is readonly) — switched to `vi.stubEnv`; `pnpm typecheck` is
  green.
- `src/server/env.ts`: exported `normalizeUrl` (test needs it).

---

## Follow-up session (same day) — fixes from live QA

### 7. Pipeline trace rows: whole-row tap + chevron pinned far-right

- `StageNode` header is now a single `<button>` when a body exists — tapping
  anywhere on the row (title, duration, tick, chevron) toggles open/close.
  The chevron + status tick are both `shrink-0` and sit pinned far-right next
  to each other (no more two-`ml-auto` fight that misaligned rows on phones).
  Stage titles truncate with `min-w-0 flex-1`. Keyboard accessible
  (`aria-expanded` + `aria-controls`). Matches checklist item #102.

### 8. Dense search 14 812 ms — root cause is the embed round-trip, not pgvector

- Measured locally: pgvector query = **117 ms** (seq scan, 23 934 rows, HNSW index
  present); local bge-m3 embed batch = **0.13 s**. The 14.8 s "Dense Search" stage is
  the **Cloudflare worker cold start** (`@cf/baai/bge-m3` model load, 10–20 s) — a
  remote embed round-trip, not the database.
- **Fix 1 (biggest):** `runAgenticRag` no longer embeds the query when
  `bypassCache: true` (the admin tester's default) — the vector was only needed for
  cache lookup/write, so every glass-box run previously paid a wasted cold embed.
- **Fix 2:** `HfEmbeddingClient` gained a bounded in-memory batch cache
  (exact-text key, 1 h TTL, ≤2048 entries, ≤16 texts/batch) — repeated queries and
  expanded sub-queries are instant Map hits.
- **Fix 3:** the embeddings worker now self-warms via a 5-minute cron
  (`[triggers] crons = ["*/5 * * * *"]`) so real queries hit a warm model.
- Tests: embed cache hit/miss contract + orchestrator bypass-embed skip.

### 9. Responsive checklist verified against source — full audit, no sampling

- Added `web-app/scripts/verify-responsive-checklist-full.sh` — verifies **every
  logged row** of `docs/responsive-ui-upgrade-checklist.md` against the actual
  source (all four phases). Result: **103/103 PASS, 0 FAIL** (2026-08-06).
- Added `web-app/scripts/verify-plan-150.sh` — audits all 150 sections of
  `docs/UI_UX_ENHANCEMENT_PLAN.md` (file exists + distinctive feature token).
  Result: **147/150 present**. Three plan features are genuinely NOT in the code:
  `2.5` Testimonials (landing, P2), `4.2` Message entrance animations (P1),
  `7.13` History page stats header (P2). The checklist log's "all 150 applied"
  header was overstated — it documents the responsive pass only; the doc now
  states this explicitly and lists the 3 open plan items.
- Drift corrections found during the full audit: item #47's follow-up chips live
  in `chat-interface.tsx` (not `chat-input.tsx`); #136's two-pane uses
  `md:grid-cols-[minmax(0,340px)_1fr]` (not `md:grid-cols-2`); #138's touch
  targets are a global pass (chat-input follows #53's `h-10 w-10` sizing, which
  matches the `min-h-10` textarea so the send/paste icons stay level with the
  text at every breakpoint).

---

## Validation (all green)

| Check                                         | Result                                      |
| --------------------------------------------- | ------------------------------------------- |
| `pnpm typecheck`                              | ✅                                          |
| `pnpm lint`                                   | ✅                                          |
| `pnpm test` (vitest)                          | ✅ 599 tests                                |
| `vitest run --coverage`                       | ✅ 85 % thresholds (92.6/85.03/89.77/92.67) |
| `scripts/verify-responsive-checklist-full.sh` | ✅ 103/103                                  |
| `scripts/verify-plan-150.sh`                  | ✅ 147/150 present (3 open: 2.5, 4.2, 7.13) |
| e2e (full Playwright suite)                   | ✅ 25/25                                    |
| `bash -n scripts/seed-corpus.sh`              | ✅                                          |

---

## Still open (unchanged from 08-04 handoff)

1. **Vercel deploy workflow** — red only because `VERCEL_TOKEN` is not configured in
   GitHub secrets (config gap, not code). Add `VERCEL_TOKEN` + `VERCEL_ORG_ID` +
   `VERCEL_PROJECT_ID` to enable deploy.
2. **Semgrep backlog** — 28 findings, all WARNING/0 real vulns; triage tracked in
   `web-app/docs/security/semgrep-backlog.md`.
3. **Resumable ingest queue** — enqueue+202 ships; per-batch resume + mid-job budget
   check is the documented next step (no new infra).
4. **Embeddings worker cold starts** — addressed this session: the worker now
   self-warms via a 5-minute cron and repeated texts hit an in-memory embed
   cache; the tester's bypass-cache path skips the embed entirely. Deploy the
   updated worker (`npx wrangler deploy` in `embeddings-worker/`) to get the
   keep-warm cron live.
