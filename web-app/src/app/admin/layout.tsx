"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { ArrowLeft, BarChart3, FileStack, FlaskConical, ShieldAlert, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/admin/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/admin/documents", label: "Documents", icon: FileStack },
  { href: "/admin/pipeline-tester", label: "Pipeline tester", icon: FlaskConical },
  { href: "/admin/users", label: "Users", icon: Users },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") {
      router.replace("/chat");
    }
  }, [status, session, router]);

  if (status === "loading") {
    return (
      <div className="grid min-h-screen place-items-center">
        <p className="animate-pulse text-sm text-muted">Loading…</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null;
  }

  if (session?.user?.role !== "ADMIN") {
    return null;
  }

  return (
    <div id="main" className="relative mx-auto max-w-6xl px-4 py-8">
      <div className="gradient-mesh pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 opacity-60" />
      <div className="sticky top-2 z-30 mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border/50 bg-background/90 px-2 py-2 shadow-sm backdrop-blur sm:gap-3">
        <Link
          href="/chat"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted transition hover:bg-surface-hover hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to chats
        </Link>
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-warning" />
          <h1 className="text-lg font-semibold">Admin</h1>
        </div>
      </div>
      <nav className="mb-6 flex gap-2 overflow-x-auto border-b border-border pb-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <button
              key={item.href}
              type="button"
              onClick={() => router.push(item.href)}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm transition focus-visible:ring-2 focus-visible:ring-primary",
                active
                  ? "bg-primary/10 font-medium text-foreground"
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
