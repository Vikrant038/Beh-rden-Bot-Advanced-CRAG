"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Menu, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { cn } from "@/lib/utils";

export function ChatLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  // #35 — on a cold load (direct URL) there's no history to go back to; fall
  // back to /chat when the back button would otherwise leave the app.
  const goBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length <= 1) {
      router.push("/chat");
    } else {
      router.back();
    }
  }, [router]);

  // ── Sidebar collapse state (md+) ─────────────────────────────────────────
  // lg+ (1024px+): always expanded (w-72), no hover behavior.
  // md (768–1023px): collapsed to icon rail (w-16), expands on hover.
  // < md: hidden, mobile slide-in panel instead.
  const [collapsed, setCollapsed] = useState(false);
  const [hoverExpanded, setHoverExpanded] = useState(false);

  // md (768–1023px) starts collapsed to the icon rail so the content area keeps
  // room; lg+ starts expanded. Adjusted once on mount (post-hydration) so the
  // server render stays consistent.
  useEffect(() => {
    const isDesktop = window.matchMedia("(min-width: 1024px)").matches;
    setCollapsed(!isDesktop);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
    setHoverExpanded(false);
  }, []);

  // Hovering the collapsed rail expands it at any size (md and lg+); leaving
  // collapses it again. The collapse button remains the only way to close it.
  const handleSidebarHoverEnter = useCallback(() => {
    if (collapsed) {
      setHoverExpanded(true);
    }
  }, [collapsed]);

  const handleSidebarHoverLeave = useCallback(() => {
    setHoverExpanded(false);
  }, []);

  // The sidebar is expanded if: it's not collapsed, OR we're hovering on md
  const isExpanded = !collapsed || hoverExpanded;

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
    <div className="flex h-dvh overflow-hidden">
      {/* ══════════════════════════════════════════════════════════════════
          SIDEBAR  —  md+ (768px and up)
          Full sidebar (272px) or icon rail (64px), always visible.
          Collapse/expand is click-only: the rail's expand button and the
          expanded header's collapse button are the only controls.
      ══════════════════════════════════════════════════════════════════ */}
      <aside
        className={cn(
          "sidebar-glass hidden shrink-0 border-r border-border transition-[width] duration-200 md:block",
          isExpanded ? "w-72" : "w-16",
        )}
        onMouseEnter={handleSidebarHoverEnter}
        onMouseLeave={handleSidebarHoverLeave}
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
            {/* Panel header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold">Behörden-Bot</span>
              <button
                type="button"
                onClick={closeMobile}
                aria-label="Close navigation"
                className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

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
        {/* Mobile top bar — only visible below md */}
        <header className="flex items-center gap-3 border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={goBack}
            aria-label="Go back"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            aria-haspopup="dialog"
            aria-expanded={mobileOpen}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold text-foreground">Behörden-Bot</span>
        </header>

        <main id="main" className="safe-bottom min-h-0 flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
