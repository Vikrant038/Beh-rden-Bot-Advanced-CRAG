# Behörden-Bot — 150-Point UI/UX Enhancement Plan
> **Author:** Professional UI/UX Design Review
> **Date:** March 2026
> **Scope:** `web-app` — Next.js 15 + React 19 + Tailwind CSS 4
> **Goal:** Elevate the product from a functional AI assistant to a polished, trustworthy, delightful experience for Indian students navigating German immigration.

---

## Table of Contents

1. [Global Design System & Theming](#1-global-design-system--theming)
2. [Landing Page](#2-landing-page)
3. [Auth & Login Experience](#3-auth--login-experience)
4. [Chat Interface & Message Bubbles](#4-chat-interface--message-bubbles)
5. [Chat Input & Composition](#5-chat-input--composition)
6. [Sidebar & Navigation](#6-sidebar--navigation)
7. [History & Conversation Management](#7-history--conversation-management)
8. [Sources / Knowledge Base](#8-sources--knowledge-base)
9. [Admin Dashboard](#9-admin-dashboard)
10. [Admin Documents & Pipeline Tester](#10-admin-documents--pipeline-tester)
11. [Accessibility, Responsive & Motion](#11-accessibility-responsive--motion)
12. [Prioritized Execution Roadmap](#prioritized-execution-roadmap)

---

## 1. Global Design System & Theming

### 1.1 — Introduce a Formal Design-Token Scale
**Files:** `src/app/globals.css`
**Current:** Ad-hoc spacing (`px-4`, `py-2.5`, `gap-3`) and radius values (`rounded-xl`, `rounded-2xl`) scattered across components.
**Proposed:** Define semantic tokens in `@theme` — `--spacing-*`, `--radius-*`, `--font-size-*`, `--shadow-*` — and document them in a `docs/design-tokens.md` reference. This ensures visual rhythm consistency across every surface.
**Priority:** P0 · **Effort:** M

### 1.2 — Build a Reusable Component Library
**Files:** `src/components/ui/*`
**Current:** Buttons, inputs, badges, and cards are hand-rolled Tailwind classes repeated in every file (e.g., `rounded-xl border border-border bg-surface px-4 py-2.5`).
**Proposed:** Create `Button`, `Input`, `Textarea`, `Badge`, `Card`, `Tooltip`, `Toast`, `Dialog`, `DropdownMenu`, `Tabs`, `Skeleton` primitives using `class-variance-authority` (already a dependency). This eliminates drift, speeds future work, and enables consistent states (loading, disabled, focus, error).
**Priority:** P0 · **Effort:** L

### 1.3 — Add a Global Toast / Notification System
**Files:** `src/components/ui/toast.tsx`, `src/lib/toast.tsx`, `src/app/layout.tsx`
**Current:** Feedback is inline text (e.g., `ingestFeedback`, `pdfFeedback`) or silent failures. No global success/error surface.
**Proposed:** Implement a lightweight toast provider (framer-motion animated, top-right, auto-dismiss) used for: document ingest success/failure, conversation export, delete confirmations, cache clears, and auth errors.
**Priority:** P0 · **Effort:** M

### 1.4 — Standardize Focus-Visible Treatment
**Files:** All interactive components
**Current:** Some elements have `focus-visible:ring-2 focus-visible:ring-primary`; many buttons/links lack it entirely (e.g., sidebar nav buttons, history action buttons, source citation links).
**Proposed:** Add a global `:focus-visible` style in `globals.css` (e.g., `outline: 2px solid var(--color-primary); outline-offset: 2px`) and remove per-component ring classes where redundant. Guarantee keyboard users always see where they are.
**Priority:** P0 · **Effort:** S

### 1.5 — Color-Contrast Audit for Both Themes
**Files:** `src/app/globals.css`
**Current:** `--color-muted: #6b7280` on `--color-background: #faf7f2` may fail WCAG AA (4.5:1) for small text. Dark theme `--color-muted: #9aa4c0` on `#0b1020` is borderline.
**Proposed:** Run a contrast audit (axe / Lighthouse) and adjust muted/foreground values to pass AA for all text sizes. Document the final palette with contrast ratios.
**Priority:** P0 · **Effort:** S

### 1.6 — Add a Typography Scale & Vertical Rhythm
**Files:** `src/app/globals.css`, all pages
**Current:** Headings use ad-hoc `text-xl`, `text-2xl`, `text-4xl` with inconsistent line-heights and margins.
**Proposed:** Define a type scale (display / h1–h4 / body / caption / overline) with consistent `line-height` and `letter-spacing`. Apply globally so every page shares the same hierarchy.
**Priority:** P1 · **Effort:** M

### 1.7 — Add a Loading Skeleton System
**Files:** `src/components/ui/skeleton.tsx`
**Current:** Only `SourceBrowser` uses skeletons. Most pages show "Loading…" text or nothing.
**Proposed:** Create a `Skeleton` primitive (shimmer animation, respects reduced-motion) and apply to: chat history sidebar, history list, admin dashboard cards, documents list, and pipeline tester.
**Priority:** P1 · **Effort:** M

### 1.8 — Add an Error Boundary with Recovery UI
**Files:** `src/app/error.tsx`, `src/app/global-error.tsx`
**Current:** No error boundary exists. A runtime error crashes the whole app with a blank page.
**Proposed:** Add Next.js error boundaries with a friendly, branded recovery screen (icon, message, "Try again" button, "Go home" link).
**Priority:** P0 · **Effort:** S

### 1.9 — Add a 404 Page
**Files:** `src/app/not-found.tsx`
**Current:** Default Next.js 404 page — unstyled, off-brand.
**Proposed:** Custom 404 with the Behörden-Bot brand, a helpful message ("This page doesn't exist"), and links back to Chat / Home.
**Priority:** P1 · **Effort:** S

### 1.10 — Add a Loading State for Route Transitions
**Files:** `src/app/loading.tsx`, `src/app/chat/loading.tsx`, `src/app/admin/loading.tsx`
**Current:** Route changes feel abrupt; no visual feedback while server components load.
**Proposed:** Add per-route `loading.tsx` files with branded skeleton screens (pulsing glass cards, shimmer).
**Priority:** P1 · **Effort:** S

### 1.11 — Add a Brand Logo & Favicon Set
**Files:** `public/`, `src/app/layout.tsx`
**Current:** Only default Next.js SVGs (`next.svg`, `vercel.svg`, `file.svg`, `globe.svg`, `window.svg`) and a default favicon.
**Proposed:** Design a simple, memorable logo mark (e.g., a stylized "B" or document/flag motif) and generate favicon, apple-touch-icon, and OG image assets.
**Priority:** P1 · **Effort:** S

### 1.12 — Add Open Graph / Social Share Metadata
**Files:** `src/app/layout.tsx`
**Current:** Only `title` and `description` metadata. No OG image, Twitter card, or canonical URL.
**Proposed:** Add `openGraph`, `twitter`, `robots`, and `alternates` metadata with a branded OG image (1200×630) for better link sharing.
**Priority:** P1 · **Effort:** S

### 1.13 — Add a Command Palette (⌘K)
**Files:** `src/components/ui/command-palette.tsx`, `src/app/layout.tsx`
**Current:** Navigation is limited to sidebar clicks. Power users have no keyboard shortcut to jump between Chat, History, Sources, Settings, Admin.
**Proposed:** Implement a ⌘K / Ctrl-K command palette with fuzzy search over: new chat, recent conversations, pages, and quick actions (toggle theme, export, sign out).
**Priority:** P2 · **Effort:** L

### 1.14 — Add a "What's New" / Changelog Modal
**Files:** `src/components/ui/changelog-modal.tsx`
**Current:** No way for users to discover new features or updates.
**Proposed:** A lightweight "What's new" modal (triggered from sidebar footer) that reads from `CHANGELOG.md` and shows recent releases with a "dismiss" state persisted in localStorage.
**Priority:** P2 · **Effort:** M

---

## 2. Landing Page

### 2.1 — Add a Sticky Glass Navbar
**Files:** `src/app/page.tsx`
**Current:** A minimal header with just the brand name and a "Sign in" button.
**Proposed:** A sticky, glass-blur navbar with: logo, nav links (Features, How it works, Resources, FAQ), theme toggle, and a prominent "Get started" CTA. Collapses to a hamburger on mobile.
**Priority:** P0 · **Effort:** M

### 2.2 — Add a Trust / Stats Bar
**Files:** `src/app/page.tsx`
**Current:** No social proof or quantitative trust signals.
**Proposed:** A stats strip below the hero: "2,000+ questions answered", "50+ official sources", "3-agent pipeline", "99.9% uptime" — with animated count-up on scroll into view.
**Priority:** P1 · **Effort:** S

### 2.3 — Add a "How It Works" 3-Step Section
**Files:** `src/app/page.tsx`
**Current:** Features are listed as static cards with no narrative flow.
**Proposed:** A visual 3-step journey: "1. Ask a question → 2. AI researches official sources → 3. Get a cited, verified answer" with icons, connecting lines, and scroll-reveal animation.
**Priority:** P1 · **Effort:** M

### 2.4 — Add a Live Chat Demo Mockup
**Files:** `src/app/page.tsx`
**Current:** Hero uses a static banner image.
**Proposed:** Replace/augment the hero image with an interactive, animated mockup of the chat interface — showing a sample Q&A with streaming text, source chips, and pipeline status. This instantly communicates the product's core value.
**Priority:** P1 · **Effort:** L

### 2.5 — Add a Testimonials / Social Proof Section
**Files:** `src/app/page.tsx`
**Current:** No user testimonials or community proof.
**Proposed:** A 3-card testimonial grid with student avatars, names, universities, and quotes about how Behörden-Bot helped them navigate the visa process.
**Priority:** P2 · **Effort:** M

### 2.6 — Add an FAQ Accordion Section
**Files:** `src/app/page.tsx`
**Current:** No FAQ on the landing page.
**Proposed:** A 6–8 question accordion (e.g., "Is this free?", "What sources do you use?", "Is my data private?") with smooth expand/collapse animation. Improves SEO and reduces support load.
**Priority:** P1 · **Effort:** M

### 2.7 — Add a Final CTA Section
**Files:** `src/app/page.tsx`
**Current:** Page ends abruptly after content sections with a thin footer.
**Proposed:** A bold, full-width CTA band: "Ready to start your German journey?" with a large "Start asking →" button and a secondary "Browse the knowledge base" link.
**Priority:** P1 · **Effort:** S

### 2.8 — Improve Hero Typography & Hierarchy
**Files:** `src/app/page.tsx`
**Current:** "Your AI Guide to German Immigration" is `text-4xl sm:text-5xl` — decent but lacks visual punch.
**Proposed:** Use a larger display size (`text-5xl sm:text-6xl`), tighter leading, a gradient accent on a keyword (e.g., "German Immigration"), and a subtle text-shadow/glow in dark mode.
**Priority:** P1 · **Effort:** S

### 2.9 — Add Scroll-Reveal Animations
**Files:** `src/app/page.tsx`
**Current:** No scroll-triggered animations; content appears statically.
**Proposed:** Use framer-motion `whileInView` to fade/slide sections in as the user scrolls. Respect `prefers-reduced-motion`.
**Priority:** P1 · **Effort:** M

### 2.10 — Add Feature Icons to Feature Cards
**Files:** `src/app/page.tsx`
**Current:** Feature cards are text-only (title + description).
**Proposed:** Add a distinct lucide icon per feature (e.g., `Bot`, `Database`, `ShieldCheck`, `Zap`, `Eye`, `Activity`) in a colored icon chip, making the grid scannable at a glance.
**Priority:** P1 · **Effort:** S

### 2.11 — Add a "Supported Topics" Tag Cloud
**Files:** `src/app/page.tsx`
**Current:** No quick way for users to see what topics the bot covers.
**Proposed:** A pill-tag cloud: "Student Visa", "APS Certificate", "Blocked Account", "Uni-Assist", "Health Insurance", "Enrollment", "Part-time Work", "PR Pathways" — each linking to a pre-filled chat query.
**Priority:** P2 · **Effort:** S

### 2.12 — Add a Footer with Real Links
**Files:** `src/app/page.tsx`
**Current:** Footer is a single centered line of text.
**Proposed:** A proper multi-column footer: brand + tagline, Product links (Chat, History, Sources), Resources (Guides, Universities, Finances, Timelines), Legal (Privacy, Terms), and social icons.
**Priority:** P1 · **Effort:** M

### 2.13 — Add a "Back to Top" Floating Button
**Files:** `src/app/page.tsx`
**Current:** Long landing page with no quick way back to the top.
**Proposed:** A floating circular button (bottom-right) that appears after scrolling past the hero, with smooth scroll-to-top.
**Priority:** P2 · **Effort:** S

---

## 3. Auth & Login Experience

### 3.1 — Add Gradient-Mesh Background to Login
**Files:** `src/app/login/page.tsx`
**Current:** Plain `bg-background` — visually disconnected from the landing page's animated mesh.
**Proposed:** Reuse the `gradient-mesh` class behind the login card for brand continuity.
**Priority:** P1 · **Effort:** S

### 3.2 — Add a Split-Screen Layout
**Files:** `src/app/login/page.tsx`
**Current:** Centered card only, no value proposition visible.
**Proposed:** A two-column layout on desktop: left = brand story (logo, headline, key benefits, mini chat mockup), right = login card. Mobile stacks vertically.
**Priority:** P1 · **Effort:** M

### 3.3 — Add Loading States to OAuth Buttons
**Files:** `src/app/login/page.tsx`
**Current:** Buttons have no loading state; clicking gives no feedback until redirect.
**Proposed:** Add a spinner + "Redirecting…" state on the clicked provider button, disable both buttons during auth.
**Priority:** P0 · **Effort:** S

### 3.4 — Add Auth Error / Rate-Limit Feedback
**Files:** `src/app/login/page.tsx`, `src/app/api/auth/[...nextauth]/route.ts`
**Current:** Failed auth or rate-limiting results in a silent redirect or generic error.
**Proposed:** Surface a branded error banner (e.g., "Too many sign-in attempts. Please try again in 5 minutes.") with a retry countdown.
**Priority:** P1 · **Effort:** M

### 3.5 — Add a "Why sign in?" Helper Text
**Files:** `src/app/login/page.tsx`
**Current:** One line: "Signing in grants access to your personal conversation history."
**Proposed:** A small feature list with icons: "Save conversations", "Sync across devices", "Export to Markdown", "Personalized answers".
**Priority:** P2 · **Effort:** S

### 3.6 — Add a "Back to Home" Link
**Files:** `src/app/login/page.tsx`
**Current:** No way to return to the landing page from login.
**Proposed:** A subtle "← Back to home" link in the top-left corner.
**Priority:** P2 · **Effort:** S

### 3.7 — Add a Privacy Note with Link
**Files:** `src/app/login/page.tsx`
**Current:** No privacy/terms links on the login page.
**Proposed:** "By continuing, you agree to our [Terms] and [Privacy Policy]." — builds trust for a product handling personal data.
**Priority:** P1 · **Effort:** S

### 3.8 — Add a "New here?" Section
**Files:** `src/app/login/page.tsx`
**Current:** No onboarding hint for first-time users.
**Proposed:** Below the OAuth buttons: "New to Behörden-Bot? [See how it works]" linking to a short onboarding modal or the landing "How it works" section.
**Priority:** P2 · **Effort:** S

### 3.9 — Add a Branded Logo to the Login Card
**Files:** `src/app/login/page.tsx`
**Current:** Text-only heading "Welcome to Behörden-Bot".
**Proposed:** Add the logo mark above the heading for instant brand recognition.
**Priority:** P1 · **Effort:** S

### 3.10 — Add a "Continue as Guest" Option
**Files:** `src/app/login/page.tsx`, `src/middleware.ts`
**Current:** Users must sign in to try the product — a high-friction barrier.
**Proposed:** A "Try it without an account" link that creates a temporary anonymous session (limited to N messages) with a prompt to sign in to save. Dramatically improves conversion.
**Priority:** P1 · **Effort:** L

---

## 4. Chat Interface & Message Bubbles

### 4.1 — Add Rich Suggested-Prompt Cards
**Files:** `src/components/chat/chat-interface.tsx`
**Current:** Plain text buttons for suggested prompts.
**Proposed:** Card-style suggestions with an icon, title, and short description (e.g., 📄 "Visa documents" → "What documents do I need for a German student visa?"). More scannable and inviting.
**Priority:** P0 · **Effort:** M

### 4.2 — Add Message Entrance Animations
**Files:** `src/components/chat/message-bubble.tsx`
**Current:** Messages appear instantly with no transition.
**Proposed:** Use framer-motion to fade/slide each message in (staggered by index), with a subtle scale on the user bubble. Respect reduced-motion.
**Priority:** P1 · **Effort:** S

### 4.3 — Add Message Action Buttons (Copy, Retry, Feedback)
**Files:** `src/components/chat/message-bubble.tsx`
**Current:** No way to copy, retry, or rate an answer.
**Proposed:** On hover (desktop) / always visible (mobile), show a small action bar: Copy, Regenerate, Thumbs up, Thumbs down. Copy uses `navigator.clipboard` with a toast confirmation.
**Priority:** P0 · **Effort:** M

### 4.4 — Add a "Scroll to Bottom" Floating Button
**Files:** `src/components/chat/chat-interface.tsx`
**Current:** Auto-scrolls on new messages; if the user scrolls up, they're yanked back down.
**Proposed:** Detect when the user is scrolled away from the bottom and show a floating "↓" button that smooth-scrolls to the latest message.
**Priority:** P1 · **Effort:** M

### 4.5 — Add a Typing / Thinking Indicator
**Files:** `src/components/chat/chat-interface.tsx`
**Current:** Before the first token arrives, the UI shows nothing (or "Thinking…" inside the bubble).
**Proposed:** A branded "Behörden-Bot is thinking…" indicator with three animated dots, shown while `status === "idle"` but `isStreaming` is true.
**Priority:** P1 · **Effort:** S

### 4.6 — Add Timestamp Separators
**Files:** `src/components/chat/chat-interface.tsx`
**Current:** No time context between messages.
**Proposed:** Insert subtle centered separators ("Today 2:34 PM", "Yesterday", "March 2") between messages when the gap exceeds 30 minutes.
**Priority:** P2 · **Effort:** M

### 4.7 — Add Source Chips with Favicons
**Files:** `src/components/chat/source-citation.tsx`
**Current:** Sources are a collapsible list with text links and a score percentage.
**Proposed:** Render sources as compact chips with a favicon (via `https://www.google.com/s2/favicons?domain=...`), domain name, and a small relevance bar. Clicking opens the URL in a new tab. More visual and scannable.
**Priority:** P1 · **Effort:** M

### 4.8 — Add "Served from cache" Visual Treatment
**Files:** `src/components/chat/message-bubble.tsx`
**Current:** A tiny gray text line: "Served from semantic cache."
**Proposed:** A subtle badge with a lightning icon and tooltip: "⚡ Answered from cache (0.4s)" — communicates speed as a feature.
**Priority:** P2 · **Effort:** S

### 4.9 — Add Suggested Follow-Up Questions
**Files:** `src/components/chat/chat-interface.tsx`
**Current:** After an answer, the user must type the next question manually.
**Proposed:** After each assistant message, show 2–3 contextual follow-up chips (e.g., after visa docs: "How long does the visa take?", "What's the fee?"). Clicking sends the query directly.
**Priority:** P1 · **Effort:** M

### 4.10 — Add a "Regenerate" Action on the Last Answer
**Files:** `src/components/chat/chat-interface.tsx`
**Current:** No way to get a different answer without re-typing the question.
**Proposed:** A "↻ Regenerate" button below the last assistant message that re-runs the pipeline with the same query.
**Priority:** P1 · **Effort:** M

### 4.11 — Add a "Copy Conversation" Action
**Files:** `src/components/chat/chat-interface.tsx`
**Current:** Export exists only in History.
**Proposed:** A header action (or message action) to copy the full conversation as Markdown to the clipboard.
**Priority:** P2 · **Effort:** S

### 4.12 — Add a "Clear Conversation" Action
**Files:** `src/components/chat/chat-interface.tsx`
**Current:** No way to clear the current conversation from within the chat view.
**Proposed:** A trash icon in the chat header with a confirmation dialog.
**Priority:** P2 · **Effort:** S

### 4.13 — Add a "New Chat" Button in the Chat Header
**Files:** `src/components/chat/chat-interface.tsx`
**Current:** New chat is only accessible from the sidebar.
**Proposed:** A "+" button in the chat header (visible on mobile where the sidebar is hidden).
**Priority:** P1 · **Effort:** S

### 4.14 — Add a "Model / Mode" Indicator in the Header
**Files:** `src/components/chat/chat-interface.tsx`
**Current:** Mode toggle is only in the input area.
**Proposed:** A small badge in the chat header showing the active mode ("⚡ Agentic" or "📖 Standard") with a tooltip explaining the difference.
**Priority:** P2 · **Effort:** S

### 4.15 — Add a "Disambiguation" Visual Treatment
**Files:** `src/components/chat/disambiguation-cards.tsx`
**Current:** Cards are plain text buttons with a small label above.
**Proposed:** Add a header row with an icon (e.g., `HelpCircle`), "I found a few interpretations — which did you mean?", and a subtle divider. Cards get a hover lift + arrow affordance.
**Priority:** P1 · **Effort:** S

### 4.16 — Add a "Pipeline Stage" Progress Bar
**Files:** `src/components/chat/pipeline-status.tsx`
**Current:** Dots + labels in a row; functional but visually flat.
**Proposed:** A horizontal progress bar with animated fill, stage labels below, and a percentage. Completed stages get a checkmark; the active stage pulses.
**Priority:** P1 · **Effort:** M

### 4.17 — Add a "Stop" Button with Progress Ring
**Files:** `src/components/chat/chat-input.tsx`
**Current:** A static square icon for stop.
**Proposed:** A circular progress ring around the stop button showing streaming progress (or elapsed time), making the stop action feel more responsive.
**Priority:** P2 · **Effort:** M

### 4.18 — Add an Empty-State Hero Illustration
**Files:** `src/components/chat/chat-interface.tsx`
**Current:** Empty state is plain text + prompt buttons.
**Proposed:** A branded illustration (or animated SVG) of a document/chat motif, a larger headline, and a short "What can I help you with?" subtext. Makes the first impression memorable.
**Priority:** P1 · **Effort:** M

---

## 5. Chat Input & Composition

### 5.1 — Add Auto-Resize with Smooth Animation
**Files:** `src/components/chat/chat-input.tsx`
**Current:** `rows={1}` with `max-h-40` — resizes instantly, no transition.
**Proposed:** Animate the textarea height with a CSS transition (or framer-motion `layout`) for a polished feel.
**Priority:** P1 · **Effort:** S

### 5.2 — Add a Character / Token Counter
**Files:** `src/components/chat/chat-input.tsx`
**Current:** No indication of query length limits.
**Proposed:** A subtle counter (e.g., "1,240 / 4,000 chars") in the bottom-right of the input, turning amber near the limit.
**Priority:** P2 · **Effort:** S

### 5.3 — Add a "Clear Input" Button
**Files:** `src/components/chat/chat-input.tsx`
**Current:** No way to quickly clear a long draft.
**Proposed:** A small "×" button inside the input (right side) that appears when text is present.
**Priority:** P2 · **Effort:** S

### 5.4 — Add a "Paste" / "Attach" Affordance
**Files:** `src/components/chat/chat-input.tsx`
**Current:** No attachment or paste support.
**Proposed:** A paperclip icon that accepts pasted text or small text files, inserting the content into the input. (Future: PDF upload for Q&A.)
**Priority:** P2 · **Effort:** M

### 5.5 — Add a "Mode" Toggle with Better Visual Design
**Files:** `src/components/chat/chat-input.tsx`
**Current:** Two small text buttons ("Standard" / "Agentic") with icons.
**Proposed:** A segmented control with a sliding pill indicator (framer-motion `layoutId`), clearer labels, and a tooltip explaining each mode's trade-off (speed vs depth).
**Priority:** P1 · **Effort:** M

### 5.6 — Add a "Send" Button Hover/Active State
**Files:** `src/components/chat/chat-input.tsx`
**Current:** Basic color change on hover.
**Proposed:** Add a subtle scale + shadow on hover, a press-down effect on active, and a brief "sent" animation (icon morphs to checkmark).
**Priority:** P2 · **Effort:** S

### 5.7 — Add a "Disclaimer" with Better Visual Treatment
**Files:** `src/components/chat/chat-input.tsx`
**Current:** Tiny 10px gray text at the bottom.
**Proposed:** A small info icon + tooltip: "⚠️ AI may make mistakes. Verify against official sources." — more discoverable without cluttering the UI.
**Priority:** P1 · **Effort:** S

### 5.8 — Add a "Suggested Prompt" Quick-Access Row
**Files:** `src/components/chat/chat-input.tsx`
**Current:** Suggested prompts only appear in the empty state.
**Proposed:** A horizontally scrollable row of quick-prompt chips above the input (visible when the conversation is short), letting users discover topics without typing.
**Priority:** P2 · **Effort:** M

### 5.9 — Add a "Focus" Ring on the Input
**Files:** `src/components/chat/chat-input.tsx`
**Current:** `focus:border-primary` only — subtle.
**Proposed:** A soft glow ring (`focus-visible:ring-4 ring-primary/20`) plus a slight background change, making the active input unmistakable.
**Priority:** P1 · **Effort:** S

### 5.10 — Add a "Draft Persistence" Feature
**Files:** `src/components/chat/chat-input.tsx`
**Current:** Typing a message and navigating away loses the draft.
**Proposed:** Persist the draft per conversation in `localStorage` and restore on return.
**Priority:** P2 · **Effort:** M

### 5.11 — Add a "Streaming" Visual State on the Input
**Files:** `src/components/chat/chat-input.tsx`
**Current:** The input stays enabled while streaming (user can type a new message).
**Proposed:** While streaming, show a subtle "Generating…" label above the input and disable the send button (keep stop active). Prevents accidental parallel sends.
**Priority:** P1 · **Effort:** S

### 5.12 — Add a "Max Length" Guard with Visual Feedback
**Files:** `src/components/chat/chat-input.tsx`
**Current:** No max-length enforcement.
**Proposed:** Enforce a 4,000-char limit; when exceeded, show a red counter and shake animation on the input.
**Priority:** P2 · **Effort:** S

---

## 6. Sidebar & Navigation

### 6.1 — Add a Collapsible Sidebar
**Files:** `src/components/chat/chat-layout.tsx`, `src/components/sidebar/app-sidebar.tsx`
**Current:** Sidebar is fixed at `w-72` on desktop; no collapse option.
**Proposed:** A toggle button that collapses the sidebar to a narrow icon rail (64px) with tooltips, freeing chat space. State persisted in localStorage.
**Priority:** P1 · **Effort:** M

### 6.2 — Add a "Search Conversations" Field in the Sidebar
**Files:** `src/components/sidebar/app-sidebar.tsx`
**Current:** No search in the sidebar; users must go to History.
**Proposed:** A compact search input at the top of the conversation list, filtering as you type.
**Priority:** P1 · **Effort:** M

### 6.3 — Add a "Today / Yesterday / Previous 7 Days" Grouping
**Files:** `src/components/sidebar/app-sidebar.tsx`
**Current:** Conversations are listed flat, newest first.
**Proposed:** Group by time buckets with subtle section headers, making long lists scannable.
**Priority:** P1 · **Effort:** M

### 6.4 — Add a "Pin Conversation" Feature
**Files:** `src/components/sidebar/app-sidebar.tsx`, `src/components/sidebar/conversation-item.tsx`
**Current:** No way to pin important conversations.
**Proposed:** A pin icon on hover; pinned conversations appear in a "Pinned" section at the top.
**Priority:** P2 · **Effort:** M

### 6.5 — Add a "Rename Conversation" Inline Action
**Files:** `src/components/sidebar/conversation-item.tsx`
**Current:** Titles are auto-generated; no way to rename.
**Proposed:** A pencil icon on hover that turns the title into an inline editable input (Enter to save, Esc to cancel).
**Priority:** P1 · **Effort:** M

### 6.6 — Add a "Delete" Confirmation Dialog
**Files:** `src/components/sidebar/conversation-item.tsx`
**Current:** Two-click delete (first click arms, second confirms) — clever but undiscoverable.
**Proposed:** A proper confirmation dialog ("Delete this conversation? This cannot be undone.") with Cancel/Delete buttons.
**Priority:** P1 · **Effort:** S

### 6.7 — Add a "New Chat" Button with Keyboard Shortcut
**Files:** `src/components/sidebar/app-sidebar.tsx`
**Current:** Button only.
**Proposed:** Add `⌘N` / `Ctrl+N` shortcut and show the hint in the button tooltip.
**Priority:** P2 · **Effort:** S

### 6.8 — Add a "User Profile" Section at the Bottom
**Files:** `src/components/sidebar/app-sidebar.tsx`
**Current:** No user identity shown in the sidebar.
**Proposed:** A compact user row (avatar, name, email) with a dropdown menu: Settings, Sign out, Theme.
**Priority:** P1 · **Effort:** M

### 6.9 — Add a "Knowledge Base" Badge / Status
**Files:** `src/components/sidebar/app-sidebar.tsx`
**Current:** Static nav item.
**Proposed:** A small dot or count badge showing the number of indexed documents (e.g., "Knowledge base · 42").
**Priority:** P2 · **Effort:** S

### 6.10 — Add a "Mobile Bottom Sheet" Navigation
**Files:** `src/components/chat/chat-layout.tsx`
**Current:** Mobile uses a full-screen overlay with a hamburger.
**Proposed:** A bottom-sheet drawer that slides up from the bottom (more native on mobile), with a drag handle and backdrop blur.
**Priority:** P1 · **Effort:** M

### 6.11 — Add a "Sidebar Loading Skeleton"
**Files:** `src/components/sidebar/app-sidebar.tsx`
**Current:** Shows "No conversations yet" while loading.
**Proposed:** Show 5–6 skeleton rows while the conversation list is fetching.
**Priority:** P1 · **Effort:** S

### 6.12 — Add a "Sidebar Empty State" with CTA
**Files:** `src/components/sidebar/app-sidebar.tsx`
**Current:** "No conversations yet." — dead end.
**Proposed:** A friendly empty state: "Start your first conversation" with a button that creates a new chat.
**Priority:** P1 · **Effort:** S

### 6.13 — Add a "Version / Build" Indicator
**Files:** `src/components/sidebar/app-sidebar.tsx`
**Current:** Shows "Behörden-Bot" text at the bottom.
**Proposed:** Show version (e.g., "v0.1.0") with a subtle tooltip linking to the changelog.
**Priority:** P2 · **Effort:** S

---

## 7. History & Conversation Management

### 7.1 — Add a "Date Range" Filter
**Files:** `src/components/history/history-list.tsx`
**Current:** Only text search.
**Proposed:** Filter chips: "All", "Today", "This week", "This month" — with counts.
**Priority:** P1 · **Effort:** M

### 7.2 — Add a "Mode" Filter
**Files:** `src/components/history/history-list.tsx`
**Current:** No way to filter by Standard vs Agentic.
**Proposed:** A dropdown or toggle to filter conversations by mode.
**Priority:** P2 · **Effort:** S

### 7.3 — Add a "Bulk Select" Mode
**Files:** `src/components/history/history-list.tsx`
**Current:** Delete/export is per-item only.
**Proposed:** A "Select" toggle that enables checkboxes, with "Delete selected" and "Export selected" actions.
**Priority:** P2 · **Effort:** M

### 7.4 — Add a "Delete All" Action with Confirmation
**Files:** `src/components/history/history-list.tsx`
**Current:** No bulk delete.
**Proposed:** A "Clear all" button in the header with a strong confirmation dialog.
**Priority:** P2 · **Effort:** S

### 7.5 — Add a "Preview" Modal on Click
**Files:** `src/components/history/history-list.tsx`
**Current:** Clicking navigates directly to the chat.
**Proposed:** A quick-preview modal (last 3 messages) with "Open conversation" and "Export" actions — lets users decide before navigating.
**Priority:** P2 · **Effort:** M

### 7.6 — Add a "Search-as-You-Type" (Debounced)
**Files:** `src/components/history/history-list.tsx`
**Current:** Search only triggers on Enter.
**Proposed:** Debounce the search input (300ms) and filter live as the user types.
**Priority:** P1 · **Effort:** S

### 7.7 — Add a "Result Count" Indicator
**Files:** `src/components/history/history-list.tsx`
**Current:** No indication of how many results match.
**Proposed:** "Showing 12 of 48 conversations" below the search bar.
**Priority:** P2 · **Effort:** S

### 7.8 — Add a "Sort" Control
**Files:** `src/components/history/history-list.tsx`
**Current:** Always newest first.
**Proposed:** Sort dropdown: "Newest", "Oldest", "Most messages", "Recently updated".
**Priority:** P2 · **Effort:** S

### 7.9 — Add a "Conversation Card" Redesign
**Files:** `src/components/history/history-list.tsx`
**Current:** Flat list rows with text.
**Proposed:** Card-style items with: title, preview, mode badge, message count, relative time, and hover-revealed actions. More visual and scannable.
**Priority:** P1 · **Effort:** M

### 7.10 — Add a "Export All" Button
**Files:** `src/components/history/history-list.tsx`
**Current:** Export is per-conversation.
**Proposed:** A "Export all" action that downloads a ZIP (or concatenated Markdown) of all conversations.
**Priority:** P2 · **Effort:** M

### 7.11 — Add a "Loading Skeleton" for History List
**Files:** `src/components/history/history-list.tsx`
**Current:** Shows nothing while loading.
**Proposed:** 5–6 skeleton rows with shimmer.
**Priority:** P1 · **Effort:** S

### 7.12 — Add a "Delete" Undo Toast
**Files:** `src/components/history/history-list.tsx`
**Current:** Delete is permanent with no undo.
**Proposed:** After delete, show a toast: "Conversation deleted · [Undo]" (5-second window).
**Priority:** P1 · **Effort:** M

### 7.13 — Add a "History" Page Header with Stats
**Files:** `src/app/history/page.tsx`
**Current:** Simple heading + subtitle.
**Proposed:** A header row with: title, total conversation count, total messages, and a "New chat" CTA.
**Priority:** P2 · **Effort:** S

---

## 8. Sources / Knowledge Base

### 8.1 — Add a "Document Type" Filter
**Files:** `src/components/sources/source-browser.tsx`
**Current:** Only text search.
**Proposed:** Filter chips: "All", "URLs", "PDFs", "Recently updated".
**Priority:** P1 · **Effort:** M

### 8.2 — Add a "Document Card" Grid View
**Files:** `src/components/sources/source-browser.tsx`
**Current:** Flat list rows.
**Proposed:** A card grid (2–3 columns) with: document icon, title, URL domain, chunk count, updated time, and a "View chunks" action. More visual and scannable.
**Priority:** P1 · **Effort:** M

### 8.3 — Add a "Chunk Preview" with Highlighted Search Terms
**Files:** `src/components/sources/source-browser.tsx`
**Current:** Chunks are plain text blocks.
**Proposed:** When searching, highlight matching terms in the chunk text (yellow background) for quick relevance scanning.
**Priority:** P1 · **Effort:** M

### 8.4 — Add a "Copy Chunk" Action
**Files:** `src/components/sources/source-browser.tsx`
**Current:** No way to copy a chunk's text.
**Proposed:** A copy icon on each chunk card with a toast confirmation.
**Priority:** P2 · **Effort:** S

### 8.5 — Add a "Chunk Navigation" (Prev/Next)
**Files:** `src/components/sources/source-browser.tsx`
**Current:** Infinite scroll with "Load more".
**Proposed:** Add prev/next chunk navigation buttons at the bottom for sequential reading.
**Priority:** P2 · **Effort:** S

### 8.6 — Add a "Document Stats" Header
**Files:** `src/components/sources/source-browser.tsx`
**Current:** Only shows chunk count.
**Proposed:** A stats bar: total documents, total chunks, last updated, average chunk size.
**Priority:** P2 · **Effort:** S

### 8.7 — Add a "Source Type" Badge
**Files:** `src/components/sources/source-browser.tsx`
**Current:** No visual distinction between URL and PDF sources.
**Proposed:** A small badge on each document: "🌐 URL" or "📄 PDF".
**Priority:** P1 · **Effort:** S

### 8.8 — Add a "Refresh" Button
**Files:** `src/components/sources/source-browser.tsx`
**Current:** No manual refresh; data may be stale.
**Proposed:** A refresh icon in the header that invalidates the query.
**Priority:** P2 · **Effort:** S

### 8.9 — Add a "Last Synced" Timestamp
**Files:** `src/components/sources/source-browser.tsx`
**Current:** No global sync indicator.
**Proposed:** "Last synced: 2 hours ago" in the header with a subtle pulse dot.
**Priority:** P2 · **Effort:** S

### 8.10 — Add a "Document Detail" Drawer
**Files:** `src/components/sources/source-browser.tsx`
**Current:** Chunks replace the list in a two-pane layout.
**Proposed:** A slide-in drawer (right side) for the selected document's chunks, keeping the list visible for quick switching.
**Priority:** P1 · **Effort:** M

### 8.11 — Add a "Chunk Relevance" Score Bar
**Files:** `src/components/sources/source-browser.tsx`
**Current:** No relevance indication for chunks.
**Proposed:** A small horizontal bar showing the chunk's retrieval score (if available), helping admins understand retrieval quality.
**Priority:** P2 · **Effort:** S

### 8.12 — Add a "Search Within Document" Feature
**Files:** `src/components/sources/source-browser.tsx`
**Current:** Search only filters the document list.
**Proposed:** A second search input within the selected document's chunk view.
**Priority:** P2 · **Effort:** M

### 8.13 — Add a "Document URL" Copy Action
**Files:** `src/components/sources/source-browser.tsx`
**Current:** URL is shown as text only.
**Proposed:** A copy-link icon next to the URL with a toast.
**Priority:** P2 · **Effort:** S

### 8.14 — Add a "Knowledge Base" Empty State with CTA
**Files:** `src/components/sources/source-browser.tsx`
**Current:** "Nothing indexed yet." — dead end.
**Proposed:** "The knowledge base is empty. [Add your first document]" linking to the admin documents page (for admins) or a "Contact admin" note (for users).
**Priority:** P1 · **Effort:** S

---

## 9. Admin Dashboard

### 9.1 — Add a "Date Range" Selector
**Files:** `src/app/admin/dashboard/page.tsx`
**Current:** Charts show fixed 14-day window.
**Proposed:** A segmented control: "7d", "14d", "30d", "90d" — with the chart data refetching on change.
**Priority:** P1 · **Effort:** M

### 9.2 — Add "Trend Indicators" to Metric Cards
**Files:** `src/components/admin/metric-card.tsx`
**Current:** Cards show absolute values only.
**Proposed:** Add a small trend arrow + percentage (e.g., "↑ 12% vs last week") with green/red coloring.
**Priority:** P1 · **Effort:** M

### 9.3 — Add "Sparklines" to Metric Cards
**Files:** `src/components/admin/metric-card.tsx`
**Current:** No mini-charts on cards.
**Proposed:** A tiny 30-point sparkline at the bottom of each card showing the metric's recent trend.
**Priority:** P2 · **Effort:** M

### 9.4 — Add a "Refresh" Button with Auto-Refresh
**Files:** `src/app/admin/dashboard/page.tsx`
**Current:** Data loads once; no refresh mechanism.
**Proposed:** A refresh icon + "Auto-refresh every 30s" toggle.
**Priority:** P1 · **Effort:** S

### 9.5 — Add a "Last Updated" Timestamp
**Files:** `src/app/admin/dashboard/page.tsx`
**Current:** No indication of data freshness.
**Proposed:** "Updated 2 minutes ago" in the header with a subtle pulse.
**Priority:** P2 · **Effort:** S

### 9.6 — Add "Chart Loading Skeletons"
**Files:** `src/components/admin/dashboard-charts.tsx`
**Current:** Charts render empty while loading.
**Proposed:** Skeleton placeholders matching each chart's dimensions.
**Priority:** P1 · **Effort:** S

### 9.7 — Add "Chart Empty States"
**Files:** `src/components/admin/dashboard-charts.tsx`
**Current:** Empty data renders blank charts.
**Proposed:** A friendly "No data yet" overlay with an icon.
**Priority:** P1 · **Effort:** S

### 9.8 — Add "Chart Tooltips" with More Detail
**Files:** `src/components/admin/dashboard-charts.tsx`
**Current:** Basic tooltips with count only.
**Proposed:** Rich tooltips: date, count, % change vs previous day, and a mini breakdown.
**Priority:** P2 · **Effort:** M

### 9.9 — Add a "Top Questions" List
**Files:** `src/app/admin/dashboard/page.tsx`
**Current:** No insight into what users are asking.
**Proposed:** A "Top 10 questions this week" card with bar visualization and counts.
**Priority:** P1 · **Effort:** M

### 9.10 — Add a "Failed Queries" Alert Card
**Files:** `src/app/admin/dashboard/page.tsx`
**Current:** No visibility into pipeline failures.
**Proposed:** A red-tinted card: "3 failed queries in the last 24h" with a link to inspect them.
**Priority:** P1 · **Effort:** M

### 9.11 — Add a "Cache Health" Gauge
**Files:** `src/components/admin/dashboard-charts.tsx`
**Current:** Donut chart only.
**Proposed:** A radial gauge with a color-coded threshold (green > 40%, amber 20–40%, red < 20%) and a "Clear cache" action.
**Priority:** P2 · **Effort:** M

### 9.12 — Add "Clickable Table Rows" with Drill-In
**Files:** `src/components/admin/recent-queries-table.tsx`
**Current:** Rows are static.
**Proposed:** Clicking a row opens a detail drawer with: full query, full response preview, latency breakdown, retrieval path, and source list.
**Priority:** P1 · **Effort:** M

### 9.13 — Add a "Pagination" or "Load More" for Recent Queries
**Files:** `src/components/admin/recent-queries-table.tsx`
**Current:** Shows a fixed set (likely 10–20).
**Proposed:** "Load more" button or pagination controls.
**Priority:** P2 · **Effort:** S

### 9.14 — Add a "Dashboard Overview" Header with Date
**Files:** `src/app/admin/dashboard/page.tsx`
**Current:** Static "Dashboard" heading.
**Proposed:** "Dashboard · March 8, 2026" with a greeting and quick stats summary.
**Priority:** P2 · **Effort:** S

---

## 10. Admin Documents & Pipeline Tester

### 10.1 — Add a "Document Status" Badge
**Files:** `src/components/admin/document-manager.tsx`
**Current:** No status indication (ingesting, synced, failed).
**Proposed:** Badges: "✅ Synced", "⏳ Ingesting", "⚠️ Failed" with color coding.
**Priority:** P1 · **Effort:** M

### 10.2 — Add a "Progress Bar" for Ingest
**Files:** `src/components/admin/document-manager.tsx`
**Current:** Ingest is a blocking action with no progress feedback.
**Proposed:** An animated progress bar during URL/PDF ingest (scrape → chunk → embed → store).
**Priority:** P1 · **Effort:** M

### 10.3 — Add a "Document Preview" Modal
**Files:** `src/components/admin/document-manager.tsx`
**Current:** Only title + URL shown.
**Proposed:** Clicking a document opens a preview modal with: title, URL, chunk count, parent count, created/updated times, and a "View chunks" link.
**Priority:** P2 · **Effort:** M

### 10.4 — Add a "Bulk Delete" Mode
**Files:** `src/components/admin/document-manager.tsx`
**Current:** Delete is per-document.
**Proposed:** Checkbox selection + "Delete selected" with confirmation.
**Priority:** P2 · **Effort:** M

### 10.5 — Add a "Search" Filter for Documents
**Files:** `src/components/admin/document-manager.tsx`
**Current:** No search in the document list.
**Proposed:** A search input above the list.
**Priority:** P1 · **Effort:** S

### 10.6 — Add a "Sort" Control for Documents
**Files:** `src/components/admin/document-manager.tsx`
**Current:** Default order only.
**Proposed:** Sort by: name, updated, chunk count.
**Priority:** P2 · **Effort:** S

### 10.7 — Add a "PDF Upload" Progress Bar
**Files:** `src/components/admin/document-manager.tsx`
**Current:** Shows "Uploading & embedding…" text only.
**Proposed:** A real progress bar (using `XMLHttpRequest` upload events) with percentage.
**Priority:** P1 · **Effort:** M

### 10.8 — Add a "Drag & Drop" Visual Feedback
**Files:** `src/components/admin/document-manager.tsx`
**Current:** Border color changes on drag.
**Proposed:** A full overlay with a large upload icon, "Drop to upload", and a subtle scale animation on the drop zone.
**Priority:** P1 · **Effort:** S

### 10.9 — Add a "Clear Cache" Confirmation Dialog
**Files:** `src/components/admin/document-manager.tsx`
**Current:** One-click clear with no confirmation.
**Proposed:** A dialog: "Clear the semantic cache? This will slow down repeat queries until it rebuilds."
**Priority:** P1 · **Effort:** S

### 10.10 — Add a "Sync All" Progress Indicator
**Files:** `src/components/admin/document-manager.tsx`
**Current:** Spinner on the button only.
**Proposed:** A progress bar showing "Syncing 3/12 documents…" with per-document status.
**Priority:** P1 · **Effort:** M

### 10.11 — Add a "Pipeline Tester" Result Timeline
**Files:** `src/components/admin/pipeline/pipeline-visualizer.tsx`
**Current:** Trace is shown as a static visualization.
**Proposed:** An animated, step-by-step timeline that reveals each stage sequentially (guardrail → retrieve → research → analyst → writer) with expandable details.
**Priority:** P1 · **Effort:** M

### 10.12 — Add a "Copy Trace" Action
**Files:** `src/app/admin/pipeline-tester/page.tsx`
**Current:** No way to share or save a trace.
**Proposed:** A "Copy JSON" button that copies the full trace to the clipboard.
**Priority:** P2 · **Effort:** S

### 10.13 — Add "Example Prompts" with Icons
**Files:** `src/app/admin/pipeline-tester/page.tsx`
**Current:** Plain text pill buttons.
**Proposed:** Cards with an icon + label, making examples more discoverable.
**Priority:** P2 · **Effort:** S

### 10.14 — Add a "Pipeline Tester" History
**Files:** `src/app/admin/pipeline-tester/page.tsx`
**Current:** Traces are ephemeral.
**Proposed:** A "Recent traces" list below the visualizer, letting admins revisit past runs.
**Priority:** P2 · **Effort:** M

---

## 11. Accessibility, Responsive & Motion

### 11.1 — Add ARIA Labels to All Icon-Only Buttons
**Files:** All components
**Current:** Some icon buttons have `aria-label`; many don't (e.g., theme toggle compact has one, but sidebar delete buttons, history action buttons, and source copy buttons may not).
**Proposed:** Audit every icon-only button and ensure a descriptive `aria-label` or `aria-labelledby`.
**Priority:** P0 · **Effort:** M

### 11.2 — Add `aria-live` Regions for Streaming Updates
**Files:** `src/components/chat/chat-interface.tsx`, `src/components/chat/pipeline-status.tsx`
**Current:** Pipeline status has `aria-live="polite"`; message streaming does not.
**Proposed:** Add `aria-live="polite"` to the message list container so screen readers announce new content.
**Priority:** P0 · **Effort:** S

### 11.3 — Add Keyboard Navigation for All Interactive Elements
**Files:** All components
**Current:** Most buttons are keyboard-accessible, but dropdowns, modals, and accordions (if added) need proper focus trapping and Esc-to-close.
**Proposed:** Implement focus trap for modals/drawers, Esc-to-close, and arrow-key navigation for dropdowns.
**Priority:** P0 · **Effort:** M

### 11.4 — Add `prefers-reduced-motion` Guards for All Animations
**Files:** `src/app/globals.css`, all framer-motion components
**Current:** CSS animations have reduced-motion guards; framer-motion components (disambiguation cards) do not.
**Proposed:** Use `useReducedMotion()` from framer-motion in all animated components.
**Priority:** P0 · **Effort:** M

### 11.5 — Add Touch-Target Sizes ≥ 44px on Mobile
**Files:** All components
**Current:** Many small buttons (e.g., `h-9 w-9`, `p-1.5`, `h-3.5 w-3.5` icons) are below the 44px recommended minimum.
**Proposed:** Increase touch targets on mobile via responsive classes or a global `min-h-[44px]` for interactive elements.
**Priority:** P0 · **Effort:** M

### 11.6 — Add Safe-Area Insets for iOS
**Files:** `src/app/globals.css`, `src/components/chat/chat-layout.tsx`
**Current:** No `env(safe-area-inset-*)` handling; content may be clipped by the iPhone notch/home indicator.
**Proposed:** Add `padding-bottom: env(safe-area-inset-bottom)` to the chat input and `padding-top: env(safe-area-inset-top)` to the mobile header.
**Priority:** P1 · **Effort:** S

### 11.7 — Add a "Skip to Content" Link
**Files:** `src/app/layout.tsx`
**Current:** No skip link for keyboard/screen-reader users.
**Proposed:** A visually-hidden "Skip to main content" link that becomes visible on focus.
**Priority:** P0 · **Effort:** S

### 11.8 — Add a "Mobile Responsive" Audit for All Pages
**Files:** All pages
**Current:** Chat and landing are responsive; admin pages and history may have cramped layouts on small screens.
**Proposed:** Audit every page at 320px, 375px, 768px, 1024px, and 1440px widths. Fix overflow, cramped grids, and unreadable text.
**Priority:** P0 · **Effort:** L

### 11.9 — Add a "Tablet" Breakpoint Optimization
**Files:** `src/app/admin/dashboard/page.tsx`, `src/components/sources/source-browser.tsx`
**Current:** Grids jump from 2-col to 4-col; some layouts are awkward at 768–1024px.
**Proposed:** Add `md` breakpoint refinements for admin charts, source browser, and history cards.
**Priority:** P1 · **Effort:** M

### 11.10 — Add a "Landscape Mobile" Optimization
**Files:** `src/components/chat/chat-layout.tsx`
**Current:** Chat layout may be cramped in landscape on phones.
**Proposed:** In landscape, collapse the sidebar to an icon rail and reduce chat padding.
**Priority:** P2 · **Effort:** M

### 11.11 — Add a "High Contrast" Mode
**Files:** `src/app/globals.css`
**Current:** Only light/dark themes.
**Proposed:** A "High contrast" theme variant with stronger borders, higher contrast text, and more distinct focus states.
**Priority:** P2 · **Effort:** M

### 11.12 — Add a "Font Size" Accessibility Setting
**Files:** `src/app/settings/page.tsx`
**Current:** No font-size control.
**Proposed:** A "Text size" setting (Small / Default / Large / Extra large) that adjusts the root font size.
**Priority:** P2 · **Effort:** M

### 11.13 — Add a "Screen Reader" Test Pass
**Files:** All components
**Current:** No screen-reader testing has been performed.
**Proposed:** Run a VoiceOver / NVDA pass on: chat flow, sidebar navigation, history actions, admin dashboard, and document manager. Fix any announced-content issues.
**Priority:** P1 · **Effort:** L

### 11.14 — Add a "Color Blind" Palette Check
**Files:** `src/app/globals.css`, `src/components/admin/dashboard-charts.tsx`
**Current:** Chart colors (`#6366f1`, `#0ea5e9`, `#16a34a`, `#d97706`, `#dc2626`) may be indistinguishable for deuteranopia/protanopia.
**Proposed:** Use a color-blind-safe palette for charts and add pattern/texture differentiation where possible.
**Priority:** P1 · **Effort:** M

### 11.15 — Add a "Motion" Settings Toggle
**Files:** `src/app/settings/page.tsx`
**Current:** Motion is only controlled by OS `prefers-reduced-motion`.
**Proposed:** A "Reduce motion" toggle in Settings that overrides the OS setting for users who want it app-specific.
**Priority:** P2 · **Effort:** S

---

## Prioritized Execution Roadmap

### Phase 1 — Quick Wins (P0, ~1–2 weeks)
Focus on correctness, accessibility, and trust:
- 1.4 Focus-visible treatment
- 1.5 Color-contrast audit
- 1.8 Error boundary
- 3.3 OAuth loading states
- 4.3 Message action buttons
- 11.1 ARIA labels
- 11.2 aria-live regions
- 11.5 Touch targets
- 11.7 Skip-to-content link
- 11.9 Mobile responsive audit

### Phase 2 — Core Experience (P1, ~3–4 weeks)
Elevate the primary user journeys:
- 1.1 Design tokens
- 1.2 Component library
- 1.3 Toast system
- 2.1 Sticky navbar
- 2.8 Hero typography
- 4.1 Rich suggestion cards
- 4.4 Scroll-to-bottom
- 4.9 Follow-up questions
- 5.5 Mode toggle redesign
- 6.1 Collapsible sidebar
- 6.5 Inline rename
- 7.9 History card redesign
- 8.2 Document card grid
- 9.1 Date-range selector
- 9.2 Trend indicators
- 10.2 Ingest progress bar

### Phase 3 — Premium Polish (P2, ~4–6 weeks)
Delight, differentiation, and future-proofing:
- 1.13 Command palette
- 2.4 Live chat demo mockup
- 2.5 Testimonials
- 2.6 FAQ accordion
- 3.10 Guest mode
- 4.7 Source chips with favicons
- 4.16 Pipeline progress bar
- 6.4 Pin conversations
- 7.3 Bulk select
- 9.9 Top questions
- 10.11 Pipeline timeline
- 11.12 High-contrast mode

---

## Design Principles

Throughout all 150 enhancements, the following principles guide every decision:

1. **Trust first** — This product handles sensitive personal data (visa, financial, identity). Every visual choice must reinforce credibility: clear sources, honest disclaimers, no dark patterns.
2. **Clarity over decoration** — Glassmorphism and animation serve comprehension, never distract from the answer.
3. **Speed is a feature** — Streaming, caching, and pipeline status should be *visible* and *celebrated*.
4. **Mobile-first** — The primary audience (Indian students) is heavily mobile. Every surface must feel native on a phone.
5. **Accessibility is non-negotiable** — WCAG 2.2 AA is the baseline, not the ceiling.
6. **Consistency scales** — A shared component library and token system prevent drift as the product grows.
7. **Delight in the details** — Micro-interactions (hover states, entrance animations, empty states) turn a tool into a product people recommend.

---

*This plan is a living document. As the product evolves, enhancements should be re-prioritized based on user feedback, analytics, and business goals.*