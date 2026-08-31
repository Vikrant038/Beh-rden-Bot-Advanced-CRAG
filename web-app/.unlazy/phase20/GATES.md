# Gates: Phase 20 — Python MVP + docs

OWNS: mvp-python/**, docs/**, README.md, CONTRIBUTING.md, AGENTS.md, SECURITY.md,
web-app/README.md, web-app/CHANGELOG.md, scratch/**

Scope: Audit the Python reference MVP and all markdown docs; drop stale/duplicated
planning docs, fix dead file references, slim redundant README sections; Python code
untouched unless clearly dead; no commit.

- [x] G1: Typecheck passes
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && corepack pnpm typecheck 2>&1 | tail -1
  EXPECT: $ tsc --noEmit
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase20; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92; output-bytes=15

- [x] G2: Full suite green (82 files; 842 passing)
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && corepack pnpm vitest run 2>&1 | grep "Test Files"
  EXPECT: 82 passed (82)
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase20; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=f3431e163668801c6c612d137c40db1fc7475b76ba40bb7057ca969a992bd918; output-bytes=28

- [x] G3: Docs+MVP markdown shrinks below baseline 6926 (docs/*.md, root *.md, web-app/README.md, web-app/CHANGELOG.md, mvp-python/**/*.md)
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1 && test $(wc -l docs/*.md README.md CONTRIBUTING.md AGENTS.md SECURITY.md web-app/README.md web-app/CHANGELOG.md $(find mvp-python -name "*.md") | tail -1 | awk '{print $1}') -lt 6926 && echo SHRUNK
  EXPECT: SHRUNK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase20; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=3705c30ca79a60c895e3591f0ab0d2dd8a3de7913f254a7387fc97aed47187ce; output-bytes=7
