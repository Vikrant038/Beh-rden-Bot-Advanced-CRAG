"use client";

import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "behoerden.sidebarCollapsed";

function readCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function ChatLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(readCollapsed());
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage failures (private mode / storage disabled).
      }
      return next;
    });
  };

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        className={cn(
          "hidden shrink-0 border-r border-border bg-surface/60 transition-[width] duration-200 md:block",
          collapsed ? "w-16" : "w-72",
        )}
      >
        <AppSidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-2xl">
            <AppSidebar onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
            className="grid h-9 w-9 place-items-center rounded-lg transition hover:bg-surface-hover"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold">Behörden-Bot</span>
        </header>
        <main id="main" className="safe-bottom min-h-0 flex-1 overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
