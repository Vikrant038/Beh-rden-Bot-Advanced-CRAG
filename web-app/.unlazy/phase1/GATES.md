# Gates: Phase 1 — Config & env layer

OWNS: web-app/src/server/env.ts, web-app/src/config/app.ts, web-app/src/auth.config.ts, web-app/src/middleware.ts, web-app/tests/setup.ts

Scope: Slim and harden the config/env layer; fix the env-load test failures; no commit.

- [x] G1: Typecheck passes
  CHECK: corepack pnpm typecheck
  EXPECT: $ tsc --noEmit
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase1; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92; output-bytes=15

- [x] G2: No test file fails on env load (baseline 25 failed files)
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && corepack pnpm vitest run 2>&1 | grep "Test Files"
  EXPECT: 82 passed (82)
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase1; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=f3431e163668801c6c612d137c40db1fc7475b76ba40bb7057ca969a992bd918; output-bytes=28

- [x] G3: Phase-1 files shrink below 796 total lines (baseline 792 + setup)
  CHECK: wc -l src/server/env.ts src/config/app.ts src/auth.config.ts src/middleware.ts tests/setup.ts | tail -1
  EXPECT: total
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase1; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=98212ca344877dfa7b654dda8d4f8cc5da4dba4684453fca9cf24893c55d1fe3; output-bytes=289
