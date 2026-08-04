# UI/UX Enhancement Audit Tracker

> **Audit basis:** Every row below was verified against the **actual source code** in `web-app/src/` (not against any status doc). Coding rules follow `Docs/Basic Prompt/CODING_STANDARDS.md` + `GUARDRAILS.md` as the single source of truth.
>
> **Legend:** ✅ Implemented (verified in code) · ⚠️ Partial (core present, notable gap vs plan) · ❌ Not implemented
>
> **Audit summary (2026-08-03):** 124 / 150 ✅ · 17 / 150 ⚠️ · 9 / 150 ❌

---

## 1. Global Design System & Theming

| ID | Task | Files | Status | Notes |
|---|---|---|---|---|
| 1.1 | Introduce a Formal Design-Token Scale | `src/app/globals.css`, `docs/design-tokens.md` | ✅ Implemented | `@theme` defines `--radius-*`, `--text-2xs`, full light/dark color tokens, `--shadow-glass`; `docs/design-tokens.md` documents them. |
| 1.2 | Build a Reusable Component Library | `src/components/ui/*` | ✅ Implemented | `Button`, `Input`, `Badge`, `Card`, `GlassCard`, `Skeleton`, `Dialog`, `ConfirmDialog`, `Tabs`, `Toast`, `EmptyState`, `ErrorState`, `ThemeToggle`, `CountUp`, `RouteLoader`, `CommandPalette`, `ChangelogModal`. |
| 1.3 | Add a Global Toast / Notification System | `src/components/ui/toast.tsx`, `src/lib/toast.tsx`, `src/lib/trpc/provider.tsx` | ✅ Implemented | `ToastProvider` mounted in `Providers`; used in chat, history (undo), sources (copy), pipeline tester. `aria-live` viewport, auto-dismiss, actions. |
| 1.4 | Standardize Focus-Visible Treatment | `src/app/globals.css` | ✅ Implemented | Global `:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px }`. |
| 1.5 | Color-Contrast Audit for Both Themes | `src/app/globals.css` | ✅ Implemented | Light muted `#525866` (~5.9:1 on `#faf7f2`); dark muted `#9aa4c0`. Documented in `docs/design-tokens.md`. |
| 1.6 | Add a Typography Scale & Vertical Rhythm | `src/app/globals.css` | ✅ Implemented | Semantic `.type-display/.type-title/.type-subtitle/.type-body/.type-caption` with line-height/letter-spacing. |
| 1.7 | Add a Loading Skeleton System | `src/components/ui/skeleton.tsx` | ✅ Implemented | `Skeleton` + `SkeletonList` (shimmer via `animate-pulse`); applied in sidebar, history, admin, sources, chat, all `loading.tsx`. |
| 1.8 | Add an Error Boundary with Recovery UI | `src/app/error.tsx`, `src/app/global-error.tsx` | ✅ Implemented | Branded recovery card with "Try again" + "Go home"; root boundary with own `<html>`. |
| 1.9 | Add a 404 Page | `src/app/not-found.tsx` | ✅ Implemented | Branded 404 with gradient mesh, "Back to home" + "Go to Chat". |
| 1.10 | Add a Loading State for Route Transitions | `src/app/loading.tsx`, `chat/loading.tsx`, `admin/loading.tsx`, `history/loading.tsx`, `sources/loading.tsx` | ✅ Implemented | `RouteLoader` + per-route branded skeletons. |
| 1.11 | Add a Brand Logo & Favicon Set | `public/`, `src/app/layout.tsx` | ⚠️ Partial | Logo mark (GraduationCap) in navbar/login/404 **done**, but `public/` still ships only default Next.js SVGs — no custom favicon, apple-touch-icon, or OG image asset (only `Images/hero-banner.jpg`). |
| 1.12 | Add Open Graph / Social Share Metadata | `src/app/layout.tsx` | ✅ Implemented | `openGraph` (1200×630 image), `twitter`, `robots`, `alternates`, `metadataBase`. |
| 1.13 | Add a Command Palette (⌘K) | `src/components/ui/command-palette.tsx`, `src/lib/trpc/provider.tsx` | ✅ Implemented | Fuzzy search, arrow-key nav, Esc close, theme toggle + sign-out actions, mounted app-wide. |
| 1.14 | Add a "What's New" / Changelog Modal | `src/components/ui/changelog-modal.tsx` | ✅ Implemented | Radix Dialog, triggered from landing footer. (Reads hardcoded entries, not `CHANGELOG.md`.) |

