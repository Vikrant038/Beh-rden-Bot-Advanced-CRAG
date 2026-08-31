# Gates: Phase 15 — Sources & prefs & landing

OWNS: web-app/src/app/page.tsx, web-app/src/app/settings/**, web-app/src/app/login/**,
web-app/src/app/sources/**, web-app/src/components/landing/**, web-app/src/components/sources/**,
web-app/src/components/ui/radio-group.tsx (new shared primitive extracted this phase)

Scope: Audit landing page, source browser, login, settings, chat mockup; dedupe radiogroup
segmented controls, nav buttons, skeletons, section headings; all dependent tests updated; no commit.

- [x] G1: Typecheck passes
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && corepack pnpm typecheck 2>&1 | tail -1
  EXPECT: $ tsc --noEmit
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase15; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92; output-bytes=15

- [x] G2: Full suite green (baseline 82 files / 843 tests)
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && corepack pnpm vitest run 2>&1 | grep "Test Files"
  EXPECT: 82 passed (82)
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase15; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=f3431e163668801c6c612d137c40db1fc7475b76ba40bb7057ca969a992bd918; output-bytes=28

- [x] G3: Phase-15 files shrink below baseline 2015 (non-test files, incl. new radio-group.tsx helper)
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && test $(wc -l $(find src/app/page.tsx src/app/settings src/app/login src/app/sources src/components/landing src/components/sources src/components/ui/radio-group.tsx -type f \( -name "*.ts" -o -name "*.tsx" \) ! -name "*.test.*") | tail -1 | awk '{print $1}') -lt 2015 && echo SHRUNK
  EXPECT: SHRUNK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase15; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=3705c30ca79a60c895e3591f0ab0d2dd8a3de7913f254a7387fc97aed47187ce; output-bytes=7
