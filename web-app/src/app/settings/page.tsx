"use client";

import { signOut, useSession } from "next-auth/react";
import { LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export default function SettingsPage() {
  const { data: session } = useSession();
  const user = session?.user;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-1 text-sm font-semibold">Appearance</h2>
        <p className="mb-3 text-sm text-muted">Choose how Behoerden-Bot looks on this device.</p>
        <ThemeToggle />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold">Profile</h2>
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-primary text-lg font-semibold text-white">
            {user?.name?.charAt(0)?.toUpperCase() ?? user?.email?.charAt(0)?.toUpperCase() ?? "?"}
          </div>
          <div>
            <p className="font-medium">{user?.name ?? "User"}</p>
            <p className="text-sm text-muted">{user?.email}</p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-1 text-sm font-semibold">Account</h2>
        <p className="mb-3 text-sm text-muted">Sign out of Behoerden-Bot on this device.</p>
        <button
          type="button"
          onClick={() => void signOut({ callbackUrl: "/" })}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition hover:bg-surface-hover"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </section>
    </div>
  );
}
