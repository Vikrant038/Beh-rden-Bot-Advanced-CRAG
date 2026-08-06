# Responsive UI Upgrade — Implementation Log

> **Status:** Implemented (Aug 2026). All 150 checklist items from the responsive
> upgrade plan have been applied across the app. This file logs what changed and
> where; it mirrors the severity-keyed checklist so the work is auditable.

**Ground rules applied everywhere:** `overflow-x: hidden` on `html, body`;
every breakpoint pair degrades gracefully (`base → sm → md → lg`); no primary
action is hover-only on touch devices.

---

## Phase 1 — Safety nets (P0)

| # | Change | Where |
|---|--------|-------|
| 1 | `overflow-x: hidden` on `html, body` | `src/app/globals.css` |
| 2 | `body { min-width: 320px }` | `src/app/globals.css` |
| 3 | `-webkit-tap-highlight-color: transparent` | `src/app/globals.css` |
| 4 | `@media (hover: none)` guard forcing `group-hover` reveals visible | `src/app/globals.css` |
| 5 | `input, textarea, select { font-size: 16px }` (no iOS zoom) | `src/app/globals.css` |
| 6 | `theme-color` meta (light + dark) | `src/app/layout.tsx` |
| 7 | `viewport` export with `viewport-fit=cover` | `src/app/layout.tsx` |
| 35 | Mobile back button falls back to `/chat` when `history.length <= 1` | `chat-layout.tsx` |
| 36/45 | Row actions always visible on touch; hover-only above `sm` | `conversation-item.tsx` |
| 37 | Mobile drawer `w-[85vw] max-w-xs` | `chat-layout.tsx` |
| 39 | Drawer `overscroll-contain` | `chat-layout.tsx` |
| 43 | Drawer slide/fade-in animation (`drawer-in` / `fade-in`) | `globals.css` + `chat-layout.tsx` |
| 57 | Composer `pb-[calc(1rem+env(safe-area-inset-bottom))]` | `chat-input.tsx` |
| 138 | 44px touch targets on all small icon buttons (`min-h-11`/`min-w-11`) | global pass |
| 139 | `touch-action: pan-y` on the messages scroller | `chat-interface.tsx` + `globals.css` |

## Phase 2 — Layout fixes (P1)

### Landing page (`src/app/page.tsx`)

| # | Change |
|---|--------|
| 13 | Navbar `py-2 md:py-3`, slimmer padding on mobile |
| 14 | Section anchors `scroll-mt-20 md:scroll-mt-24` |
| 15 | Hero `text-3xl` → `min-[400px]:text-4xl sm:text-5xl` |
| 16 | Hero banner `aspect-[4/3] sm:aspect-video` |
| 17 | Hero CTAs `w-full max-w-xs sm:w-auto` |
| 18 | Stats `grid-cols-1 min-[360px]:grid-cols-2 lg:grid-cols-4` |
| 19 | `tabular-nums` on stat values |
| 20 | Demo grid `gap-10` (was default) |
| 21 | ChatMockup rendered above the bullet copy on mobile (`order`) |
| 22 | How-it-works cards `flex sm:block` with `min-w-0` content |
| 23 | Feature cards `p-4 sm:p-5` |
| 24 | Feature icons `h-10 w-10 sm:h-11 sm:w-11` |
| 25 | Corpus titles `line-clamp-2 sm:truncate` |
| 26 | Topic chips `min-h-11` |
| 27 | FAQ buttons `min-h-11 py-3.5 sm:py-4` |
| 28 | Final CTA `px-5 py-10 sm:px-8 sm:py-14` |
| 29 | Footer `gap-6` |
| 30 | Back-to-top `bottom-20 right-4 sm:bottom-6 sm:right-6` (clears home indicator) |
| 31 | Mobile menu closes on Escape + route change (`usePathname`) |
| 32 | Main `pb-16 sm:pb-24`, `px-4 sm:px-6` |
| 33 | Gradient mesh `opacity-40 md:opacity-100` on phones |

### Chat (`chat-interface`, `chat-empty-state`, `chat-input`, `pipeline-status`, `message-bubble`)

| # | Change |
|---|--------|
| 46/58 | Empty state `py-10 sm:py-14`, illustration `h-20 w-20 sm:h-28 sm:w-28` |
| 47 | Follow-up chips `min-h-11` on touch |
| 48 | Scroll-to-bottom `bottom-36 right-4 sm:bottom-28 sm:right-6` |
| 49/50 | User/assistant bubbles capped and `break-words` |
| 51 | `MessageActions` `min-h-11 min-w-11` |
| 53 | Input controls `h-9 w-9 sm:h-10 sm:w-10` |
| 54 | Disclaimer/counter stack below `sm` |
| 55 | Mode toggle shrinks below 400px |
| 56 | Quick-prompt chips `overflow-x-auto` |
| 59 | Suggested-prompt cards `min-h-11 py-3.5` |
| 60 | No message-level affordance relies on hover |
| 61 | Pipeline status trail horizontally scrollable below `sm` |

### Sources / History / Settings / Login

