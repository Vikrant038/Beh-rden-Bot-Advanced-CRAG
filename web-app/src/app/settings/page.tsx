"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { Contrast, LogIn, LogOut, MousePointer2, Type } from "lucide-react";
import { BackButton } from "@/components/ui/back-button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { RadioGroup } from "@/components/ui/radio-group";
import { FONT_SCALE_OPTIONS, usePreferences } from "@/components/preferences/preference-provider";
import type { LucideIcon } from "lucide-react";

/** Carded settings block: icon + heading, then description and controls. */
function SettingsSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="scroll-mt-20 rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const user = session?.user;
  const {
    fontScale,
    setFontScale,
    forceReducedMotion,
    setForceReducedMotion,
    highContrast,
    setHighContrast,
    mounted,
  } = usePreferences();

  return (
    <div id="main" className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <BackButton href="/chat" label="Back to chat" />
      <h1 className="scroll-mt-20 text-2xl font-semibold">Settings</h1>

      <section className="scroll-mt-20 rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-semibold">Appearance</h2>
        <p className="mb-3 text-sm text-muted">Choose how Behoerden-Bot looks on this device.</p>
        <ThemeToggle />
      </section>

      <SettingsSection icon={Type} title="Text size">
        Scales the entire interface for easier reading.
        <RadioGroup
          value={fontScale}
          onValueChange={setFontScale}
          label="Text size"
          className="flex-wrap"
          buttonClassName="min-h-11 px-3 py-1.5 text-sm"
          options={FONT_SCALE_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      </SettingsSection>

      <SettingsSection icon={MousePointer2} title="Motion">
        Reduce animations and transitions regardless of your operating system setting.
        <label className="mt-3 flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={mounted && forceReducedMotion}
            onChange={(event) => setForceReducedMotion(event.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <span className="text-sm">Reduce motion</span>
        </label>
      </SettingsSection>

      <SettingsSection icon={Contrast} title="Contrast">
        Increase foreground contrast for better readability.
        <label className="mt-3 flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={mounted && highContrast}
            onChange={(event) => setHighContrast(event.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <span className="text-sm">High contrast</span>
        </label>
      </SettingsSection>

      <section className="scroll-mt-20 rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-semibold">Profile</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-lg font-semibold text-white">
            {user?.name?.charAt(0)?.toUpperCase() ?? user?.email?.charAt(0)?.toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{user ? (user.name ?? "User") : "Guest"}</p>
            <p className="truncate text-sm text-muted">
              {user?.email ?? "Browsing without an account"}
            </p>
          </div>
          {!user && (
            <Link
              href="/login"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover"
            >
              <LogIn className="h-3.5 w-3.5" />
              Sign in
            </Link>
          )}
        </div>
      </section>

      <section className="scroll-mt-20 rounded-2xl border border-border bg-surface p-4 sm:p-5">
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
          <>
            <p className="text-sm text-muted">
              You&apos;re browsing as a guest — your conversations stay on this device. Sign in to
              keep them on your account automatically.
            </p>
            <Link
              href="/login"
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition hover:bg-surface-hover"
            >
              <LogIn className="h-4 w-4" />
              Sign in
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
