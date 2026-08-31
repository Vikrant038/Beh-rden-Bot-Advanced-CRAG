# Behoerden-Bot — Roadmap & Consolidated Plans

> **Source of truth:** `../../docs/WEB_APP_PLAN.md` (user-approved RFC) and `../../docs/basic-prompt/{GUARDRAILS,CODING_STANDARDS,PIPELINE_OPS,prompt_design}.md`. (The original `mvp-python/docs/EXISTING_PROJECT_ANALYSIS.md` snapshot was removed in the docs cleanup; the analysis it carried now lives in `docs/ARCHITECTURE_SUMMARY.md`.)
> **Risk tier:** Commercial/Production — all pillars/modules enforced.
> **Purpose:** Single home for the still-open workstreams and the archived (completed) implementation/enhancement plans. Per-phase delivery records live in [`docs/status/`](./status/); the Phase-5 TDD design doc is kept at [`docs/TEST_DESIGN.md`](./TEST_DESIGN.md); quality strategy is in `../../docs/TESTING_AND_QUALITY.md`.
> **Consolidated:** 2026-08-11 — folded in `PLAN_LANDING_MOBILE_GUEST_TESTS_PROMPTS.md` and archived `IMPLEMENTATION_PLAN.md`, `UI_UX_ENHANCEMENT_PLAN.md`, `TESTING_PHASE4.md`, `responsive-ui-upgrade-checklist.md`.

---

## 1. Open Workstreams

> Folded in verbatim from `PLAN_LANDING_MOBILE_GUEST_TESTS_PROMPTS.md` (authored 2026-08-10, "PLANNING ONLY"). Each workstream is independently shippable and testable; suggested execution order in §1.6.

### 1.1 A — Landing Page Redesign

**Status (verified 2026-08-11):** Not started — `src/app/page.tsx` is still the dense ~760-line layout this workstream targets.

**Problem:** The landing is a long, dense page: sticky nav, hero, aurora, chat mockup, 4 stat cells, "See it in action" photo, 3-step How-it-works, 6 feature cards, corpus, 12 topic chips, FAQ, final CTA, footer. Overwhelming; the value prop is buried.

**Goal:** a new visitor understands *what this is, who it's for, how to start* within 5 seconds.

**Design principles**
1. One clear message above the fold + one primary CTA ("Start asking").
2. Lead with the working product — the chat mockup high, not below the fold.
3. Progressive disclosure — collapse depth behind tabs/accordions/anchors.
4. **Keep the trusted brand assets** (user explicitly named them): graduation-cap logo, the `ChatMockup` (already has "sample" removed), and `hero-image.jpeg`. Do not remove.
5. Mobile-first (ties into §1.2 B).

**Proposed structure**
```
Landing (mobile-first)
├── Sticky minimal nav (logo + "Start" only)
├── HERO (above fold)
│   ├── H1: "Your AI guide to studying in Germany"
│   ├── Sub: "Visas, APS, blocked accounts, university — answered from official sources."
│   ├── CTA: [Start asking →]  [See an example]
│   └── ChatMockup (live-type, kept)
├── "What you can ask" — 3 tappable sample chips
├── "How it works" — 3 compact steps
├── Trust strip — 3 real stats (sources, chunks, pipeline)
├── "See it in action" — framed hero-image.jpeg + short caption [KEPT]
├── Features — collapsible "Why it's trustworthy" accordion (6 items)
├── Corpus & topics — collapsed behind "Explore the knowledge base"
├── FAQ — 3 items accordion
├── Final CTA
└── Footer — minimal
```

**Tasks**

