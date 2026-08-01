"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { BarChart3, FileStack, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/admin/dashboard", label: "Dashboard", icon: BarChart3 },
  { href: "/admin/documents", label: "Documents", icon: FileStack },
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
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center gap-2">
        <ShieldAlert className="h-5 w-5 text-warning" />
        <h1 className="text-lg font-semibold">Admin</h1>
      </div>
      <nav className="mb-6 flex gap-2 border-b border-border pb-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <button
              key={item.href}
              type="button"
              onClick={() => router.push(item.href)}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition",
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
