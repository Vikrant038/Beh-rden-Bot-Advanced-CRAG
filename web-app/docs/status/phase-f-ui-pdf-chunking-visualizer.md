# Phase F — Global UI Overhaul, URL Validation Hardening, PDF Ingestion, Parent-Child Chunking & Pipeline Visualizer

**Status:** IN PROGRESS (Phases 0–2 complete; Phase 3 in progress)
**Date:** 2026-08-01
**Branch:** `web-app`
**Scope:** IMPLEMENTATION_PLAN.md Phases 0–4 (approved plan)

## Summary

The approved phase-D/E follow-up plan is being executed in four phases. Phase 0 (URL content-type validation hardening), Phase 1 (parent-child chunking + PDF ingestion), and Phase 2 (dual-palette UI overhaul) are implemented and verified: typecheck clean, lint clean, build clean, and the full test suite is green (37 files / 236 tests). Phase 3 (pipeline visualizer) is in progress — the orchestrator trace enrichment, `admin.testPipeline` router procedure, and tRPC route duration are done; the visualizer page and stage components remain. Phase 4 (tests & CI hardening) remains.

## Phase Status

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 0 | URL content-type validation, new domain errors, tRPC error plumbing | DONE (verified) |
| Phase 1 | Parent-child chunking + PDF ingestion (schema, chunker, parser, pipeline, upload route, dropzone) | DONE (migration unverified — no DB in sandbox) |
| Phase 2 | Two distinct light/dark palettes, glassmorphism, animated mesh, landing content, edge-case states | DONE (verified) |
| Phase 3 | `admin.testPipeline` tRPC endpoint, trace enrichment, pipeline visualizer page + stage components, nav entry | IN PROGRESS (backend done; page/components pending) |
| Phase 4 | Unit tests (pdf-parser, scraper content-type, expandToParents, pdfSourceKey, testPipeline), e2e, full gates | PENDING |

## Deliverables (Phase 0, 1 & 2)

| Area | Deliverable |
|------|-------------|
| Error plumbing | `INVALID_CONTENT_TYPE` (415) + `PDF_PARSE_FAILED` (422) codes in `src/server/lib/errors/codes.ts`; `InvalidContentTypeError` + `PdfParseError` in `src/server/lib/errors/domain-error.ts` |
| SSRF / content guards | `src/server/ingest/scraper.ts`: strict MIME allowlist (`text/html`, `text/plain`), `Content-Length` + decoded-byte caps, post-redirect `assertSafeUrl` |
| Schema | `DocumentParentChunk` model + nullable `DocumentChunk.parentId` in `prisma/schema.prisma`; `prisma validate`/`generate` pass; handwritten migration `prisma/migrations/20260801_add_parent_child_chunks/migration.sql` (unverified against real pgvector DB) |
| Chunking | `chunkParentChild()` in `src/server/ingest/chunker.ts` (2000-char parents, 200-char children, 200/50 overlap); `Chunk.childText?`/`parentId?` |
| Retrieval | `expandToParents()` in `src/server/rag/retrieval/join.ts` (dedupes by `parentId`, preserves best child score); wired into `hybrid.ts` post-rerank; `parentId` selected in `dense.ts`/`corpus.ts`; CRAG gate still uses child `crossScore` |
| PDF parser | `src/server/ingest/pdf-parser.ts` (imports `pdf-parse/lib/pdf-parse.js`, `MAX_PDF_PAGES=200`, guards); `src/types/pdf-parse.d.ts` local submodule type declaration |
| Pipeline | `src/server/ingest/pipeline.ts`: `persistIngested()`, `ingestPdf()`, `pdfSourceKey()` = `pdf://<sha256-prefix16>/<sanitized-name>`, `storeDocument()` v2 (transactional parent + child inserts, legacy-parent cleanup, count updates, embedding invalidation) |
| Upload route | `src/app/api/admin/documents/upload/route.ts`: ADMIN gate (403), 4 MiB cap (413), MIME/empty checks (415/400), parse failure (422), `maxDuration=60` |
| Dropzone | `src/components/admin/document-manager.tsx`: rewritten dropzone with 4 MB client mirror + typed error feedback |
| Dual palettes | `src/app/globals.css`: warm "Paper & Ink" light theme + deep "Midnight" dark theme (fully distinct token values), `.glass-card`, animated `.gradient-mesh` via `--color-mesh-a/b/c`, `@supports not (backdrop-filter)` fallback, `prefers-reduced-motion` guard killing mesh/shimmer/pulse |
| UI primitives | `src/components/ui/`: `glass-card.tsx`, `skeleton.tsx` (aria `status`), `empty-state.tsx`, `error-state.tsx` (typed `code` + retry), `theme-toggle.tsx` (light/dark/system, compact mode) |
| Landing page | `src/app/page.tsx`: hero + features restyled as glass cards, 4 new `CONTENT_SECTIONS` (Guides / Universities / Finances / Timelines) with eyebrow + CTA |
| Wiring | `app-sidebar.tsx` (compact ThemeToggle footer, `text-primary-foreground`), `settings/page.tsx` (Appearance section), `admin/layout.tsx` (mesh accent + focus-visible), `source-browser.tsx` (Skeleton/EmptyState) |