| # | Task | Files |
|---|------|-------|
| A4.1 | Rewrite hero copy (what/who/how-to-start, one-liner for new users) | `src/app/page.tsx` |
| A4.2 | Move ChatMockup into/just below hero | `page.tsx`, `chat-mockup.tsx` |
| A4.3 | 3 tappable sample-question chips that prefill a chat query | `page.tsx`, `chat-empty-state.tsx` |
| A4.4 | Feature grid → accordion/tab ("Why it's trustworthy") | `page.tsx` |
| A4.5 | Corpus + topics collapsed behind a "Browse knowledge base" link | `page.tsx`, `sources/page.tsx` |
| A4.6 | Keep hero-image.jpeg framed block, trim surrounding copy | `page.tsx` |
| A4.7 | Trim FAQ to 3 items, tighten answers | `page.tsx` |
| A4.8 | "What is Behoerden-Bot?" one-liner visible to new users | `page.tsx` |
| A4.9 | Reorder sections mobile-first | `page.tsx` |
| A4.10 | Guest-first CTA (prompt-count awareness) | `page.tsx` |
| A4.11 | Update `layout.tsx` metadata/OG to match new message | `layout.tsx` |
| A4.12 | (Optional) `hero-banner.jpg` is unused in code — keep/remove | `public/Images/hero-banner.jpg` |
| A4.13 | Unit-test new landing sections | `tests/unit/*.test.tsx` |
| A4.14 | Playwright E2E landing → chat conversion | `tests/e2e/landing.spec.ts` |

---

### 1.2 B — 200-Point Mobile Responsive Checklist

**Status (verified 2026-08-11):** Partially applied — the archived `responsive-ui-upgrade-checklist.md` covered ~109 mobile items; the numbered gaps below remain open. Numbered to reach 200; small verifiable tasks, grouped.

#### B1. Foundation & viewport (1–20)
1. Confirm `viewport` meta (`width=device-width, initial-scale=1, viewportFit=cover`) — verify all pages.
2. No fixed-width container overflows on 320px.
3. rem-based base font so iOS doesn't auto-zoom inputs.
4. `touch-action: manipulation` on buttons/links.
5. `-webkit-tap-highlight-color: transparent` on interactive elements.
6. `100dvh`/`min-h-dvh` to avoid URL-bar overflow.
7. iOS safe-area insets for bottom nav/input.
8. No horizontal scroll on landing sections.
9. `overflow-x: clip` safety net on `body`/`#main`.
10. Test 320/375/414/768/1024/1440 widths.
11. Test 150–200% zoom.
12. Test landscape orientation on phones.
13. Back/forward with mobile drawer.
14. Sticky header doesn't eat content on short screens.
15. `prefers-reduced-motion` honored brand-wide.
16. `prefers-color-scheme` theme (via next-themes).
17. No layout shift on font load (font-display swap).
18. No layout shift on image load (aspect-ratio set).
19. 1080px content cap works on large phones.
20. Global `@media (max-width:640px)` stylesheet audit.

#### B2. Navigation & layout (21–60)
21. Drawer opens from hamburger — verify focus trap.
22. Close on Escape — verify.
23. Close on route change — verify.
24. Close on link tap — verify all items.
25. Drawer links ≥44px.
26. `aria-expanded` on hamburger — verify.
27. `aria-label` on hamburger — verify.
28. Drawer scrolls when content overflows.
29. Prevent body scroll when drawer open.
30. Backdrop click closes drawer.
31. Sticky header collapses search/actions on mobile.
32. Logo left-aligned, no wrap.
33. "Get started" CTA visible on mobile header.
34. Bottom padding so content isn't behind mobile browser UI.
35. Sidebar (chat) collapses to drawer on mobile — verify.
36. Sidebar toggle ≥44px.
37. New-chat button ≥44px.
38. Conversation items ≥48px row height.
39. Knowledge-base badge doesn't overflow.
40. Theme toggle ≥44px.
41. Profile menu opens upward — verify.
42. Profile menu scrollable within screen.
43. Sign-in/guest buttons ≥44px.
44. Collapsed icon rail hidden/reworked on mobile.
45. No double sidebar instance on mobile (handled via `onNavigate`) — verify.
46. Drawer with 50+ conversations (scroll perf).
47. Search input full-width on mobile.
48. Search input `font-size:16px` (no iOS zoom).
49. Back-to-top doesn't overlap bottom nav.
50. Back affordance on mobile sub-pages.
51. Landing nav links reachable on mobile.
52. Footer links stack vertically.
53. Footer copyright no wrap on 320px.
54. Changelog modal full-width on mobile.
55. Modals/dialogs ≤ viewport height on mobile.
56. Confirm-dialog buttons stack/tappable on mobile.
57. Guest-limit dialog readable on mobile.
58. All dialogs trap focus + dismissible on mobile.
59. `z-index` layering drawer vs modals on mobile.
60. Keyboard navigation on mobile (connected keyboard).