| # | Change | Where |
|---|--------|-------|
| 62 | Heading `text-xl sm:text-2xl` | `sources/page.tsx` |
| 63 | Toolbar: search full-width on phones, filter strip scrollable | `source-browser.tsx` |
| 64 | "Back to documents" affordance on stacked detail pane | `source-browser.tsx` |
| 65 | Chunk nav `min-h-11 min-w-11` | `source-browser.tsx` |
| 68 | Chunk text `break-words`; copy button always visible on touch | `source-browser.tsx` |
| 69 | History stats `p-3.5`, `text-lg sm:text-xl` | `history-list.tsx` |
| 70 | Filter toolbar: mode radios full-width on phones, selects `flex-1` | `history-list.tsx` |
| 71 | Mode radios `min-h-11` |
| 72 | Row actions always visible on touch |
| 73 | Select-mode checkboxes `h-11 w-11` |
| 75 | Loader sentinel `pb-2` |
| 76 | Settings cards `p-4 sm:p-5` | `settings/page.tsx` |
| 77 | Font-size radios `min-h-11` |
| 78 | Profile row wraps |
| 80 | Sections `scroll-mt-20` |
| 81 | Login card `p-6 sm:p-8` | `login-content.tsx` |
| 82 | Login grid `px-4 py-10 sm:px-6 sm:py-16` |
| 83/86 | OAuth + guest buttons `min-h-12`, `active:scale` | `login-content.tsx`, `oauth-buttons.tsx` |
| 85 | Guest-info box `text-xs` |

### Admin (dashboard, pipeline tester, document manager)

| # | Change | Where |
|---|--------|-------|
| 87 | Sticky toolbar wraps; back link `min-h-11` | `admin/layout.tsx` |
| 88 | Nav tabs horizontally scrollable on phones |
| 89 | Metrics `grid-cols-1 min-[380px]:grid-cols-2 md:grid-cols-4` | `admin/dashboard/page.tsx` |
| 90 | Range radio + refresh wrap; radios `min-h-11` |
| 92 | Chart X-axis ticks `fontSize: 10`, `interval="preserveStartEnd"` | `dashboard-charts.tsx` |
| 94 | Tooltips `max-width: min(90vw, 320px)` |
| 97 | Query cell `line-clamp-2` with `min-w` |
| 98 | Top-question / failed-query rows `min-h-11`, titles `line-clamp-2` | `top-questions.tsx`, `failed-queries-card.tsx` |
| 99 | Pipeline-tester input + Run `min-h-12` | `pipeline-tester/page.tsx` |
| 100 | Example chips horizontally scrollable |
| 101 | Toggle group wraps cleanly (`lg:ml-auto`) |
| 102 | Stage header rows wrap; `StageNode` rewritten so the **entire header row toggles open/close**, chevron pinned top-right, keyboard accessible (`Enter`/`Space`), `aria-expanded` + `aria-controls` | `stage-node.tsx` |
| 103 | Dense/Sparse cards `grid-cols-1 sm:grid-cols-2` | `pipeline-visualizer.tsx` |
| 104 | ReAct step action `truncate` with `min-w-0` | `react-step.tsx` |
| 106 | Expanded queries `break-all` | `pipeline-visualizer.tsx` |
| 127 | URL ingest controls `min-h-12` | `document-manager.tsx` |
| 128 | Doc rows `flex-wrap` with `basis-56` titles `line-clamp-2` |
| 130 | Modal chunk nav `min-h-11 min-w-11` |

## Phase 3 — Tablet tuning (132–137)

| # | Change |
|---|--------|
| 132 | Hover-expand on the md icon rail is already click-only; touch tablets never trigger `hover:` — icon buttons remain tappable |
| 134 | Admin metrics go 4-across at `md` |
| 136 | Two-pane source browser stacks below `md`; back affordance added |

## Phase 4 — Polish & a11y (138–150)

| # | Change |
|---|--------|
| 109 | Tables `-webkit-overflow-scrolling: touch` |
| 110 | `pre` blocks `max-width: 100%` + touch scrolling |
| 111 | Heading margins trimmed below 640px |
| 113 | Body text `>= 16px` below 480px |
| 114 | `DialogContent` `max-h-[85dvh]` + `w-[calc(100vw-2rem)]` + `overscroll-contain` | `dialog.tsx` |
| 115–117 | Confirm/guest-limit dialogs inherit the clamp; changelog content scrolls inside (`max-h-[80dvh]`) |
| 118 | `Badge` `max-w-full truncate` |
| 119 | `Input` `min-h-11` + `text-base sm:text-sm` |
| 120 | `Button` sizes `min-h-10/11/12` |
| 122 | EmptyState `py-10 sm:py-16`, icon scales |
| 123 | ErrorState retry `min-h-11 w-full sm:w-auto` |
| 124 | BackButton `min-h-11` |
| 125 | GlassCard `min-w-0 break-words` |
| 126 | Tabs strip `overflow-x-auto`, items `shrink-0 whitespace-nowrap` |
| 141 | Scroll handlers passive (landing back-to-top) |
| 143 | Mesh/CTA shimmer disabled under `prefers-reduced-transparency` |
| 146 | All newly exposed mobile controls carry `aria-label` |
| 148 | Consistent `scroll-mt-20 md:scroll-mt-24` + `.scroll-mt-safe` utility |

---

## Verification

- `pnpm typecheck` — clean
- `pnpm lint` — 0 errors
- `pnpm prettier --check "src/**/*.{ts,tsx}"` — clean
- `pnpm vitest run` — 422/422 pass
- E2E (Playwright) landing + pipeline-tester specs — 13/13 pass (updated for the
  renamed "Bilingual Retrieval" feature and granular stage titles)