## 2. Landing Page

| ID | Task | Files | Status | Notes |
|---|---|---|---|---|
| 2.1 | Add a Sticky Glass Navbar | `src/app/page.tsx` | ✅ Implemented | Sticky glass header, nav links, theme toggle, "Get started" CTA, mobile hamburger with `aria-expanded`. |
| 2.2 | Add a Trust / Stats Bar | `src/app/page.tsx` | ✅ Implemented | 4-stat grid with `CountUp` scroll-into-view animation. |
| 2.3 | Add a "How It Works" 3-Step Section | `src/app/page.tsx` | ✅ Implemented | Numbered step cards + scroll-reveal. |
| 2.4 | Add a Live Chat Demo Mockup | `src/components/landing/chat-mockup.tsx` | ✅ Implemented | Animated mockup with streaming dots, source chips, thinking indicator. |
| 2.5 | Add a Testimonials / Social Proof Section | `src/app/page.tsx` | ✅ Implemented | 3-card testimonial grid with stars + avatars. |
| 2.6 | Add an FAQ Accordion Section | `src/app/page.tsx` | ✅ Implemented | 3-question accordion with `aria-expanded` + rotate chevron. |
| 2.7 | Add a Final CTA Section | `src/app/page.tsx` | ✅ Implemented | "Ready to start your German journey?" band + shimmer CTA. |
| 2.8 | Improve Hero Typography & Hierarchy | `src/app/page.tsx` | ✅ Implemented | `text-4xl sm:text-5xl lg:text-6xl`, gradient accent on "German Immigration". |
| 2.9 | Add Scroll-Reveal Animations | `src/app/page.tsx` | ✅ Implemented | framer-motion `whileInView` + `useReducedMotion` guard. |
| 2.10 | Add Feature Icons to Feature Cards | `src/app/page.tsx` | ✅ Implemented | Distinct lucide icons in colored chips (Bot, Database, ShieldCheck, Zap, Eye, BarChart3). |
| 2.11 | Add a "Supported Topics" Tag Cloud | `src/app/page.tsx` | ✅ Implemented | 12-topic pill cloud. (Links to `/login`, not a pre-filled chat query.) |
| 2.12 | Add a Footer with Real Links | `src/app/page.tsx` | ✅ Implemented | Multi-column footer with Chat/History/Knowledge base links + changelog trigger. |
| 2.13 | Add a "Back to Top" Floating Button | `src/app/page.tsx` | ✅ Implemented | Appears after 600px scroll; smooth scroll respecting reduced motion. |

## 3. Auth & Login Experience

| ID | Task | Files | Status | Notes |
|---|---|---|---|---|
| 3.1 | Add Gradient-Mesh Background to Login | `src/app/login/login-content.tsx` | ✅ Implemented | Reuses `gradient-mesh`. |
| 3.2 | Add a Split-Screen Layout | `src/app/login/login-content.tsx` | ✅ Implemented | `lg:grid-cols-2` brand story + login card. |
| 3.3 | Add Loading States to OAuth Buttons | `src/components/auth/oauth-buttons.tsx` | ✅ Implemented | Per-provider spinner + "Redirecting…", both disabled during auth. |
| 3.4 | Add Auth Error / Rate-Limit Feedback | `src/app/login/login-content.tsx` | ✅ Implemented | Maps NextAuth `?error=` (incl. `RateLimit`) to friendly banner with `role="alert"`. (No retry countdown — not critical.) |
| 3.5 | Add a "Why sign in?" Helper Text | `src/app/login/login-content.tsx` | ✅ Implemented | Benefit list with icons (Save, Personalized, Export). |
| 3.6 | Add a "Back to Home" Link | `src/app/login/login-content.tsx` | ✅ Implemented | Top-left "Back to home" pill. |
| 3.7 | Add a Privacy Note with Link | `src/app/login/login-content.tsx` | ✅ Implemented | ShieldCheck note + Terms / Privacy Policy links. |
| 3.8 | Add a "New here?" Section | `src/app/login/login-content.tsx` | ✅ Implemented | "New here? See how it works" → `/#how-it-works`. |
| 3.9 | Add a Branded Logo to the Login Card | `src/app/login/login-content.tsx` | ✅ Implemented | GraduationCap mark above heading (desktop + mobile). |
| 3.10 | Add a "Continue as Guest" Option | `src/app/login/login-content.tsx`, `src/middleware.ts`, `src/auth.config.ts`, `src/server/auth.ts`, `src/server/trpc/t.ts` | ⚠️ Partial | UI button + expander exist but are a placeholder ("Guest browsing isn't available yet"). **Backend: NONE** — only GitHub/Google/Resend providers; `middleware.ts` redirects unauthenticated users of /chat,/history,/settings,/sources to /login; every tRPC procedure requires a session (`protectedProcedure` → UNAUTHORIZED); no guest/anonymous model in Prisma. Needs a full anonymous-session design. |

