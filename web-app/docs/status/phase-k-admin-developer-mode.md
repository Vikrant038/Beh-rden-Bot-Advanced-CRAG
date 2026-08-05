# Phase K — Admin Developer Mode for the Pipeline Tester

**Status:** implemented
**Scope:** `web-app` only — admin pipeline tester, never the end-user chat stream
**Date:** 2026-08-05

## What it does

The `/admin/pipeline-tester` page (ADMIN role gate) gains a **Developer mode** toggle next to
"Bypass cache". When a trace run fails:

- **Developer mode OFF (default):** behavior is unchanged — the client shows the generic tRPC
  error card with just `error.message` (`ErrorState`).
- **Developer mode ON:** `admin.testPipeline` rethrows the failure as a `TRPCError` whose message
  carries the **full detail** — error class name, raw message, `cause`, and stack trace. The page
  renders it in a scrollable monospace `<pre>` panel. The full detail (stack included) is also
  persisted on the FAILED `pipelineRun.error` row (bounded to 2000 chars), so the bug survives a
  page reload and shows in the recent-runs list tooltip.

## Why admin-only

- The chat stream (`api/chat/stream`) intentionally collapses provider/retrieval failures into a
  generic apology for end users. Nothing about this feature touches that path.
- The pipeline tester is behind `adminProcedure`/`adminLongProcedure`, so full stack traces are
  only ever surfaced to authenticated admins — a developer tool, not a leak.

## Implementation

| File | Change |
|------|--------|
| `src/server/routers/admin.ts` | `formatDebugError(error)` helper (name/message/cause/stack, `[UnknownError]` fallback for non-`Error`). `testPipeline` schema gains `debug: z.boolean().default(false)`; the catch block persists `detail` and rethrows a `TRPCError` with the full detail when `debug` is true, otherwise rethrows the original error unchanged. |
| `src/app/admin/pipeline-tester/page.tsx` | `debugMode` state, "Developer mode" switch (aria-label `Toggle developer mode`), passes `debug` into the mutation, renders the `<pre>` detail panel instead of `ErrorState` when `debugMode` and the mutation failed. |
| `tests/e2e/helpers/trpc-mock.ts` | Handlers that throw now answer a tRPC `INTERNAL_SERVER_ERROR` item (message + `data.stack`), so e2e tests exercise the real client error path. |
| `tests/unit/admin-test-pipeline.test.ts` | Debug-off keeps the plain message (no stack); debug-on rethrows name/message/cause/stack and persists the stack; `formatDebugError` unit cases. |
| `tests/e2e/pipeline-tester.spec.ts` | Developer-mode test asserts the full detail panel (message + cause + stack line) is shown when the toggle is on; a second test asserts no stack is shown when it is off. |

## Verification

- Full suite: **414/414** tests (51 files) pass.
- Coverage gate EXIT 0: Lines 85.36%, Statements 85.3%, Functions 82.37% (thresholds 80).
- `format:check`, `typecheck` (`tsc --noEmit`), `lint` (0 errors) all clean.

## Debug detail format

```
[Error] LLM provider down
Cause: Error: groq 429 rate limited
Stack:
Error: LLM provider down
    at runResearch (src/server/rag/agents/orchestrator.ts:42:9)
    ...
```
