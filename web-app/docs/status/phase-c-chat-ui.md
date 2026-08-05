# Phase C — Chat UI, tRPC Routers & SSE Streaming

**Status:** COMPLETE (pending user verification)
**Date:** 2026-08-01
**Branch:** `web-app`
**Scope:** ROADMAP TASK-029..036

## Summary

The tRPC API surface, the SSE chat-streaming endpoint, the `useChat` client hook, and the full chat/history/settings/landing UI are implemented and wired into the Next.js app. The empty Phase-B `appRouter` stub is now the real router (chat, conversation, source, document, admin). 164 tests pass (unit + integration + jsdom component) at 86%+ line/function/statement coverage.

## Tasks Delivered

| Task | Deliverable | Status |
|---|---|---|
| TASK-029 | Five tRPC routers (`src/server/routers/{chat,conversation,source,document,admin}.ts`) attached to `appRouter`; DomainError codes mapped through `errorFormatter`; tRPC instance extracted to `src/server/trpc/t.ts` to break the import cycle | Done |
| TASK-030 | SSE chat endpoint `src/app/api/chat/stream/route.ts`: nodejs runtime, auth-guarded (401), `chatRateLimiter` (429 + resetInSeconds), zod body (`conversationId`, `query` ≤2000, `mode`, `bypassCache`), `text/event-stream` + `X-Accel-Buffering: no`, aborts on client disconnect | Done |
| TASK-031 | `src/hooks/use-chat.ts`: fetch ReadableStream SSE consumer (`STREAMING_ID` placeholder, `sendMessage` mutation→stream→invalidate, `regenerate` with `bypassCache`, `stop`, `resetMessages`, error + disambiguation state, `onNotFound`) | Done |
| TASK-032 | Chat UI (`src/components/chat/*`): `chat-interface`, `message-bubble`, `chat-input`, `pipeline-status`, `disambiguation-cards` (framer-motion stagger), `source-citation` (collapsible, score %), `streaming-text`, `markdown` (react-markdown + GFM), `chat-layout` (desktop sidebar + mobile drawer) | Done |
| TASK-033 | Sidebar (`src/components/sidebar/{app-sidebar,conversation-item}.tsx`): infinite page of 30, relative time, message counts, mode badge, double-click-confirm delete | Done |
| TASK-034 | History page (`src/components/history/history-list.tsx`): search (Enter-triggered), IntersectionObserver infinite scroll, Markdown export download, delete | Done |
| TASK-035 | Pages + auth + providers: `/chat`, `/chat/[id]` (auto-create + `notFound()` guard), `/history`, `/settings`, `/login`, landing (`app/page.tsx`), `src/lib/trpc/{client,provider}.tsx`, providers in `app/layout.tsx`, `globals.css` design tokens + markdown-body + streaming-cursor + status-pulse | Done |
| TASK-036 | `src/server/rag/chat-pipeline.ts` `runChatStream` orchestration: ownership → dedupe user message → auto-title → Stage-0B disambiguation → Stage-0A guardrail → standard/agentic pipeline → persist assistant → token stream → done | Done |

## Quality Gates

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm typecheck` | PASS |
| Lint | `pnpm lint` | PASS (0 errors, 0 warnings) |
| Build | `pnpm build` | PASS |
| Format | `pnpm format:check` | PASS |
| Unit + integration + component tests | `pnpm test` | PASS (164 tests, 27 files) |
| Coverage | `pnpm vitest run --coverage` | PASS (lines 86.62%, functions 86.56%, statements 86.54% vs 80% threshold) |

New tests: `tests/unit/{conversation-router,chat-router,source-router,admin-router}.test.ts` (25 cases), `tests/integration/{chat-stream,chat-stream-route}.test.ts` (13 cases), `src/components/chat/{message-bubble,pipeline-status,chat-input}.test.tsx` (19 jsdom cases), plus shared `tests/helpers/mock-prisma.ts` (structural `MockPrisma` type — `vi.mocked(prisma)` cannot unwrap Prisma delegate generics).

## Decisions & Exceptions

- **Streaming model:** the pipeline runs synchronously first (produces the full answer), then `streamTokens` reveals pre-computed text as 3-word chunks every 24ms. Status events keep the status bar live; avoids fighting Vercel event-loop limits and gives deterministic replays.
- **Disambiguation (Stage-0B) short-circuits** before any pipeline work: emits a `disambiguation` event with 3 options and stops — no assistant message is persisted.
- **Guardrail block (standard mode)** persists the out-of-domain message as a real assistant message (`metadata.blocked: true`, `retrievalPath: "GUARDRAIL_BLOCKED"`), streams it, then `done`.
- **User-message dedupe:** `findOrCreateUserMessage` reuses an identical trailing USER message so the tRPC mutation persist and the SSE-route persist never double-insert on retries.
- **Pipeline failure** persists a generic error assistant message (`retrievalPath: "PIPELINE_ERROR"`), emits `error`, streams it, then `done` — the client always terminates with `done`.
- **tRPC instance moved to `src/server/trpc/t.ts`**: `router.ts` now imports the feature routers, so routers importing `router`/`protectedProcedure` from `router.ts` would form a circular import (TDZ crash — caught by the router tests).
- **Prisma mock typing:** tests cast the mocked `@/server/db` export to a structural `MockPrisma` type because `vi.mocked(prisma)` leaves delegate methods as raw generic functions (TS2339).
- **`conversation.delete` is a hard delete** (Prisma cascade) despite the plan mentioning soft-delete; `conversation.export` is a tRPC query returning `{ markdown }`.
- **`document.sync` / `document.ingestUrl` are Phase-D-gated** — they throw `ValidationError` rather than half-implementing URL scraping/embedding.
- **Admin metrics** aggregate Message metadata JSONB via raw SQL (`metadata->>'isCached'`, `(metadata->>'latencyMs')::float`) with `.catch` fallback to zeros.
- **lucide-react ships no brand icons** in the installed version — the login page uses `GitBranch`/`AtSign` instead of `Github`/`Chrome`.
- **SSE is plain `POST /api/chat/stream`** (not tRPC subscriptions) — WebSockets are not Vercel-compatible; next.config CSP `connect-src 'self'` already permits the same-origin route.
- No local Postgres: all DB paths exercise mocked Prisma; `.env` placeholders keep `env.ts` zod validation passing; migrations apply via `prisma migrate diff --from-empty` and target Neon at deploy.

## Notes for Next Phase

- Phase D (TASK-037..039) wires `document.sync` + `document.ingestUrl` (URL scraping, chunking, embedding, corpus invalidation) and Langfuse tracing.
- The chat UI surfaces `metadata.retrievalPath`, `isCached`, and `blocked` badges; admin metrics (cache hit rate, latency) render in Phase D's admin dashboard.
- Playwright `test:e2e` is configured but no specs exist yet — needs a seeded DB to run end-to-end.

## Verification

Waits on user verification of this push before Phase D begins (TASK-037..039).

### Recent Fixes (2026-08-01)
- Fixed a bug where `useChat` would instantly clear `disambiguationOptions` when TRPC refetched the conversation.
- Fixed error event parsing in `handleEvent` so that pipeline errors (e.g. LLMProviderError) correctly render as a red error message bubble instead of a blank UI.