## 4. Chat Interface & Message Bubbles

| ID | Task | Files | Status | Notes |
|---|---|---|---|---|
| 4.1 | Add Rich Suggested-Prompt Cards | `src/components/chat/chat-interface.tsx` | ✅ Implemented | 4 icon+title+description cards. |
| 4.2 | Add Message Entrance Animations | `src/components/chat/message-bubble.tsx`, `chat-interface.tsx` | ✅ Implemented | framer-motion fade/slide, reduced-motion guard. |
| 4.3 | Add Message Action Buttons (Copy, Retry, Feedback) | `src/components/chat/message-bubble.tsx` | ✅ Implemented | Copy (toast), Thumbs up/down (persisted via `chat.feedback`), Regenerate. Hover-reveal desktop / visible mobile. |
| 4.4 | Add a "Scroll to Bottom" Floating Button | `src/components/chat/chat-interface.tsx` | ✅ Implemented | Appears >120px from bottom, smooth-scrolls. |
| 4.5 | Add a Typing / Thinking Indicator | `src/components/chat/chat-interface.tsx` | ✅ Implemented | Branded 3-dot indicator while `isStreaming && status === "idle"`. |
| 4.6 | Add Timestamp Separators | `src/components/chat/chat-interface.tsx` | ✅ Implemented | Today / Yesterday / date separators between day changes. |
| 4.7 | Add Source Chips with Favicons | `src/components/chat/source-citation.tsx` | ⚠️ Partial | Collapsible source list with relevance bar + score % **done**, but rows are text links (ExternalLink icon) — no Google favicon chips as proposed. |
| 4.8 | Add "Served from cache" Visual Treatment | `src/components/chat/message-bubble.tsx` | ✅ Implemented | Zap badge "Answered from cache (Ns)" with tooltip. |
| 4.9 | Add Suggested Follow-Up Questions | `src/components/chat/chat-interface.tsx` | ✅ Implemented | Keyword-matched follow-up chips after assistant answers. |
| 4.10 | Add a "Regenerate" Action on the Last Answer | `src/components/chat/chat-interface.tsx`, `message-bubble.tsx` | ✅ Implemented | `chat.regenerate` wired via `useChat.regenerate`. |
| 4.11 | Add a "Copy Conversation" Action | `src/components/chat/chat-interface.tsx` | ✅ Implemented | Header button → Markdown transcript → clipboard + toast. |
| 4.12 | Add a "Clear Conversation" Action | `src/components/chat/chat-interface.tsx` | ✅ Implemented | Trash icon + `ConfirmDialog`. |
| 4.13 | Add a "New Chat" Button in the Chat Header | `src/components/chat/chat-interface.tsx` | ✅ Implemented | "+ New chat" header button. |
| 4.14 | Add a "Model / Mode" Indicator in the Header | `src/components/chat/chat-interface.tsx` | ✅ Implemented | Badge showing Agentic/Standard with icons. |
| 4.15 | Add a "Disambiguation" Visual Treatment | `src/components/chat/disambiguation-cards.tsx` | ✅ Implemented | HelpCircle header, divider, hover lift + arrow, reduced-motion guard. |
| 4.16 | Add a "Pipeline Stage" Progress Bar | `src/components/chat/pipeline-status.tsx` | ✅ Implemented | Animated fill bar, %, `role="progressbar"`, checkmarks + pulsing active stage, `aria-live`. |
| 4.17 | Add a "Stop" Button with Progress Ring | `src/components/chat/chat-input.tsx` | ✅ Implemented | Conic-gradient progress ring around stop button. |
| 4.18 | Add an Empty-State Hero Illustration | `src/components/chat/chat-interface.tsx` | ✅ Implemented | Animated floating illustration, reduced-motion guard. |

