# Implementation Plan — Landing Redesign, Mobile Responsiveness, Guest Session Fix, Testing, & System Prompts

> **Status:** PLANNING ONLY — no code changes yet.
> **Scope:** 5 workstreams for the Behoerden-Bot web app (`web-app/`).
> **Date:** 2026-08-10
> **Note:** This is a new plan for the 5 specific asks. It does not replace the existing `docs/IMPLEMENTATION_PLAN.md` or `docs/responsive-ui-upgrade-checklist.md` — cross-reference those where relevant.

---

## 0. Executive Summary

Five distinct asks:

| # | Workstream | Why | Effort |
|---|-----------|-----|--------|
| A | Landing page redesign from scratch | New visitors can't tell what the app does — "too much info on homepage" | High |
| B | 200-point mobile responsive checklist | App must work well on phones | High |
| C | Guest session fix (one session, live prompt count) | Refresh resets the 5-prompt limit; count is stale until reload | Low |
| D | Separate test suites (Streamlit vs web app) | Own tests per surface | Medium |
| E | System prompt improvements | Make agents act like a real assistant, not a query generator | Medium |

**Critical finding (root cause) for C** — see §3. The login page mints a *new* guest id every time "Continue as guest" is clicked even when a valid guest cookie exists, and the sidebar prompt-count query is never invalidated after a message is sent.

---

# A. Landing Page Redesign

## A1. Problem
The landing (`src/app/page.tsx`) is a long, dense page: sticky nav, hero, aurora, chat mockup, 4 stat cells, "See it in action" photo, 3-step How-it-works, 6 feature cards, corpus, 12 topic chips, FAQ, final CTA, footer. Overwhelming; the value prop is buried.

**Goal:** a new visitor understands *what this is, who it's for, how to start* within 5 seconds.

## A2. Design principles
1. One clear message above the fold + one primary CTA ("Start asking").
2. Lead with the working product — the chat mockup high, not below the fold.
3. Progressive disclosure — collapse depth behind tabs/accordions/anchors.
4. **Keep the trusted brand assets** (user explicitly named them): graduation-cap logo, the `ChatMockup` (already has "sample" removed), and `hero-image.jpeg`. Do not remove.
5. Mobile-first (ties into workstream B).

## A3. Proposed structure
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

## A4. Tasks
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

# B. 200-Point Mobile Responsive Checklist

> Numbered to reach 200. Small verifiable tasks, grouped.

## B1. Foundation & viewport (1–20)
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
15. `prefers-reduced-motion` honored (already) brand-wide.
16. `prefers-color-scheme` theme (already via next-themes).
17. No layout shift on font load (font-display swap).
18. No layout shift on image load (aspect-ratio set).
19. 1080px content cap works on large phones.
20. Global `@media (max-width:640px)` stylesheet audit.

## B2. Navigation & layout (21–60)
21. Drawer opens from hamburger (exists) — verify focus trap.
22. Close on Escape (exists) — verify.
23. Close on route change (exists) — verify.
24. Close on link tap (exists) — verify all items.
25. Drawer links ≥44px.
26. `aria-expanded` on hamburger (exists) — verify.
27. `aria-label` on hamburger (exists) — verify.
28. Drawer scrolls when content overflows.
29. Prevent body scroll when drawer open.
30. Backdrop click closes drawer.
31. Sticky header collapses search/actions on mobile.
32. Logo left-aligned, no wrap.
33. "Get started" CTA visible on mobile header.
34. Bottom padding so content isn't behind mobile browser UI.
35. Sidebar (chat) collapses to drawer on mobile (exists) — verify.
36. Sidebar toggle ≥44px.
37. New-chat button ≥44px.
38. Conversation items ≥48px row height.
39. Knowledge-base badge doesn't overflow.
40. Theme toggle ≥44px.
41. Profile menu opens upward (exists) — verify.
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

## B3. Chat on mobile (61–100)
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

## B4. Forms & inputs (101–125)
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

