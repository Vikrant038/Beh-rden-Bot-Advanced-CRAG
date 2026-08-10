"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, Copy, Menu, MoreHorizontal, Trash2, Zap } from "lucide-react";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { ModeProvider, useMode } from "@/components/chat/mode-context";
import { ChatActionsProvider, useChatActions } from "@/components/chat/chat-actions-context";
import { cn } from "@/lib/utils";

/**
 * Mobile top-bar overflow menu: Copy / Delete live here on phones (the desktop
 * header shows them inline). Rendered only while a conversation is open — the
 * new-chat page registers no actions, so the menu is absent there.
 */
function MobileActionsMenu() {
  const { actions } = useChatActions();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!actions) {
    return null;
  }

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Conversation actions"
        className="grid h-11 w-11 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Conversation actions"
          className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-glass-border bg-surface p-1 shadow-2xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              actions.onCopy();
              setOpen(false);
            }}
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground transition hover:bg-surface-hover"
          >
            <Copy className="h-4 w-4 text-muted" />
            Copy conversation
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              actions.onClear();
              setOpen(false);
            }}
            className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive transition hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4 text-muted" />
            Delete conversation
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Mobile top-bar answer-mode dropdown: shows which version (Standard/Agentic)
 * is active and lets the user switch without leaving the top of the screen.
 * Wired to the shared ModeProvider so the change applies to the chat below.
 */
function MobileModeDropdown() {
  const { mode, setMode } = useMode();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const ModeIcon = mode === "agentic" ? Zap : BookOpen;

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Answer mode"
        className="flex min-h-11 items-center gap-1.5 rounded-xl border border-glass-border bg-glass px-3 py-1.5 text-xs font-medium text-foreground shadow-glass backdrop-blur transition hover:bg-surface-hover"
      >
        <ModeIcon className="h-3.5 w-3.5 text-accent" />
        {mode === "agentic" ? "Agentic" : "Standard"}
        <ChevronDown
          className={cn("h-3.5 w-3.5 text-muted transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Answer mode options"
          className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-xl border border-glass-border bg-surface p-1 shadow-2xl"
        >
          {(
            [
              { value: "standard", label: "Standard", icon: BookOpen },
              { value: "agentic", label: "Agentic", icon: Zap },
            ] as const
          ).map((option) => {
            const active = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setMode(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-surface-hover",
                  active && "bg-primary/10 text-foreground",
                )}
              >
                <option.icon className="h-4 w-4 text-muted" />
                {option.label}
                {active && <span className="ml-auto text-accent">•</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ChatLayout({ children }: { children: React.ReactNode }) {
  // ── Sidebar collapse state (md+) ─────────────────────────────────────────
  // lg+ (1024px+): expanded by default (w-72), collapses via the header button.
  // md (768–1023px): starts collapsed to the icon rail (w-16).
  // < md: hidden, mobile slide-in panel instead.
  //
  // The collapsed rail is click-only (no hover-expand): tapping a control
  // (nav item, theme toggle, profile) acts directly; tapping empty rail space
  // expands the sidebar — so reaching for an icon never opens the whole rail.
  const [collapsed, setCollapsed] = useState(false);

  // md (768–1023px) starts collapsed to the icon rail so the content area keeps
  // room; lg+ starts expanded. Adjusted once on mount (post-hydration) so the
  // server render stays consistent.
  useEffect(() => {
    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    setCollapsed(!isDesktop);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const isExpanded = !collapsed;

  // ── Mobile slide-in panel state (< md) ────────────────────────────────────
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigatedAwayRef = useRef(false);
  const panelRef = useRef<HTMLElement>(null);

  const closeMobile = useCallback(() => {
    setMobileOpen(false);
  }, []);

  // Focus trap + Escape for the mobile panel
  useEffect(() => {
    if (!mobileOpen) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    // small delay so the panel has painted before we steal focus
    const t = setTimeout(() => panelRef.current?.focus(), 50);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMobile();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKeyDown);
      if (!navigatedAwayRef.current) prevFocus?.focus();
      navigatedAwayRef.current = false;
    };
  }, [mobileOpen, closeMobile]);

  // Close mobile panel on outside click
  useEffect(() => {
    if (!mobileOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) closeMobile();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [mobileOpen, closeMobile]);

  return (
    <ModeProvider>
      <ChatActionsProvider>
        <div className="flex h-dvh overflow-hidden">
          {/* ══════════════════════════════════════════════════════════════════
          SIDEBAR  —  md+ (768px and up)
          Full sidebar (272px) or icon rail (64px), always visible.
          Click-only: rail controls (nav item, theme, profile) act directly;
          tapping empty rail space expands; the header's collapse button closes.
      ══════════════════════════════════════════════════════════════════ */}
          <aside
            className={cn(
              "sidebar-glass hidden shrink-0 border-r border-border transition-[width] duration-200 md:block",
              isExpanded ? "w-72" : "w-16",
            )}
          >
            <AppSidebar collapsed={!isExpanded} onToggleCollapsed={toggleCollapsed} />
          </aside>

          {/* ══════════════════════════════════════════════════════════════════
          MOBILE SLIDE-IN PANEL  —  < md only
          Hidden off-screen. Hamburger button in the top bar opens it.
          Slides in from the left, backdrop dims the rest of the screen.
      ══════════════════════════════════════════════════════════════════ */}
          {mobileOpen && (
            <div className="fixed inset-0 z-50 md:hidden">
              {/* Backdrop */}
              <div
                className="drawer-backdrop absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={closeMobile}
                aria-hidden="true"
              />

              {/* Panel */}
              <aside
                ref={panelRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label="Navigation"
                className="sidebar-glass drawer-panel absolute inset-y-0 left-0 w-[85vw] max-w-xs overflow-y-auto overscroll-contain shadow-2xl focus:outline-none"
              >
                {/* No close button — the panel closes via Escape, the backdrop
                click, or navigating. The drawer starts directly with the
                brand + search (AppSidebar below). */}
                <div className="px-3 pb-6 pt-2">
                  <AppSidebar
                    onNavigate={() => {
                      navigatedAwayRef.current = true;
                      closeMobile();
                    }}
                  />
                </div>
              </aside>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
          MAIN CONTENT AREA
      ══════════════════════════════════════════════════════════════════ */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Mobile top bar — only visible below md. #44 — 44px touch targets.
            Chat-first layout: menu + answer-mode on the left, conversation
            actions (copy/delete) tucked into an overflow menu on the right.
            No back button — the drawer covers navigation and the browser's own
            back gesture still works. */}
            {/* relative z-40: backdrop-blur creates a stacking context that would
              otherwise trap the dropdown menus below the chat content (which is
              painted after this header) — lifting the header keeps the menus on
              top. */}
            <header className="relative z-40 flex items-center gap-2 border-b border-border bg-background/80 px-3 py-2.5 backdrop-blur md:hidden">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
                aria-haspopup="dialog"
                aria-expanded={mobileOpen}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground"
              >
                <Menu className="h-5 w-5" />
              </button>
              <MobileModeDropdown />
              {/* No brand in the top bar on smaller screens — it lives in the
                sidebar (rail + drawer) instead. A spacer keeps the mode
                dropdown on the left and the actions menu at the far right. */}
              <span className="min-w-0 flex-1" aria-hidden="true" />
              <MobileActionsMenu />
            </header>

            <main id="main" className="safe-bottom min-h-0 flex-1 overflow-hidden">
              {children}
            </main>
          </div>
        </div>
      </ChatActionsProvider>
    </ModeProvider>
  );
}