## 5. Chat Input & Composition

| ID | Task | Files | Status | Notes |
|---|---|---|---|---|
| 5.1 | Add Auto-Resize with Smooth Animation | `src/components/chat/chat-input.tsx` | ✅ Implemented | Height auto-computes (40–160px) with `transition-[height] duration-150`. |
| 5.2 | Add a Character / Token Counter | `src/components/chat/chat-input.tsx` | ✅ Implemented | "1,240 / 4,000" counter, amber at 90%, red at limit. |
| 5.3 | Add a "Clear Input" Button | `src/components/chat/chat-input.tsx` | ✅ Implemented | "×" appears when text present; clears + refocuses. |
| 5.4 | Add a "Paste" / "Attach" Affordance | `src/components/chat/chat-input.tsx` | ✅ Implemented | Clipboard-paste button inserts text at caret (respects 4k cap), toast on unavailable. |
| 5.5 | Add a "Mode" Toggle with Better Visual Design | `src/components/chat/chat-input.tsx` | ✅ Implemented | Segmented control with `aria-pressed`, icons, clear labels. (No sliding-pill `layoutId` animation — cosmetic.) |
| 5.6 | Add a "Send" Button Hover/Active State | `src/components/chat/chat-input.tsx` | ✅ Implemented | Hover lift + shadow, `active:scale-95`. |
| 5.7 | Add a "Disclaimer" with Better Visual Treatment | `src/components/chat/chat-input.tsx` | ✅ Implemented | AlertCircle + tooltip, "AI may make mistakes — verify against official sources." |
| 5.8 | Add a "Suggested Prompt" Quick-Access Row | `src/components/chat/chat-input.tsx` | ✅ Implemented | Scrollable chips shown when input empty (not streaming). |
| 5.9 | Add a "Focus" Ring on the Input | `src/components/chat/chat-input.tsx` | ✅ Implemented | `focus-within:ring-4 ring-primary/15` glow. |
| 5.10 | Add a "Draft Persistence" Feature | `src/components/chat/chat-input.tsx` | ✅ Implemented | Per-conversation `localStorage` draft restore. |
| 5.11 | Add a "Streaming" Visual State on the Input | `src/components/chat/chat-input.tsx` | ✅ Implemented | "Generating answer…" (`role="status"`), send disabled, stop active. |
| 5.12 | Add a "Max Length" Guard with Visual Feedback | `src/components/chat/chat-input.tsx` | ✅ Implemented | `MAX_QUERY_LENGTH = 4000` enforced (input + paste), red counter + warning border. (No shake animation — cosmetic.) |

## 6. Sidebar & Navigation

| ID | Task | Files | Status | Notes |
|---|---|---|---|---|
| 6.1 | Add a Collapsible Sidebar | `src/components/chat/chat-layout.tsx`, `sidebar/app-sidebar.tsx` | ✅ Implemented | Collapse to 64px icon rail, persisted in localStorage. |
| 6.2 | Add a "Search Conversations" Field in the Sidebar | `src/components/sidebar/app-sidebar.tsx` | ✅ Implemented | Debounced search filters list server-side. |
| 6.3 | Add a "Today / Yesterday / Previous 7 Days" Grouping | `src/components/sidebar/app-sidebar.tsx`, `lib/conversation-groups.ts` | ✅ Implemented | 4 time buckets with section headers. |
| 6.4 | Add a "Pin Conversation" Feature | `src/components/sidebar/conversation-item.tsx`, `app-sidebar.tsx` | ✅ Implemented | Pin icon, pinned-first ordering within groups, localStorage persistence. |
| 6.5 | Add a "Rename Conversation" Inline Action | `src/components/sidebar/conversation-item.tsx` | ✅ Implemented | Inline input, Enter save / Esc cancel / blur save. |
| 6.6 | Add a "Delete" Confirmation Dialog | `src/components/sidebar/conversation-item.tsx` | ⚠️ Partial | Two-click inline confirm (Delete/Cancel) — accessible but **not** a modal dialog as proposed. |
| 6.7 | Add a "New Chat" Button with Keyboard Shortcut | `src/components/sidebar/app-sidebar.tsx` | ✅ Implemented | Global ⌘N / Ctrl+N (single listener, skipped on mobile drawer). |
| 6.8 | Add a "User Profile" Section at the Bottom | `src/components/sidebar/app-sidebar.tsx` | ⚠️ Partial | Avatar + name + email row **done** (navigates to Settings), but no dropdown menu (Settings/Sign out/Theme) as proposed. |
| 6.9 | Add a "Knowledge Base" Badge / Status | `src/components/sidebar/app-sidebar.tsx` | ✅ Implemented | Document-count badge on nav item. |
| 6.10 | Add a "Mobile Bottom Sheet" Navigation | `src/components/chat/chat-layout.tsx` | ⚠️ Partial | Mobile drawer is a **left slide-in panel** with backdrop — functional, but not a bottom-sheet with drag handle as proposed. |
| 6.11 | Add a "Sidebar Loading Skeleton" | `src/components/sidebar/app-sidebar.tsx` | ✅ Implemented | `SkeletonList` rows while loading. |
| 6.12 | Add a "Sidebar Empty State" with CTA | `src/components/sidebar/app-sidebar.tsx` | ✅ Implemented | "Start your first chat" button. |
| 6.13 | Add a "Version / Build" Indicator | `src/components/sidebar/app-sidebar.tsx`, `lib/version.ts` | ✅ Implemented | `v0.6.0` footer with tooltip. |