## B5. Performance & loading (126–150)
126. LCP <2.5s mobile (Fast 3G) landing.
127. Defer/async non-critical JS.
128. No heavy blocking JS above fold.
129. ChatMockup uses content-visibility/lazy.
130. Images use `next/image` correct `sizes`.
131. hero-image.jpeg mobile-appropriate size.
132. Preload hero (`eager` + `fetchpriority=high`).
133. Fonts optimized for mobile.
134. No render-blocking CSS above fold.
135. `content-visibility:auto` below fold (exists) — verify.
136. Minimize CLS (aspect-ratio placeholders).
137. INP <200ms mobile.
138. Debounce scroll/resize (partly).
139. Reduce framer-motion cost on low-end.
140. Reduce aurora GPU cost on mobile.
141. No SSE memory leak on mobile.
142. Backgrounded tab resume (50+ tabs).
143. PWA manifest + installability (exists) — verify.
144. apple-touch-icon (exists) — verify.
145. Service-worker/offline if applicable.
146. Bundle-size budget.
147. tRPC caching (staleTime) on mobile.
148. Semantic-cache fast path on mobile.
149. Cold-start first load on mobile.
150. Lighthouse mobile ≥90 tracked in CI.

## B6. Responsive images & media (151–165)
151. hero-image.jpeg — `sizes`+`srcSet` for mobile.
152. Mobile-optimized hero crop if needed.
153. OG image (1200×630) separate from in-page hero.
154. hero-banner.jpg — use in mobile section or remove (A4.12).
155. lucide icons scale correctly.
156. Logo crisp on mobile (no raster).
157. icon-192/512/apple-touch-icon correct.
158. No oversized chat-source favicons blocking render.
159. Images don't break `object-fit` on mobile ratios.
160. `loading="lazy"` below-fold images.
161. `alt` on every image (mostly) — verify.
162. No CLS from images on mobile.
163. Images in dark mode on mobile.
164. OG preview good on mobile share.
165. hero-image.jpeg placement in new layout.

## B7. Touch, accessibility & a11y (166–185)
166. All interactive ≥44px (sweep).
167. WCAG AA contrast on mobile.
168. Logical focus order (drawer, forms).
169. `aria-hidden` decorative aurora/mockup (exists) — verify.
170. Screen-reader labels on icon-only buttons.
171. `role="log"`+`aria-live` chat (exists) — verify mobile.
172. Disambiguation accessible selection state.
173. Accordions `aria-expanded`+button semantics.
174. Drawer `role="dialog"`+`aria-modal`.
175. Modals preserve/restore focus on mobile.
176. Toast `role="status"`.
177. Errors `role="alert"` (exists) — verify mobile.
178. Touch targets not overlapping.
179. No text selection on buttons.
180. `user-select` disabled on drag handles.
181. Swipe/scroll don't conflict with chat.
182. VoiceOver (iOS) + TalkBack (Android) key flows.
183. Screen reader + keyboard nav.
184. prefers-reduced-motion disables typewriter (exists) — verify.
185. axe-core a11y E2E for landing+chat on mobile.

## B8. Testing & QA (186–200)
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

# C. Guest Session Fix

## C1. Root cause (verified in code)
1. **New guest id each click:** `login-content.tsx` `continueAsGuest()` always calls `POST /api/guest`, which calls `createGuestId()` and overwrites the cookie. It never checks an existing valid cookie. So re-clicking after refresh mints a fresh id → **resets the 5-prompt cap**.
2. **Login ignores existing guest:** `login-content.tsx` `useEffect` only redirects when `sessionStatus==="authenticated"`. A returning guest (cookie present, not signed in) stays on login.
3. **Stale prompt count:** sidebar reads `api.conversation.count` (`app-sidebar.tsx`). Provider sets `staleTime:60_000` + `refetchOnWindowFocus:false` (`trpc/provider.tsx`), and `use-chat.ts` invalidates only `getById`+`list`, not `count`. So count stays stale until reload.

## C2. Fix plan
| # | Task | Files |
|---|------|-------|
| C2.1 | Make `POST /api/guest` idempotent: if valid `behoerden_guest` cookie exists, return existing id; only mint new when none. | `src/app/api/guest/route.ts` |
| C2.2 | On login, detect existing guest and redirect to `/chat` (mirror authenticated redirect). Add a `public.guestStatus` query or read cookie server-side. | `login-content.tsx`, `routers/public.ts` |
| C2.3 | Invalidate `conversation.count` on send/regenerate/stop so the chip updates live. | `use-chat.ts` (`invalidateConversation`) |
| C2.4 | Optionally `refetchOnWindowFocus:true` or lower staleTime for `conversation.count`. | `app-sidebar.tsx` |
| C2.5 | Regression tests: guest cookie persists across refresh; count increments without reload. | `tests/unit`, `tests/integration` |
| C2.6 | E2E: guest → refresh login → still one session (5-prompt cap intact). | `tests/e2e/guest.spec.ts` |