#### B3. Chat on mobile (61–100)
61. Chat input sticky at bottom.
62. Input not hidden behind iOS keyboard.
63. Input font-size 16px (no zoom on focus).
64. Send button ≥44px.
65. Attach/stop/mode buttons ≥44px.
66. Bubbles ≤ ~85% width on mobile.
67. Source chips wrap, not overflow.
68. Source chips tappable ≥36px.
69. Markdown tables scroll horizontally.
70. Code blocks scroll horizontally.
71. Long words/URLs `overflow-wrap:anywhere`.
72. Follow-up suggestion chips wrap + tappable.
73. Disambiguation cards full-width + tappable.
74. Pipeline status bar no wrap.
75. "thinking" indicator fits mobile.
76. Copy/clear/new-chat header buttons ≥44px.
77. Mode badge doesn't push header buttons off-screen.
78. Scroll-to-bottom doesn't cover input.
79. Auto-scroll doesn't fight reading-up.
80. Streaming text no layout shift.
81. Day-separators legible.
82. Regenerate button tappable, no overlap.
83. Feedback buttons ≥44px.
84. Guest prompt-count notice near input on mobile.
85. Empty-state suggested prompts ≥44px tappable.
86. Suggested-prompt cards stack on mobile.
87. Empty-state illustration scales down.
88. Input autofocus doesn't jump-scroll.
89. Paste works in chat input on mobile.
90. Auto-capitalize decision for chat.
91. `inputmode`/`enterkeyhint` for chat.
92. SSE streaming no lag on low-end mobile.
93. Test Fast 3G on mobile.
94. Test very long answer on mobile.
95. Test German text rendering on mobile.
96. Disambiguation → follow-up flow on mobile.
97. Regenerate flow on mobile.
98. Stop-streaming on mobile.
99. History loads/scrolls smoothly on mobile.
100. Pinned conversations work on mobile.

#### B4. Forms & inputs (101–125)
101. Login email input 16px.
102. OAuth buttons ≥44px.
103. "Continue as guest" ≥44px.
104. Guest info panel no overflow.
105. Terms/privacy links tappable.
106. Ingest upload input usable on mobile.
107. Admin metric cards stack on mobile.
108. Admin tables scroll horizontally.
109. Pipeline-tester form usable on mobile.
110. Settings inputs ≥44px.
111. Theme/language pickers tappable.
112. Sources list items ≥44px.
113. Sources search works on mobile (16px).
114. All inputs/selects/textareas ≥44px.
115. All buttons ≥44px.
116. Button active/pressed states.
117. Focus rings on touch.
118. Validation errors readable.
119. Toasts don't overlap chat input.
120. Toast dismiss timing reasonable.
121. Destructive actions clearly separated.
122. No required field below fold without scroll hint.
123. Autocomplete on email/name.
124. autocapitalize/autocorrect per field.
125. Test forms with on-screen keyboard open.

#### B5. Performance & loading (126–150)
126. LCP <2.5s mobile (Fast 3G) landing.
127. Defer/async non-critical JS.
128. No heavy blocking JS above fold.
129. ChatMockup uses content-visibility/lazy.
130. Images use `next/image` correct `sizes`.
131. hero-image.jpeg mobile-appropriate size.
132. Preload hero (`eager` + `fetchpriority=high`).
133. Fonts optimized for mobile.
134. No render-blocking CSS above fold.
135. `content-visibility:auto` below fold — verify.
136. Minimize CLS (aspect-ratio placeholders).
137. INP <200ms mobile.
138. Debounce scroll/resize (partly).
139. Reduce framer-motion cost on low-end.
140. Reduce aurora GPU cost on mobile.
141. No SSE memory leak on mobile.
142. Backgrounded tab resume (50+ tabs).
143. PWA manifest + installability — verify.
144. apple-touch-icon — verify.
145. Service-worker/offline if applicable.
146. Bundle-size budget.
147. tRPC caching (staleTime) on mobile.
148. Semantic-cache fast path on mobile.
149. Cold-start first load on mobile.
150. Lighthouse mobile ≥90 tracked in CI.