## 7. History & Conversation Management

| ID | Task | Files | Status | Notes |
|---|---|---|---|---|
| 7.1 | Add a "Date Range" Filter | `src/components/history/history-list.tsx` | ✅ Implemented | All time / 7d / 30d select. |
| 7.2 | Add a "Mode" Filter | `src/components/history/history-list.tsx` | ✅ Implemented | All / Agentic / Standard segmented control. |
| 7.3 | Add a "Bulk Select" Mode | `src/components/history/history-list.tsx` | ✅ Implemented | Checkboxes, select-all-shown, bulk delete + bulk export. |
| 7.4 | Add a "Delete All" Action with Confirmation | `src/components/history/history-list.tsx` | ✅ Implemented | Filter-aware "Delete all" with two-click confirm. |
| 7.5 | Add a "Preview" Modal on Click | `src/components/history/history-list.tsx` | ❌ Not implemented | Clicking a conversation navigates straight to the chat — no preview modal. |
| 7.6 | Add a "Search-as-You-Type" (Debounced) | `src/components/history/history-list.tsx` | ✅ Implemented | 300ms debounce via `useDebouncedValue`. |
| 7.7 | Add a "Result Count" Indicator | `src/components/history/history-list.tsx` | ✅ Implemented | "N conversations … matching your search" (`aria-live`). |
| 7.8 | Add a "Sort" Control | `src/components/history/history-list.tsx` | ✅ Implemented | Recently updated / created / title. |
| 7.9 | Add a "Conversation Card" Redesign | `src/components/history/history-list.tsx` | ✅ Implemented | Cards with title, preview, mode badge, message count, relative time, hover actions. |
| 7.10 | Add a "Export All" Button | `src/components/history/history-list.tsx` | ✅ Implemented | Bulk export → concatenated Markdown download; per-item export too. |
| 7.11 | Add a "Loading Skeleton" for History List | `src/components/history/history-list.tsx` | ✅ Implemented | `SkeletonList`. |
| 7.12 | Add a "Delete" Undo Toast | `src/components/history/history-list.tsx` | ✅ Implemented | Soft-delete + toast with "Undo" (restore mutation). |
| 7.13 | Add a "History" Page Header with Stats | `src/app/history/page.tsx` | ⚠️ Partial | Simple heading + subtitle only — no total-count/messages stats or "New chat" CTA. |

## 8. Sources / Knowledge Base

