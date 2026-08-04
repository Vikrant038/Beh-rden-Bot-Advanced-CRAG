"use client";

import { signOut, useSession } from "next-auth/react";
import { Contrast, LogOut, MousePointer2, Type } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";
import {
  FONT_SCALE_OPTIONS,
  usePreferences,
} from "@/components/preferences/preference-provider";

export default function SettingsPage() {
  const { data: session } = useSession();
  const user = session?.user;
  const { fontScale, setFontScale, forceReducedMotion, setForceReducedMotion, highContrast, setHighContrast, mounted } =
    usePreferences();

  return (
    <div id="main" className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <BackButton href="/chat" label="Back to chat" />
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-1 text-sm font-semibold">Appearance</h2>
        <p className="mb-3 text-sm text-muted">Choose how Behoerden-Bot looks on this device.</p>
        <ThemeToggle />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-2">
          <Type className="h-4 w-4 text-muted" />
          <h2 className="text-sm font-semibold">Text size</h2>
        </div>
        <p className="mb-3 text-sm text-muted">
          Scales the entire interface for easier reading.
        </p>
        <div
          role="radiogroup"
          aria-label="Text size"
          className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border bg-surface p-1"
        >
          {FONT_SCALE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={mounted && fontScale === option.value}
              onClick={() => setFontScale(option.value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm transition focus-visible:ring-2 focus-visible:ring-primary",
                fontScale === option.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-2">
          <MousePointer2 className="h-4 w-4 text-muted" />
          <h2 className="text-sm font-semibold">Motion</h2>
        </div>
        <p className="mb-3 text-sm text-muted">
          Reduce animations and transitions regardless of your operating system setting.
        </p>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={mounted && forceReducedMotion}
            onChange={(event) => setForceReducedMotion(event.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <span className="text-sm">Reduce motion</span>
        </label>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-center gap-2">
          <Contrast className="h-4 w-4 text-muted" />
          <h2 className="text-sm font-semibold">Contrast</h2>
        </div>
        <p className="mb-3 text-sm text-muted">
          Increase foreground contrast for better readability.
        </p>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={mounted && highContrast}
            onChange={(event) => setHighContrast(event.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <span className="text-sm">High contrast</span>
        </label>
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
        {user ? (
          <>
            <p className="mb-3 text-sm text-muted">Sign out of Behoerden-Bot on this device.</p>
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: "/" })}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition hover:bg-surface-hover"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </>
        ) : (
          <p className="text-sm text-muted">
            You&apos;re browsing as a guest — your conversations stay on this device. Use the
            sidebar&apos;s “Leave guest mode” to end this session, or sign in above to keep your data.
          </p>
        )}
      </section>
    </div>
  );
}