#### B6. Responsive images & media (151–165)
151. hero-image.jpeg — `sizes`+`srcSet` for mobile.
152. Mobile-optimized hero crop if needed.
153. OG image (1200×630) separate from in-page hero.
154. hero-banner.jpg — use in mobile section or remove (see A4.12).
155. lucide icons scale correctly.
156. Logo crisp on mobile (no raster).
157. icon-192/512/apple-touch-icon correct.
158. No oversized chat-source favicons blocking render.
159. Images don't break `object-fit` on mobile ratios.
160. `loading="lazy"` below-fold images.
161. `alt` on every image — verify.
162. No CLS from images on mobile.
163. Images in dark mode on mobile.
164. OG preview good on mobile share.
165. hero-image.jpeg placement in new layout.

#### B7. Touch, accessibility & a11y (166–185)
166. All interactive ≥44px (sweep).
167. WCAG AA contrast on mobile.
168. Logical focus order (drawer, forms).
169. `aria-hidden` decorative aurora/mockup — verify.
170. Screen-reader labels on icon-only buttons.
171. `role="log"`+`aria-live` chat — verify mobile.
172. Disambiguation accessible selection state.
173. Accordions `aria-expanded`+button semantics.
174. Drawer `role="dialog"`+`aria-modal`.
175. Modals preserve/restore focus on mobile.
176. Toast `role="status"`.
177. Errors `role="alert"` — verify mobile.
178. Touch targets not overlapping.
179. No text selection on buttons.
180. `user-select` disabled on drag handles.
181. Swipe/scroll don't conflict with chat.
182. VoiceOver (iOS) + TalkBack (Android) key flows.
183. Screen reader + keyboard nav.
184. prefers-reduced-motion disables typewriter — verify.
185. axe-core a11y E2E for landing+chat on mobile.

#### B8. Testing & QA (186–200)
186. Playwright devices: iPhone 12/13, Pixel 5, Galaxy S21.
187. Viewports: 320×568, 375×667, 414×896, 768×1024.
188. E2E: landing → sample q → chat on mobile.
189. E2E: open drawer → navigate on mobile.
190. E2E: send + stream on mobile.
191. E2E: guest prompt-count updates live on mobile.
192. E2E: OAuth buttons on mobile.
193. E2E: admin dashboard on mobile (regression).
194. E2E: settings on mobile.
195. Visual regression for landing at 3 breakpoints.
196. Add mobile viewports to CI (`playwright.config.ts`).
197. Mobile-only lint (no fixed 100vw overflow).
198. Lighthouse mobile score in CI.
199. Document manual test matrix (device/OS/browser).
200. Cross-browser: Safari iOS, Chrome Android, Firefox, Edge.

---

### 1.3 C — Guest Session Fix

**Status (verified 2026-08-11):** **IMPLEMENTED** — all root-cause fixes are in the code (idempotent `POST /api/guest`, returning-guest redirect via `public.guestStatus`, and `conversation.count` invalidation on send/regenerate/stop). Regression coverage from C2.5/C2.6 is optional follow-up.

**Root cause (verified in code):**
1. **New guest id each click:** `login-content.tsx` `continueAsGuest()` always called `POST /api/guest`, which called `createGuestId()` and overwrote the cookie. It never checked an existing valid cookie. So re-clicking after refresh minted a fresh id → **resets the 5-prompt cap**.
2. **Login ignores existing guest:** `login-content.tsx` `useEffect` only redirected when `sessionStatus==="authenticated"`. A returning guest (cookie present, not signed in) stayed on login.
3. **Stale prompt count:** sidebar reads `api.conversation.count` (`app-sidebar.tsx`). Provider set `staleTime:60_000` + `refetchOnWindowFocus:false` (`trpc/provider.tsx`), and `use-chat.ts` invalidated only `getById`+`list`, not `count`. So count stayed stale until reload.