## Quality Gates (as of 2026-08-01)

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `pnpm typecheck` | PASS |
| Lint | `pnpm lint` | PASS (0 errors; pre-existing `.lintstagedrc.mjs` warning only) |
| Build | `pnpm build` | PASS (fixed route-export error: `MAX_PDF_BYTES`/`ACCEPTED_MIME` moved to `pdf-parser.ts`) |
| Unit + integration + component tests | `pnpm test` (with dummy `DATABASE_URL` + `NEXTAUTH_SECRET`) | PASS (236 tests, 37 files) |

## Decisions & Exceptions

- **4 MiB / 4 MB cap everywhere** — Vercel rejects bodies > 4.5 MB before the handler runs; a single number server-side (4,194,304 B) and client-side (4 MB).
- **ADMIN-only PDF ingestion** — the upload route gates on `session.user.role === "ADMIN"` (403 otherwise) because ingestion mutates the shared knowledge base.
- **True parent-child chunking** — children (~200 ch) embedded and searched; on match the parent (~2000 ch) is handed to the LLM. `chunkCount` = child count; `parentCount` exposed in `IngestResult`.
- **Local submodule typings** — `@types/pdf-parse` only covers the package root, so `src/types/pdf-parse.d.ts` declares `pdf-parse/lib/pdf-parse.js`; explicit cast on `mod.default` unifies the options-param type.
- **`parentId` nullable** — legacy flat chunks stay valid; backfill path is `pnpm ingest --sync --force`.
- **Two independent palettes** — light "Paper & Ink" and dark "Midnight" share token names but not values; mesh hues drift per theme (`--color-mesh-a/b/c`); motion killed under `prefers-reduced-motion`.
- **Orchestrator trace enrichment** — `AgenticRagResponse` gains `maskedQuery` + `guardrail` (populated at cache-hit / guardrail-blocked / success return sites via `withStageZero` helper); orchestrator memory type loosened to structural `MemoryLike` so `NoopMemory` can be injected.
- **`NoopMemory`** — explicit side-effect-free memory so `admin.testPipeline` never writes a ConversationMemory row with a dangling FK.
- **`maxDuration = 60`** on the tRPC route handler (pipeline tests issue 3–5 sequential LLM calls).
- **No DB in sandbox** — `docker`/`psql`/port 5432 unavailable; the handwritten migration is unverified against pgvector. Test env is injected on the command line because `.env` is absent.

## Known Issues / Blockers

- **Migration not applied** to a real database (`pnpm prisma migrate dev --name parent_child_chunks` + `pnpm ingest --sync --force` backfill pending DB availability).
- **Tests require env vars** — `tests/setup.ts` loads `.env` (absent); full suite needs `DATABASE_URL` + `NEXTAUTH_SECRET` injected. CI workflow should supply these.

## Next Steps

- [ ] Phase 3: pipeline visualizer — `src/app/admin/pipeline-tester/page.tsx` + `src/components/admin/pipeline/` (`pipeline-visualizer.tsx`, `stage-node.tsx`, `react-step.tsx`, `source-panel.tsx`), admin nav item. (Backend done: `admin.testPipeline`, orchestrator trace enrichment, `maxDuration=60` tRPC route.)
- [ ] Phase 4: unit tests (`pdf-parser`, `scraper` content-type, `expandToParents`, `pdfSourceKey`, `testPipeline` no-memory-write), e2e, full `lint/typecheck/test` run.
- [ ] Apply migration to real DB when available (`pnpm prisma migrate dev --name parent_child_chunks`) and run `pnpm ingest --sync --force` backfill.