| ID | Task | Files | Status | Notes |
|---|---|---|---|---|
| 8.1 | Add a "Document Type" Filter | `src/components/sources/source-browser.tsx` | ✅ Implemented | All / PDF / Web segmented control. |
| 8.2 | Add a "Document Card" Grid View | `src/components/sources/source-browser.tsx` | ✅ Implemented | List ↔ grid toggle with icon, title, chunk count, type. |
| 8.3 | Add a "Chunk Preview" with Highlighted Search Terms | `src/components/sources/source-browser.tsx` | ✅ Implemented | `<mark>` highlighting of matching terms. |
| 8.4 | Add a "Copy Chunk" Action | `src/components/sources/source-browser.tsx` | ✅ Implemented | Copy icon + toast. |
| 8.5 | Add a "Chunk Navigation" (Prev/Next) | `src/components/sources/source-browser.tsx` | ⚠️ Partial | Prev/next navigates **documents**, not individual chunks; chunks still use "Load more". |
| 8.6 | Add a "Document Stats" Header | `src/components/sources/source-browser.tsx` | ✅ Implemented | Documents / chunks / last-synced stats bar. |
| 8.7 | Add a "Source Type" Badge | `src/components/sources/source-browser.tsx` | ✅ Implemented | PDF / Web icon badges. |
| 8.8 | Add a "Refresh" Button | `src/components/sources/source-browser.tsx` | ✅ Implemented | Query invalidation. |
| 8.9 | Add a "Last Synced" Timestamp | `src/components/sources/source-browser.tsx` | ✅ Implemented | "Last synced X". |
| 8.10 | Add a "Document Detail" Drawer | `src/components/sources/source-browser.tsx` | ✅ Implemented | Two-pane detail panel keeps list visible (satisfies the intent; not an animated slide-in). |
| 8.11 | Add a "Chunk Relevance" Score Bar | `src/components/sources/source-browser.tsx` | ❌ Not implemented | Chunks show text + id only — no score/retrieval bar. |
| 8.12 | Add a "Search Within Document" Feature | `src/components/sources/source-browser.tsx` | ✅ Implemented | Dedicated chunk search input. |
| 8.13 | Add a "Document URL" Copy Action | `src/components/sources/source-browser.tsx` | ✅ Implemented | Copy-link icon + toast. |
| 8.14 | Add a "Knowledge Base" Empty State with CTA | `src/components/sources/source-browser.tsx` | ⚠️ Partial | Empty state text mentions admin panel but has **no clickable CTA** (no link/button). |

## 9. Admin Dashboard

| ID | Task | Files | Status | Notes |
|---|---|---|---|---|
| 9.1 | Add a "Date Range" Selector | `src/app/admin/dashboard/page.tsx` | ✅ Implemented | 7d / 14d / 30d segmented control, refetches on change. |
| 9.2 | Add "Trend Indicators" to Metric Cards | `src/components/admin/metric-card.tsx` | ✅ Implemented | Arrow + % change (green/red) wired for messages trend. |
| 9.3 | Add "Sparklines" to Metric Cards | `src/components/admin/metric-card.tsx` | ❌ Not implemented | No sparkline visualization on cards. |
| 9.4 | Add a "Refresh" Button with Auto-Refresh | `src/app/admin/dashboard/page.tsx` | ✅ Implemented | Manual refresh + 60s `refetchInterval`. |
| 9.5 | Add a "Last Updated" Timestamp | `src/app/admin/dashboard/page.tsx` | ✅ Implemented | "Last updated HH:MM:SS · auto-refreshes every 60s". |
| 9.6 | Add "Chart Loading Skeletons" | `src/components/admin/dashboard-charts.tsx` | ✅ Implemented | `ChartShell` skeleton placeholders. |
| 9.7 | Add "Chart Empty States" | `src/components/admin/dashboard-charts.tsx` | ✅ Implemented | "No data in this period yet." |
| 9.8 | Add "Chart Tooltips" with More Detail | `src/components/admin/dashboard-charts.tsx` | ⚠️ Partial | Styled tooltips show the value only — no %-change vs previous day or breakdown. |
| 9.9 | Add a "Top Questions" List | `src/app/admin/dashboard/page.tsx`, `top-questions.tsx` | ✅ Implemented | Ranked list with count bars. |
| 9.10 | Add a "Failed Queries" Alert Card | `src/app/admin/dashboard/page.tsx`, `failed-queries-card.tsx` | ✅ Implemented | Red-tinted card with drill-in links. |
| 9.11 | Add a "Cache Health" Gauge | `src/components/admin/dashboard-charts.tsx` | ⚠️ Partial | Donut chart with legend **done**; no color-coded threshold gauge (green/amber/red) and no "Clear cache" action. |
| 9.12 | Add "Clickable Table Rows" with Drill-In | `src/components/admin/recent-queries-table.tsx` | ⚠️ Partial | Rows are keyboard-navigable and open the conversation — but no detail drawer with full query/response/latency breakdown. |
| 9.13 | Add a "Pagination" or "Load More" for Recent Queries | `src/components/admin/recent-queries-table.tsx`, `src/server/routers/admin.ts` | ❌ Not implemented | UI: fixed list, no load-more. **Backend: PARTIAL** — `admin.recentQueries` takes `limit` (≤100) + `days` but no `cursor`/`nextCursor` (top-N `LIMIT` only); contrast `conversation.list`, which has full keyset cursor pagination to copy. |
| 9.14 | Add a "Dashboard Overview" Header with Date | `src/app/admin/dashboard/page.tsx` | ✅ Implemented | "Dashboard" + full date + stats summary. |