**Fix plan (as implemented)**

| # | Task | Files |
|---|------|-------|
| C2.1 | Make `POST /api/guest` idempotent: if valid `behoerden_guest` cookie exists, return existing id; only mint new when none. | `src/app/api/guest/route.ts` |
| C2.2 | On login, detect existing guest and redirect to `/chat` (mirror authenticated redirect). Add a `public.guestStatus` query or read cookie server-side. | `login-content.tsx`, `routers/public.ts` |
| C2.3 | Invalidate `conversation.count` on send/regenerate/stop so the chip updates live. | `use-chat.ts` (`invalidateConversation`) |
| C2.4 | Optionally `refetchOnWindowFocus:true` or lower staleTime for `conversation.count`. | `app-sidebar.tsx` |
| C2.5 | Regression tests: guest cookie persists across refresh; count increments without reload. | `tests/unit`, `tests/integration` |
| C2.6 | E2E: guest → refresh login → still one session (5-prompt cap intact). | `tests/e2e/guest.spec.ts` |

**Verification**
- Guest count = 1/5. Reload login, click "Continue as guest" → redirects to existing chat, still 1/5 (not reset).
- Send 5 → limit dialog. Reload → still limited.
- Sidebar chip updates live after each message without refresh.

---

### 1.4 D — Separate Test Suites (Streamlit vs Web App)

**Status:** In place — `web-app/tests/` (Vitest + Playwright) and root `tests/` (pytest + RAGAS) are already fully separate; the remaining items are documentation + web-app gap-filling.

**Current state**
- **Web app:** Vitest (unit+integration) + Playwright E2E under `web-app/tests/`. Well-structured.
- **Python/Streamlit:** `tests/` at repo root (RAGAS eval, pytest). Run by Python CI only.

**Verdict:** Keep fully separate — different stack, CI, concern. Already largely true; work is to formalize/document and fill web-app gaps.

**Plan**

| # | Task | Location |
|---|------|----------|
| D1.1 | Keep `web-app/tests/` as the sole web-app suite. | `web-app/tests/` |
| D1.2 | Keep root `tests/` (RAGAS+pytest) as Python/Streamlit suite, Python CI only. | `tests/` |
| D1.3 | Add `tests/README.md` documenting the split + how to run each. | `tests/README.md` |
| D1.4 | Verify web-app CI doesn't run Python tests and vice versa. | `.github/workflows/*.yml` |
| D1.5 | Web-app unit tests for guest fix (C2.5) + landing (A4.13). | `web-app/tests/unit` |
| D1.6 | Web-app E2E for landing (A4.14) + guest (C2.6). | `web-app/tests/e2e` |
| D1.7 | Integration tests for `/api/guest` idempotency. | `web-app/tests/integration` |
| D1.8 | System-prompt unit tests (E) asserting output schema/format. | `web-app/tests/unit` |
| D1.9 | Keep web-app coverage ≥80% gate. | CI |
| D1.10 | Document split in `docs/ARCHITECTURE.md`/`docs/DEVELOPER_QUICKSTART.md`. | docs |

---

### 1.5 E — System Prompt Improvements

**Status (verified 2026-08-11):** Partially done — a shared English-only base prompt landed in `src/server/rag/prompt.ts` (Phase L, commit `0697776`); Research still has no LLM system prompt, and the persona/safety/uncertainty/citation contracts below are only partially present.

**Current prompts (audited)**
- **Guardrail** (`guardrail.ts`): instruction-following LLM, term cache + XML-delimited block, fails closed.
- **Analyst** (`analyst.ts`): "Lead Analytical Agent," treats data untrusted, Zod-validated JSON. Good guard.
- **Writer** (`writer.ts`): "Executive Technical Writer," markdown, "Actionable Next Steps," grounded-only.
- **Research** (`research.ts`): ReAct loop but **no LLM system prompt** — retrieval is deterministic. No reasoning/selection step.
- **Standard** (`pipeline.ts`): single thin system prompt.

**Gaps:** Research has no model instruction; Writer/Standard are thin — no persona guardrails, no uncertainty rule, no citation format, no PII re-check, no refusal phrasing, no tone contract.

