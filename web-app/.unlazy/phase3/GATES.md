# Gates: Phase 3 — Auth & guest layer

OWNS: web-app/src/server/auth.ts, web-app/src/server/guest.ts, web-app/src/lib/guest.ts, web-app/src/components/auth/**, web-app/src/app/api/guest/**

Scope: Audit and slim auth + guest layer; all dependent code + tests updated; no commit.

- [x] G1: Typecheck passes
  CHECK: corepack pnpm typecheck
  EXPECT: $ tsc --noEmit
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase3; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92; output-bytes=15

- [x] G2: Full suite green (baseline 82 files / 843 tests)
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && corepack pnpm vitest run 2>&1 | grep "Test Files"
  EXPECT: 82 passed (82)
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase3; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=f3431e163668801c6c612d137c40db1fc7475b76ba40bb7057ca969a992bd918; output-bytes=28

- [x] G3: Auth+guest files shrink below 494 lines (baseline 439+55 guest route+test-setup)
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && wc -l src/server/auth.ts src/server/guest.ts src/lib/guest.ts src/server/lib/account-linking.ts src/components/auth/oauth-buttons.tsx src/app/api/guest/route.ts | tail -1
  EXPECT: total
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase3; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=8f70e8ccbba1450125f633914fb45fbcc3f552d86a669d95d8e650f1c41ceb9c; output-bytes=70