## 10. Admin Documents & Pipeline Tester

| ID | Task | Files | Status | Notes |
|---|---|---|---|---|
| 10.1 | Add a "Document Status" Badge | `src/components/admin/document-manager.tsx` | ✅ Implemented | Synced / stale badges (color-coded). |
| 10.2 | Add a "Progress Bar" for Ingest | `src/components/admin/document-manager.tsx` | ⚠️ Partial | Indeterminate bar shown for **sync**; URL ingest shows text feedback only (no staged progress). PDF upload has a real bar. |
| 10.3 | Add a "Document Preview" Modal | `src/components/admin/document-manager.tsx` | ❌ Not implemented | No detail modal — list shows title/url/chunks inline. |
| 10.4 | Add a "Bulk Delete" Mode | `src/components/admin/document-manager.tsx`, `src/server/routers/document.ts` | ❌ Not implemented | UI: per-document delete only, no checkboxes. **Backend: READY** — `documentRouter.deleteMany({ ids ≤100 })` exists (bulk delete + per-doc semantic-cache invalidation + corpus invalidation, returns `deletedCount`/`deletedChunks`); only the UI bulk-select is missing. |
| 10.5 | Add a "Search" Filter for Documents | `src/components/admin/document-manager.tsx` | ✅ Implemented | Filter input. |
| 10.6 | Add a "Sort" Control for Documents | `src/components/admin/document-manager.tsx` | ❌ Not implemented | No sort control. |
| 10.7 | Add a "PDF Upload" Progress Bar | `src/components/admin/document-manager.tsx` | ✅ Implemented | Real XHR upload progress (0–90% upload, then 100%). |
| 10.8 | Add a "Drag & Drop" Visual Feedback | `src/components/admin/document-manager.tsx` | ⚠️ Partial | Border highlight on drag **done**, but no full overlay with large icon / "Drop to upload" scale animation. |
| 10.9 | Add a "Clear Cache" Confirmation Dialog | `src/components/admin/document-manager.tsx` | ⚠️ Partial | Two-click inline confirm text (no modal dialog). |
| 10.10 | Add a "Sync All" Progress Indicator | `src/components/admin/document-manager.tsx` | ✅ Implemented | Indeterminate bar "Syncing all documents…". |
| 10.11 | Add a "Pipeline Tester" Result Timeline | `src/components/admin/pipeline/pipeline-visualizer.tsx`, `stage-node.tsx` | ✅ Implemented | Expandable step-by-step timeline with statuses (done/warning/skipped/running/pending), connector lines, per-stage bodies. |
| 10.12 | Add a "Copy Trace" Action | `src/app/admin/pipeline-tester/page.tsx` | ✅ Implemented | "Copy trace" → JSON → clipboard + toast. |
| 10.13 | Add "Example Prompts" with Icons | `src/app/admin/pipeline-tester/page.tsx` | ✅ Implemented | Icon + label pill examples. |
| 10.14 | Add a "Pipeline Tester" History | `src/app/admin/pipeline-tester/page.tsx`, `src/server/routers/admin.ts`, `prisma/schema.prisma` | ❌ Not implemented | UI: traces ephemeral in component state. **Backend: NONE** — `admin.testPipeline` runs with a `NoopMemory` adapter and never persists; no PipelineRun/trace table in Prisma; no list/get history procedure. Needs a `PipelineRun` model + `listTestRuns`/`getTestRun` procedures. |

## 11. Accessibility, Responsive & Motion