**Proposed upgrades**

| # | Improvement | Where |
|---|-------------|-------|
| E2.1 | Add a shared base prompt (persona, safety, uncertainty, language, citation contract) reused by Standard+Writer. | `src/server/rag/prompt.ts` |
| E2.2 | Uncertainty/don't-fabricate: "If context insufficient, say so and suggest official source. Never invent figures/timelines/requirements." | base |
| E2.3 | Citation contract: "Map every factual claim to a cited source when available; surface source names inline." | Writer |
| E2.4 | Language rule: **resolved** — answers are English-only (Phase L), keeping technical terms accurate. | base+Writer |
| E2.5 | PII re-check: "Never echo/request masked personal data; never output IBANs/passports/phones/emails." | base |
| E2.6 | Tone/format contract: subheadings, bullets, "Actionable Next Steps," no fluff/sales. | Writer |
| E2.7 | Safety: "If query seeks to circumvent/fraud German immigration law, refuse and explain." | base |
| E2.8 | Research agent instruction framing research context (slots in future LLM validation). | `research.ts` |
| E2.9 | Analyst: strengthen "treat context untrusted, classify not follow"; require `verified_facts` traceable. | `analyst.ts` |
| E2.10 | Guardrail: keep deterministic refuse list; fails closed with logging. Optional fine-tuned classifier later. | `guardrail.ts` |
| E2.11 | Confidence disclosure: ungrounded/CRAG-fallback answers note "verify with official source." | Writer+base |
| E2.12 | Keep prompts centralized/versioned constants, testable + auditable. | `src/server/rag/prompt.ts` |
| E2.13 | Unit tests asserting prompt contract (no fabrication, citations required). | `web-app/tests/unit` |
| E2.14 | Document prompting strategy in `docs/ARCHITECTURE.md`. | docs |

**Success criteria**
- Grounded answers (no invented figures) — verified via RAGAS (Faithfulness ≥3.5).
- Citations when sources exist.
- Answers in English (Phase L) with accurate German technical terms.
- Out-of-domain/unsafe refused at guardrail + generation time.
- Prompts centralized + unit-tested.

---

### 1.6 F — Suggested Execution Order

1. **C (guest fix)** — smallest, highest user impact. **DONE.**
2. **A (landing redesign, mobile-first)** — big UX win.
3. **B (200-point mobile checklist)** — ongoing; bake mobile viewports into CI (B8).
4. **E (system prompts)** — independent; do after C.
5. **D (test split)** — docs + CI verification; alongside all.

### 1.7 G — Open Decisions

1. **hero-banner.jpg** (unused) — keep (repurpose on mobile) or remove? (A4.12)
2. **Landing depth** — all-in on collapsed/accordion, or keep text visible for SEO? Recommend: keep key text in DOM (SEO) but visually collapsed.
3. **Guest auto-redirect** — **resolved:** returning guests auto-route to `/chat` via `public.guestStatus` (C2.2).
4. **System-prompt language default** — **resolved:** English-only answers (Phase L), no per-query auto-detect.

---

## 2. Archived Plans (Completed)

> These implementation/enhancement plans are fully executed. Their content is preserved here as a one-line index; per-phase delivery details live in [`docs/status/`](./status/).

| Archived plan | Scope | Status | Where it landed |
|---|---|---|---|
| `IMPLEMENTATION_PLAN.md` | Phase D/E: URL content-type validation, parent-child chunking + PDF ingestion, global UI overhaul, pipeline visualizer, tests/CI hardening | ✅ All phases done | `docs/status/phase-f-ui-pdf-chunking-visualizer.md` |
| `UI_UX_ENHANCEMENT_PLAN.md` | 150-point UI/UX plan (design system → landing → auth → chat → admin → a11y) | ✅ 147/150 verified; 3 follow-ups open: message-bubble entrance animation, testimonials section, history stats header | `docs/status/phase-g-ui-ux-enhancements.md` |
| `TESTING_PHASE4.md` | Phase-4 test & verification guide (pipeline visualizer + PDF ingestion) | ✅ Done | `docs/status/phase-f-ui-pdf-chunking-visualizer.md` + `../../docs/TESTING_AND_QUALITY.md` |
| `responsive-ui-upgrade-checklist.md` | 103-row (~109-item) mobile responsive implementation log | ✅ Done (rows applied + verified) | `docs/status/phase-g-ui-ux-enhancements.md` |