## C3. Verification
- Guest count = 1/5. Reload login, click "Continue as guest" → redirects to existing chat, still 1/5 (not reset).
- Send 5 → limit dialog. Reload → still limited.
- Sidebar chip updates live after each message without refresh.

---

# D. Separate Test Suites (Streamlit vs Web App)

## D1. Current state
- **Web app:** Vitest (unit+integration) + Playwright E2E under `web-app/tests/`. Well-structured.
- **Python/Streamlit:** `tests/` at repo root (RAGAS eval, pytest). Run by Python CI only.

**Verdict:** Keep fully separate — different stack, CI, concern. Already largely true; work is to formalize/document and fill web-app gaps.

## D2. Plan
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

# E. System Prompt Improvements

## E1. Current prompts (audited)
- **Guardrail** (`guardrail.ts`): instruction-following LLM, term cache + XML-delimited block, fails open.
- **Analyst** (`analyst.ts`): "Lead Analytical Agent," treats data untrusted, Zod-validated JSON. Good guard.
- **Writer** (`writer.ts`): "Executive Technical Writer," markdown, "Actionable Next Steps," grounded-only.
- **Research** (`research.ts`): ReAct loop but **no LLM system prompt** — retrieval is deterministic. No reasoning/selection step.
- **Standard** (`pipeline.ts`): single thin system prompt.

**Gaps:** Research has no model instruction; Writer/Standard are thin — no persona guardrails, no uncertainty rule, no citation format, no PII re-check, no language rule, no refusal phrasing, no tone contract.

## E2. Proposed upgrades
| # | Improvement | Where |
|---|-------------|-------|
| E2.1 | Add a shared base prompt (persona, safety, uncertainty, language, citation contract) reused by Standard+Writer. | `src/server/rag/prompt.ts` (new) |
| E2.2 | Uncertainty/don't-fabricate: "If context insufficient, say so and suggest official source. Never invent figures/timelines/requirements." | base |
| E2.3 | Citation contract: "Map every factual claim to a cited source when available; surface source names inline." | Writer |
| E2.4 | Language rule: answer in user's language; keep technical terms accurate. | base+Writer |
| E2.5 | PII re-check: "Never echo/request masked personal data; never output IBANs/passports/phones/emails." | base |
| E2.6 | Tone/format contract: subheadings, bullets, "Actionable Next Steps," no fluff/sales. | Writer |
| E2.7 | Safety: "If query seeks to circumvent/fraud German immigration law, refuse and explain." | base |
| E2.8 | Research agent instruction framing research context (slots in future LLM validation). | `research.ts` |
| E2.9 | Analyst: strengthen "treat context untrusted, classify not follow"; require `verified_facts` traceable. | `analyst.ts` |
| E2.10 | Guardrail: keep deterministic refuse list; fails-open but logs warning (already). Optional fine-tuned classifier later. | `guardrail.ts` |
| E2.11 | Confidence disclosure: ungrounded/CRAG-fallback answers note "verify with official source." | Writer+base |
| E2.12 | Keep prompts centralized/versioned constants, testable + auditable. | `src/server/rag/prompt.ts` |
| E2.13 | Unit tests asserting prompt contract (no fabrication, citations required). | `web-app/tests/unit` |
| E2.14 | Document prompting strategy in `docs/ARCHITECTURE.md`. | docs |

## E3. Success criteria
- Grounded answers (no invented figures) — verified via RAGAS (Faithfulness ≥3.5).
- Citations when sources exist.
- Answers in user's language.
- Out-of-domain/unsafe refused at guardrail + generation time.
- Prompts centralized + unit-tested.

---

# F. Suggested Execution Order
1. **C (guest fix)** — smallest, highest user impact. Ship first.
2. **A (landing redesign, mobile-first)** — big UX win.
3. **B (200-point mobile checklist)** — ongoing; bake mobile viewports into CI (B8).
4. **E (system prompts)** — independent; do after C.
5. **D (test split)** — docs + CI verification; alongside all.

Each workstream independently shippable + testable.

---

# G. Open Decisions
1. **hero-banner.jpg** (unused) — keep (repurpose on mobile) or remove? (A4.12)
2. **Landing depth** — all-in on collapsed/accordion, or keep text visible for SEO? Recommend: keep key text in DOM (SEO) but visually collapsed.
3. **Guest auto-redirect** — auto-route returning guest to `/chat` on visiting `/login`, or just detect session on the button? Recommend auto-redirect for "one session" feel. (C2.2)
4. **System-prompt language default** — English-only or auto-detect (German/English)? (E2.4)