# Changelog

All notable changes to the Behörden-Bot web app are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning:
[SemVer](https://semver.org/).

## [Unreleased]

### Added

- **Full-viewport scroll-cinematic hero:** interactive, continuous camera flight
  landing experience (`ScrollWorld` & `scroll-engine.ts`) visualizing the 4 core
  stages of studying in Germany (Start $\to$ Documents $\to$ APS $\to$ Campus).
  Includes custom video scrubbing, live route dots, atmospheric background glow,
  session-aware CTAs, and a static 2×2 image grid fallback under `prefers-reduced-motion`.

- **Cloudinary CDN integration (`SCROLL_ASSETS_URL`):** external asset delivery
  for high-resolution still posters and transition video clips via Cloudinary CDN.
  Bypasses legacy `fetch() -> blob` memory buffering and leverages direct browser
  HTTP 206 Partial Content (Range requests) for instant streaming playback (<300ms).

- **Mobile touch & hardware decoder optimizations:**
  - **Dynamic Mobile Streams:** Cloudinary automatic transformations (`f_auto,q_auto:eco,w_720,vc_h264`)
    deliver lightweight 720p streams on touch/mobile viewports, reducing video payload and GPU decoder RAM by ~60–70%.
  - **Lazy Active Priming:** single-active video lazy priming on user gesture and section transitions,
    preventing mobile GPU stalls from spinning up 7 concurrent decoder pipelines.
  - **Optimized RAF Seeking:** skips seeking on non-visible segments during scroll on mobile, with an increased
    seek tolerance threshold (`eps = 0.035`) preventing hardware queue congestion.
  - **Compositor Relief:** disabled continuous drifting background particles and replaced expensive
    `backdrop-filter: blur(...)` with performant solid RGBA backgrounds on touch viewports.

- **Unified color harmony (Light/Dark themes):** integrated the diorama video
  palette across the entire application — Warm Diorama Porcelain (`#fbf9f5`) in Light mode
  and Velvet Obsidian (`#0f0d13`) in Dark mode, with glowing section accents
  (Start `#7c3aed`, Documents `#2563eb`, APS `#059669`, Campus `#d97706`) applied to buttons,
  cards, route indicators, and badges.

### Security

- **AST raw HTML injection hardening:** refactored `scroll-engine.ts` and `scrub-engine.js`
  to replace all string-interpolated `.innerHTML` assignments with type-safe DOM APIs
  (`document.createElement`, `element.textContent`, `element.appendChild`), resolving all
  Semgrep `javascript.express.security.injection.raw-html-format` alerts.

### Changed

- **Pipeline trace stages are now fully tappable:** the entire StageNode header
  row toggles open/close (not just the chevron), the chevron is pinned to the
  far-right beside the status tick (both `shrink-0`, so they never fight for
  space), and long stage titles truncate instead of wrapping — fixing the
  misaligned rows on narrow phone screens. Keyboard accessible with
  `aria-expanded` + `aria-controls`.

- **Dense-search latency:** the agentic orchestrator no longer embeds the query
  when the semantic cache is bypassed (the admin pipeline tester's default) —
  the vector was only needed for the cache lookup/write, so every glass-box run
  previously paid a full embedding round-trip for nothing. On a cold Cloudflare
  Worker that was a 10–20s model load showing up as the "Dense Search
  (pgvector)" stage. The HfEmbeddingClient also gained a bounded in-memory
  batch cache (exact-text key, 1h TTL, ≤2048 entries) so repeated queries and
  expanded sub-queries are instant Map hits, and the embeddings worker now
  self-warms the bge-m3 model via a 5-minute cron so the first real query
  doesn't pay the cold start.

### Added

- **Session-aware landing-page CTAs:** the landing page now checks the session
  (`useSession`) — "Get started" / "Start asking" route to `/chat` when signed
  in (instead of bouncing to `/login` on every visit from the home button) and
  fall back to `/login` when logged out. "Browse the knowledge base" deep-links
  to `/sources` for signed-in users. The login page also redirects
  already-authenticated users straight to `/chat`, unless an OAuth `error`
  param is present so error banners stay visible. Unit tests cover the CTA
  hrefs, the redirect, the OAuth error path, and the guest-browsing flow.

- **Pipeline tester run retention:** the background worker now keeps only the
  newest 5 pipeline-test runs and prunes older rows (best-effort) after each
  run reaches a terminal state, so `traceJson` history on the `PipelineRun`
  table stays bounded. RUNNING rows are never deleted while the UI may still
  be polling them.

- **Responsive mobile UI upgrade (320–480px):** 44px touch targets across
  navbars, CTAs, FAQ rows, and admin controls; safe-area padding for notched
  phones; `overflow-x: clip` against horizontal page scroll; no grey tap
  highlight; 16px form inputs so iOS Safari stops auto-zooming; hover-only
  reveals always show on touch devices; heading type scales down; markdown
  tables/code stay swipeable; mobile menu closes on Escape/route change. See
  `docs/ROADMAP.md` §2 (Archived plans — responsive checklist).

- **Seed corpus hardening:** `scripts/seed-corpus.sh` now guards the
  `document_chunks_embedding_idx` pgvector HNSW index the same way it guards
  the FTS GIN index — a data-only seed on a target without the index now
  creates it, so dense retrieval never silently degrades to a full sequential
  scan.

- **Coverage gate closure:** `vitest.config.mts` raises the gate to 85%
  across statements/branches/functions/lines and adds a branch threshold;
  new unit tests for the landing page, login content, and theme toggle bring
  global coverage to 92%+ statements / 85%+ branches (592 tests).

- **Developer mode for the admin pipeline tester (Phase K):** the `/admin/pipeline-tester`
  page gains an admin-only **Developer mode** toggle next to "Bypass cache". When enabled,
  `admin.testPipeline` rethrows failures with the full error detail — class name, raw message,
  `cause`, and stack trace (via the new `formatDebugError`) — and the page renders it in a
  scrollable `<pre>` panel instead of the generic error card. The full detail (including the
  stack) is also persisted on the FAILED `pipelineRun` row. Off by default; end-user chat
  errors never flow through this path (ADMIN gate only). See
  `docs/status/phase-k-admin-developer-mode.md`.

- **Bilingual query expansion + retrieval latency optimization (Phase J):**
  `generateSubQueries` now returns a deterministic `2+2` EN/DE alternative split via a structured
  JSON response (one LLM call), and `HybridRetriever.retrieve` embeds **all** sub-queries in a
  **single batched** request to the Cloudflare worker (query-embedding only) and runs the dense
  pgvector lookups in **parallel**. Rationale: the corpus is ~2/3 English / ~1/3 German and BM25 is
  lexical, so English-only sub-queries left the German half unmatched and tripped CRAG web fallback;
  batching collapses ~6 sequential worker round-trips per turn to 1. See
  `docs/status/phase-j-bilingual-retrieval-latency.md`.

- **Phase 4 test coverage:** unit tests for `pdf-parser` (empty buffer, image-only,
  >200 pages, parse failure), scraper content-type rejection (JSON/PDF/missing header,
  charset acceptance, Content-Length + decoded-body caps), `chunkParentChild`
  (parent/child caps, parent overlap, short-parent fallback), `pdfSourceKey` stability,
  `expandToParents` (dedupe, flat pass-through, missing parent), and `admin.testPipeline`
  (ADMIN gate, min-length validation, full trace with child/parent snippets, no
  ConversationMemory/message/conversation writes, guardrail-blocked + cache-hit
  responses). E2E specs added for the pipeline tester (4 stages, child→parent
  expansion, guardrail BLOCKED short-circuit, cache-hit badge) and PDF upload
  (valid PDF, server 413, image-only 422, client-side >4 MB rejection), backed by
   hand-generated `tests/e2e/fixtures/{valid-guide,image-only}.pdf`. Full suite now
   280 tests / 41 files; verification guide archived at `docs/ROADMAP.md` §2.

- **Pipeline visualizer (admin):** `admin.testPipeline` runs the full 3-agent ReAct
  pipeline glass-box with `NoopMemory` + `bypassCache`, returns a full trace
  (`maskedQuery`, `guardrail`, research steps, analyst matrix, parent-expanded
  sources). New `/admin/pipeline-tester` page renders a GitHub-Actions-style
  Stage 0→3 timeline: masked query + guardrail verdict, ReAct steps, matched-child
  snippet → expanded-parent context, comparison matrix, and the final markdown answer.
  `Source` now carries optional `childText`/`parentText` so the child→parent
  expansion is visible. Added `adminLongProcedure` (60 s `withTimeout` middleware);
  the tRPC route handler runs on the Node runtime with `maxDuration = 60`.

### Fixed

- **Semantic cache race condition:** replaced findUnique+INSERT two-step write with a
  single atomic `INSERT … ON CONFLICT ("queryHash") DO UPDATE`, eliminating the TOCTOU
  race that could cause a unique-constraint crash under concurrent load.
- **No-op conversation update:** replaced `prisma.conversation.update({ data: {} })` in
  `chat-pipeline.ts` with an explicit `data: { updatedAt: new Date() }` to remove the
  unnecessary SQL write while still bumping the timestamp.
- **BM25 O(doc_length) scoring:** `BM25Okapi` now pre-computes per-document
  term-frequency maps at construction time; `getScore` is now O(query_length) instead
  of O(query_length × doc_length).
- **Semantic cache missing HNSW index:** added pgvector HNSW index on
  `semantic_cache.queryVector` via migration `20260802_add_semantic_cache_hnsw_index`.
  Cosine similarity lookups are now ANN instead of a sequential scan.
- **CSP `script-src unsafe-inline`:** replaced the static `unsafe-inline` in
  `script-src` with a per-request cryptographic nonce generated in `middleware.ts` and
  embedded in the CSP header at response time. `style-src` retains `unsafe-inline`
  (Tailwind CSS v4 requirement, logged in `SECURITY_EXCEPTIONS.md`).
- **Mode toggle hardcoded to agentic:** `modeRef` in `chat-interface.tsx` replaced with
  proper `useState`; `ChatInput` now renders a Standard/Agentic toggle that persists the
  selection across messages in the session.
- **Double user-message persistence:** removed the redundant `chat.sendMessage` tRPC
  mutation call from `useChat.sendMessage`; the SSE pipeline's `findOrCreateUserMessage`
  is the single authoritative write path.
- **Guardrail prompt injection:** guardrail now splits the system instructions and user
  query into separate system/user messages, truncates the query to 500 chars, and wraps
  it in `<user_query>` XML delimiters with an explicit data-vs-instruction notice to
  raise the bar for instruction-override attacks.
- **Vector raw SQL scattered across callers:** created `src/server/db/vector-queries.ts`
  as the single source of truth for all pgvector `$queryRaw`/`$executeRaw` calls.
  `dense.ts` and `semantic-cache.ts` now delegate to `vectorQueries.*` — no inline SQL
  outside this module.
- **`Message.sources` unvalidated at read boundary:** replaced the untyped
  `parseJsonArray` cast in `conversation.ts` with a Zod-validated `parseSourcesJson`
  that enforces the `ChatSource` shape and returns `[]` on malformed data. Added
  explanatory JSDoc documenting the deliberate `Json?` trade-off and when to revisit.
- **`stop()` partial message lost on reload:** added `chat.savePartial` tRPC mutation;
  `stop()` now captures accumulated tokens and persists them as an ASSISTANT message
  with `metadata: { partial: true }` — partial responses survive conversation reload.
- **No retry on stream failure:** `sendMessage` in `use-chat.ts` now retries up to 2
  times with exponential backoff (500 ms → 1 000 ms) for transient 5xx / network
  errors. 4xx errors (auth, validation, rate-limit) are not retried.
- **Ingest no backpressure guard:** added `IngestQueue` (serial async queue, configurable
  concurrency, `drain()` API) and updated `syncAllDocuments` to process one document at
  a time, protecting the HF Inference API from burst-embedding and staying within the
  Vercel 60 s function timeout.
- **`pdf-parse` version unpinned:** changed `"pdf-parse": "^1.1.1"` to exact pin
  `"1.1.1"` in `package.json` to prevent silent upgrades of an unmaintained library.
- **`duck-duck-scrape` tightly coupled:** introduced `WebSearchProvider` interface,
  `DuckDuckGoProvider` wrapper (dynamic import), `ACTIVE_PROVIDER` singleton, and
  `setWebSearchProvider()` for runtime swapping. Migration to Brave Search / Tavily is
  now a one-line change; call sites are unchanged.

### Changed

- **Circuit breaker + rate limiter:** added prominent `⚠️ SERVERLESS LIMITATION`
  comments to `CircuitBreaker` and `RateLimiter` explaining that in-process state does
  not persist across Vercel cold starts. `UPSTASH_REDIS_URL` + `UPSTASH_REDIS_TOKEN`
  must be set in production.
- **`next.config.ts` CSP moved to middleware:** the static `Content-Security-Policy`
  header has been removed from `next.config.ts`; the nonce-bearing CSP is now set
  exclusively by `src/middleware.ts` on each request.

### Added

- CI/CD: GitHub Actions workflows for CI, E2E, security scans (Gitleaks,
  Semgrep, CodeQL, SBOM), and Vercel deploy.
- Husky pre-commit hooks: lint-staged (ESLint + Prettier), TypeScript
  typecheck, and a lightweight secret scan.
- Playwright E2E suite covering landing page, route guards, chat streaming,
  history search, and the admin role guard.
- Project README and this changelog.

### Changed

- `Message` model: added `@@index([role, createdAt])` to speed up the admin
  dashboard's raw-SQL aggregates (`metrics`, `dailyQueries`, `modeSplit`,
  `recentQueries`).

## [0.1.0] - 2026-07-30

### Added

- Phase D foundation: admin dashboard (metrics, daily queries, mode split,
  recent queries), URL ingest pipeline and CLI, cache cleanup cron
  (`/api/cron/cleanup-cache`), Langfuse tracing, health check API, and
  startup documentation.
- Phase C chat UI: streaming chat interface, tRPC routers (conversation, chat,
  sources, admin), SSE endpoint (`POST /api/chat/stream`), disambiguation
  cards, pipeline status indicators, and semantic cache integration.
- Phase A/B foundation: Auth.js v5 (GitHub, Google, Resend magic link), Prisma
  - PostgreSQL schema with pgvector, protected routes, settings, sources, and
    history pages.
- Test infrastructure: Vitest unit + integration suites with mock Prisma,
  coverage thresholds (≥80%).

[0.1.0]: https://github.com/anomalyco/behoerden-bot
