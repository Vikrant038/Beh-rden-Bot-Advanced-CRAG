# Gates: Phase 12 — Chat UI

OWNS: web-app/src/app/chat/**, web-app/src/components/chat/**, web-app/src/hooks/use-chat.ts, web-app/src/lib/chat/types.ts

Scope: Audit and slim chat surfaces (interface, hook, layout, input, bubbles, types); dedupe dismissal/mode-menu patterns; all dependent tests updated; no commit.

- [x] G1: Typecheck passes
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && corepack pnpm typecheck 2>&1 | tail -1
  EXPECT: $ tsc --noEmit
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase12; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92; output-bytes=15

- [x] G2: Full suite green (baseline 82 files / 843 tests)
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && corepack pnpm vitest run 2>&1 | grep "Test Files"
  EXPECT: 82 passed (82)
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase12; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=f3431e163668801c6c612d137c40db1fc7475b76ba40bb7057ca969a992bd918; output-bytes=28

- [x] G3: Phase-12 chat files shrink below baseline 3145
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && test $(wc -l $(find src/app/chat src/components/chat src/hooks src/lib/chat -type f \( -name "*.ts" -o -name "*.tsx" \) ! -name "*.test.*") | tail -1 | awk '{print $1}') -lt 3145 && echo SHRUNK
  EXPECT: SHRUNK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase12; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=3705c30ca79a60c895e3591f0ab0d2dd8a3de7913f254a7387fc97aed47187ce; output-bytes=7
