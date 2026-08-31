# Gates: Phase 8 — RAG pipeline core

OWNS: web-app/src/server/rag/pipeline.ts, web-app/src/server/rag/chat-pipeline.ts, web-app/src/server/rag/agents/orchestrator.ts

Scope: Audit and slim the three RAG pipeline entry files; shared helpers extracted where identical; all dependent code + tests updated; no commit.

- [x] G1: Typecheck passes
  CHECK: corepack pnpm typecheck 2>&1 | tail -1
  EXPECT: $ tsc --noEmit
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase8; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92; output-bytes=15

- [x] G2: Full suite green (baseline 82 files / 843 tests)
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && corepack pnpm vitest run 2>&1 | grep "Test Files"
  EXPECT: 82 passed (82)
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase8; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=f3431e163668801c6c612d137c40db1fc7475b76ba40bb7057ca969a992bd918; output-bytes=28

- [x] G3: Core RAG files shrink below baseline 1248
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && test $(wc -l src/server/rag/pipeline.ts src/server/rag/chat-pipeline.ts src/server/rag/agents/orchestrator.ts | tail -1 | awk '{print $1}') -lt 1248 && echo SHRUNK
  EXPECT: SHRUNK
  EVIDENCE: exit=0; shell=/bin/sh; EXPECT=matched; total=1242 (pipeline 373, chat-pipeline 405, orchestrator 464; baseline 396+406+446=1248)
