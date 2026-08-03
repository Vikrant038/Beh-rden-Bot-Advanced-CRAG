"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Bookmark,
  GraduationCap,
  House,
  LogIn,
  ShieldCheck,
  Sparkles,
  Download,
} from "lucide-react";
import { OAuthButtons } from "@/components/auth/oauth-buttons";

const BENEFITS = [
  { icon: Bookmark, text: "Save conversations" },
  { icon: Sparkles, text: "Personalized answers" },
  { icon: Download, text: "Export to Markdown" },
];

const ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked:
    "Another account already uses this email. Sign in with the provider you used before.",
  AccessDenied: "Access was denied. You may not have permission to sign in.",
  Configuration: "There's a problem with the server configuration. Try again later.",
  EmailSignin: "The sign-in link failed to send. Check your email address and try again.",
  Verification: "The sign-in link has expired or was already used. Try again.",
  RateLimit: "Too many sign-in attempts. Please wait a minute and try again.",
  OAuthSignin: "The provider rejected the sign-in request. Try again.",
  OAuthCallback: "There was an error while processing the provider response. Try again.",
  Default: "Something went wrong during sign-in. Please try again.",
};

function friendlyError(error: string | null): string | null {
  if (!error) {
    return null;
  }
  return ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default ?? null;
}

export function LoginContent() {
  const searchParams = useSearchParams();
  const [guestOpen, setGuestOpen] = useState(false);
  const error = friendlyError(searchParams.get("error"));

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="gradient-mesh pointer-events-none absolute inset-0" />

      <Link
        href="/"
        className="absolute left-4 top-4 z-10 inline-flex items-center gap-1.5 rounded-lg border border-glass-border bg-glass px-3 py-2 text-xs font-medium shadow-glass backdrop-blur transition hover:bg-surface-hover"
      >
        <House className="h-3.5 w-3.5" />
        Back to home
      </Link>

      <div className="relative z-10 mx-auto grid min-h-screen w-full max-w-5xl items-center gap-10 px-6 py-16 lg:grid-cols-2">
        {/* Brand story column */}
        <div className="hidden lg:block">
          <div className="flex items-center gap-2">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
              <GraduationCap className="h-5 w-5" />
            </span>
            <span className="text-xl font-semibold">Behörden-Bot</span>
          </div>
          <h2 className="mt-6 text-3xl font-bold leading-tight">
            Your AI guide to studying in{" "}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Germany
            </span>
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted">
            Get grounded answers about student visas, APS certification, blocked accounts, and
            university applications — with official sources cited on every answer.
          </p>
          <div className="mt-8 flex flex-col gap-3">
            {BENEFITS.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <div key={benefit.text} className="flex items-center gap-3 text-sm text-muted">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  {benefit.text}
                </div>
              );
            })}
          </div>
        </div>

        {/* Login card column */}
        <div className="mx-auto w-full max-w-sm">
          <div className="rounded-2xl border border-glass-border bg-glass p-8 shadow-glass backdrop-blur">
            <div className="flex items-center gap-2 lg:hidden">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
                <GraduationCap className="h-5 w-5" />
              </span>
              <span className="font-semibold">Behörden-Bot</span>
            </div>

            <div className="hidden items-center gap-2 lg:flex">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
                <GraduationCap className="h-5 w-5" />
              </span>
              <span className="font-semibold">Sign in to continue</span>
            </div>

            <h1 className="mt-4 text-xl font-semibold">Welcome to Behörden-Bot</h1>
            <p className="mt-1 text-sm text-muted">
              Your AI guide to German immigration, student visas, APS certification, and university
              applications.
            </p>

            {error && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-xs leading-relaxed text-destructive">{error}</p>
              </div>
            )}

            <div className="mt-6">
              <OAuthButtons />
            </div>

            <div className="relative my-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[10px] uppercase tracking-wider text-muted">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <button
              type="button"
              onClick={() => setGuestOpen((open) => !open)}
              aria-expanded={guestOpen}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm text-muted transition hover:bg-surface-hover hover:text-foreground"
            >
              <LogIn className="h-4 w-4" />
              Continue as guest
            </button>

            {guestOpen && (
              <div className="mt-3 rounded-xl border border-border bg-surface/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
                Guest browsing isn't available yet — create a free account above to save your
                conversations and export answers.
              </div>
            )}

            <p className="mt-4 text-center text-xs text-muted">
              Signing in grants access to your personal conversation history.
            </p>

            <div className="mt-5 flex items-start gap-2 rounded-xl border border-border bg-surface/60 px-3 py-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <p className="text-[11px] leading-relaxed text-muted">
                By continuing, you agree to our{" "}
                <Link href="/" className="text-accent underline hover:text-foreground">
                  Terms
                </Link>{" "}
                and{" "}
                <Link href="/" className="text-accent underline hover:text-foreground">
                  Privacy Policy
                </Link>
                .
              </p>
            </div>
          </div>

          <div className="mt-5 text-center text-xs text-muted">
            New here?{" "}
            <Link
              href="/#how-it-works"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              See how it works
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