---

## 3. Phase 4 — Implementation Roadmap (RFC → Atomic Tasks) — EXECUTED

> Historical execution list for the original Phase-4 build-out. All tasks are complete; the app is live. Kept for traceability.

### 3.1 Atomic Task List (Bottom-Up)

#### Stack / Foundations
| ID | Title | Layer | Verification |
|----|-------|-------|--------------|
| TASK-001 | Scaffold Next.js 15 + TS strict + ESLint/Prettier + Vitest/Playwright in `web-app/` | Setup | `pnpm build` + `pnpm lint` green |
| TASK-002 | Tailwind CSS v4 + shadcn/ui + design tokens + fonts | UI | Storybook-free build; tokens in globals.css |
| TASK-003 | Prisma schema (7 models + `vector` ext) + initial migration | DB | `prisma migrate dev` applies; `vector` enabled |
| TASK-004 | Two-role DB config (`DATABASE_URL` app / `MIGRATION_DATABASE_URL` CI) | DB | CI migration user can DDL; app user DML only |
| TASK-005 | tRPC v11 bootstrap + auth context + response envelope | API | tRPC client type-checks; 401 envelope on unauth |
| TASK-006 | NextAuth v5 (GitHub+Google+Email magic link, Prisma adapter, RBAC `USER`/`ADMIN`) | Auth | login/register flows; admin route guard |
| TASK-007 | Global error handler + `ErrorCode` registry + DomainError hierarchy + pino redaction logger | Core | error→status map; `[REDACTED]` in logs |
| TASK-008 | Rate limiter (Upstash sliding window: auth 5/15min/IP, public 100/15min) + CSRF policy | Security | 429 on exceed; mutating routes checked |
| TASK-009 | SSRF-safe fetch helper (`src/lib/security/url-validator.ts`) | Security | internal IP block tests pass |
| TASK-010 | Security headers + `/health` (deep: db/cache/apis) | Security | headers present; health JSON shape |

#### RAG Core
| ID | Title | Layer | Verification |
|----|-------|-------|--------------|
| TASK-011 | PII masker TS port (IBAN, passport, DOB, phone, email, name) | RAG | all `test_rag_quality` PII cases pass |
| TASK-012 | Embedding client (HF Inference API, env `EMBEDDING_MODEL`) | RAG | 768-d vector round-trip |
| TASK-013 | LLM client (Groq primary + HF fallback, retry/backoff, semaphore, circuit breaker) | RAG | circuit breaker tests (closed→open→half-open) |
| TASK-014 | BM25 sparse retrieval (TS port of Okapi) | RAG | scoring tests |
| TASK-015 | pgvector dense retrieval (Prisma `$queryRaw`, cosine, min_sim 0.20, k=15) | RAG | SQL tests |
| TASK-016 | RRF fusion (k=60) | RAG | fusion unit tests |
| TASK-017 | HybridRetriever (dense + sparse + RRF → top-15) | RAG | integration test |
| TASK-018 | Cross-encoder re-ranker via HF Inference API (top_k=5) | RAG | rerank ordering test |
| TASK-019 | CRAG gate (≥0.50; fail → web search fallback) | RAG | pass/fail paths |
| TASK-020 | Domain guardrail Stage-0A (off-topic/illegal block + negative cache) | RAG | in/out-of-domain tests |
| TASK-021 | Query disambiguation Stage-0B (vague query → 3 options) | RAG | disambiguation tests |
| TASK-022 | Multi-query expansion (LLM → 3 sub-queries) | RAG | expansion tests |
| TASK-023 | Web search tool (`duck-duck-scrape`) + result synthesis | RAG | mocked search tests |
| TASK-024 | Visa calculator tool (992 EUR/mo × 12, 90 INR/EUR) | RAG | math tests |
| TASK-025 | Semantic cache (Redis exact hash + pgvector cosine ≥0.97, 7-day TTL enforced) | RAG | cache write/read/TTL tests |
| TASK-026 | Summary-buffer memory (last 8 verbatim + ~300-token summary) | RAG | memory tests |
| TASK-027 | Standard CRAG pipeline orchestrator | RAG | pipeline integration test |
| TASK-028 | 3-Agent ReAct pipeline (Research→Analyst→Writer, Zod-validated AnalystMatrix) | RAG | agentic pipeline integration test |

