# Gates: Phase 10 — Server lib & misc

OWNS: web-app/src/server/lib/**, web-app/src/server/trpc/**, web-app/src/server/pii/**, web-app/src/server/tracing.ts, web-app/src/config/app.ts, web-app/src/server/{auth,guest,env,db}.ts, web-app/src/server/db/{vector-queries,mapping,analytics}.ts

Scope: Audit and slim the shared server infrastructure (lib helpers, tRPC plumbing, PII, tracing, config, env, db helpers); dedupe repeated patterns; all dependent code + tests updated; no commit.

- [x] G1: Typecheck passes
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && corepack pnpm typecheck 2>&1 | tail -1
  EXPECT: $ tsc --noEmit
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase10; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=8366207267355d3e3d5bf3bf6e8c94c5f93f6078c34f08973fa2b38cdda6cc92; output-bytes=15

- [x] G2: Full suite green (baseline 82 files / 843 tests)
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && corepack pnpm vitest run 2>&1 | grep "Test Files"
  EXPECT: 82 passed (82)
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase10; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=f3431e163668801c6c612d137c40db1fc7475b76ba40bb7057ca969a992bd918; output-bytes=28

- [x] G3: Phase-10 server lib files shrink below baseline 2359 (excl. deleted response.ts)
  CHECK: cd /Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app && test $(wc -l src/config/app.ts src/server/db/vector-queries.ts src/server/db/analytics.ts src/server/db/mapping.ts src/server/db.ts src/server/env.ts src/server/auth.ts src/server/guest.ts src/server/tracing.ts src/server/trpc/t.ts src/server/trpc/context.ts src/server/trpc/router.ts src/server/pii/masker.ts src/server/lib/security/url-validator.ts src/server/lib/security/rate-limiter.ts src/server/lib/account-linking.ts src/server/lib/conversation-policy.ts src/server/lib/changelog.ts src/server/lib/logger.ts src/server/lib/errors/*.ts | tail -1 | awk '{print $1}') -lt 2359 && echo SHRUNK
  EXPECT: SHRUNK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/vikranty/.traycer/worktrees/vikrant038__beh-rden-bot-advanced-crag/traycer-silent-lynx-cb0149453ef1/web-app/.unlazy/phase10; path=b1f540f22f86/19 entries; EXPECT=matched; output-sha256=3705c30ca79a60c895e3591f0ab0d2dd8a3de7913f254a7387fc97aed47187ce; output-bytes=7