| ID | Task | Files | Status | Notes |
|---|---|---|---|---|
| 11.1 | Add ARIA Labels to All Icon-Only Buttons | All components | ✅ Implemented | Audited: header, sidebar, history, sources, admin, toast, theme toggle, back-to-top, scroll-to-bottom all carry `aria-label`. |
| 11.2 | Add `aria-live` Regions for Streaming Updates | `chat-interface.tsx`, `pipeline-status.tsx` | ✅ Implemented | `role="log" aria-live="polite"` on message list; `aria-live` on pipeline status, notices, toasts, result count. |
| 11.3 | Add Keyboard Navigation for All Interactive Elements | All components | ✅ Implemented | Radix Dialog focus trap + Esc; command palette arrows/Enter; `tabIndex` rows with Enter/Space in history + recent queries; rename Enter/Esc. |
| 11.4 | Add `prefers-reduced-motion` Guards for All Animations | `globals.css`, framer-motion components | ✅ Implemented | CSS media query + `useReducedMotion()` in landing, chat, disambiguation, mockup, count-up. |
| 11.5 | Add Touch-Target Sizes ≥ 44px on Mobile | All components | ⚠️ Partial | Many controls are 36–40px (`h-9 w-9`, `h-10`) — improved but not all reach 44px. |
| 11.6 | Add Safe-Area Insets for iOS | `globals.css`, `chat-layout.tsx` | ✅ Implemented | `.safe-bottom` / `.safe-top` utilities + applied in chat layout main. |
| 11.7 | Add a "Skip to Content" Link | `src/app/layout.tsx` | ✅ Implemented | `sr-only focus:not-sr-only` skip link. |
| 11.8 | Add a "Mobile Responsive" Audit for All Pages | All pages | ✅ Implemented | Responsive grids, `overflow-x-auto` tables, stacked layouts at `sm/md/lg`. |
| 11.9 | Add a "Tablet" Breakpoint Optimization | `admin/dashboard/page.tsx`, `source-browser.tsx`, `history-list.tsx` | ✅ Implemented | `md:` / `lg:` grid refinements in charts, sources, history. |
| 11.10 | Add a "Landscape Mobile" Optimization | `chat-layout.tsx` | ✅ Implemented | `md:block` rail + collapsible icon rail applies at landscape phone widths (≥768px). |
| 11.11 | Add a "High Contrast" Mode | `globals.css`, `settings/page.tsx`, `preference-provider.tsx` | ✅ Implemented | `data-high-contrast` CSS + Settings toggle. |
| 11.12 | Add a "Font Size" Accessibility Setting | `settings/page.tsx`, `preference-provider.tsx` | ✅ Implemented | 4-step scale, `data-font-scale` → root font-size. |
| 11.13 | Add a "Screen Reader" Test Pass | All components | ⚠️ Partial | Semantic structure (`role="log"`, `role="radiogroup"`, `aria-pressed`, labels) is in place, but no evidence of an actual VoiceOver/NVDA pass being recorded. |
| 11.14 | Add a "Color Blind" Palette Check | `globals.css`, `dashboard-charts.tsx` | ❌ Not implemented | `CHART_COLORS` still uses the exact flagged hues (`#6366f1`, `#0ea5e9`, `#16a34a`, `#d97706`, `#dc2626`); no pattern/texture differentiation. |
| 11.15 | Add a "Motion" Settings Toggle | `settings/page.tsx`, `preference-provider.tsx` | ✅ Implemented | "Reduce motion" checkbox → `data-force-reduced-motion`. |

---

## Scorecard

| Verdict | Count | Items |
|---|---|---|
| ✅ Implemented | **124** | 1.1–1.10, 1.12–1.14, 2.1–2.13, 3.1–3.9, 4.1–4.6, 4.8–4.18, 5.1–5.12, 6.1–6.5, 6.7, 6.9, 6.11–6.13, 7.1–7.4, 7.6–7.12, 8.1–8.4, 8.6–8.10, 8.12–8.13, 9.1–9.2, 9.4–9.7, 9.9–9.10, 9.14, 10.1, 10.5, 10.7, 10.10–10.13, 11.1–11.4, 11.6–11.12, 11.15 |
| ⚠️ Partial | **17** | 1.11, 3.10, 4.7, 6.6, 6.8, 6.10, 7.13, 8.5, 8.14, 9.8, 9.11, 9.12, 10.2, 10.8, 10.9, 11.5, 11.13 |
| ❌ Not implemented | **9** | 7.5, 8.11, 9.3, 9.13, 10.3, 10.4, 10.6, 10.14, 11.14 |