#### API / UI
| ID | Title | Layer | Verification |
|----|-------|-------|--------------|
| TASK-029 | tRPC routers: chat, conversation, source, document(admin), admin | API | tRPC tests; RBAC enforced |
| TASK-030 | SSE stream route `/api/chat/stream` (status/token/disambiguation/done events) | API | e2e stream test |
| TASK-031 | `useChat` hook (SSE consumer, abort, timeout) | UI | hook test (MSW) |
| TASK-032 | Chat interface (messages, bubbles, streaming text, sources, matrix, typing) | UI | component tests |
| TASK-033 | Sidebar + conversation CRUD + mobile nav | UI | component tests |
| TASK-034 | History page + Settings page | UI | component tests |
| TASK-035 | Landing page (hero + feature grid) | UI | Lighthouse 90+ |

#### Admin / Data
| ID | Title | Layer | Verification |
|----|-------|-------|--------------|
| TASK-036 | Document sync (transactional re-chunk/re-embed + cache invalidation) | API | sync integration test |
| TASK-037 | Admin dashboard (metrics + Recharts) + admin documents UI | UI | RBAC test; admin e2e |
| TASK-038 | Ingest pipeline (PDF/URL→clean→chunk 600/150→embed→store) + CLI | Data | ingest golden-file test |
| TASK-039 | Cache TTL cleanup cron (Vercel Cron) + Langfuse tracing | Ops | cron route; trace spans |

#### Delivery
| ID | Title | Layer | Verification |
|----|-------|-------|--------------|
| TASK-040 | CI: `ci.yml` + `security.yml` (CodeQL/Semgrep/Gitleaks/SBOM) + `e2e.yml` + `deploy.yml` | Ops | green pipeline |
| TASK-041 | Husky pre-commit (lint/format/type/secret scan) | Ops | commit blocked on violation |
| TASK-042 | E2E (Playwright): chat flow, disambiguation, auth, admin | QA | all specs pass |
| TASK-043 | README + `.env.example` sync + SECURITY_EXCEPTIONS.md + CHANGELOG | Docs | doc checklist |
| TASK-044 | Vercel deploy + Neon + Upstash env sync + smoke test | Ops | /health 200 + smoke pass |

### 3.2 Traceability Matrix (Shall → Tasks)

| Requirement (WEB_APP_PLAN §7/§14) | Tasks |
|---|---|
| 3-Agent ReAct | TASK-028 |
| Hybrid retrieval (dense+sparse+RRF+rerank) | TASK-014..018 |
| CRAG gate + web fallback | TASK-019, TASK-023 |
| PII masking | TASK-011 |
| Semantic cache + TTL | TASK-025 |
| Summary-buffer memory | TASK-026 |
| Guardrail + disambiguation | TASK-020, TASK-021 |
| Query expansion | TASK-022 |
| Resilient LLM client | TASK-013 |
| Langfuse observability | TASK-039 |
| Auth + RBAC | TASK-006 |
| SSE streaming chat | TASK-030..032 |
| Admin metrics + doc sync | TASK-036..038 |
| Quality gates (lint/type/unit/e2e) | TASK-040..042 |
| Zero-downtime migration + PoLP | TASK-003..004 |

### 3.3 Change-Control Acknowledgment (vs earlier draft plan)

Per CCI (prompt_design §6.0): the user's `../../docs/WEB_APP_PLAN.md` supersedes the root-level draft. Recorded deltas: tRPC replaces REST-first API; NextAuth providers replace Credentials-only; HF Inference embeddings replace OpenAI-compatible; same-repo `web-app/` branch replaces separate repo.
