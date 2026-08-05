"use client";

import { useEffect } from "react";
import { House, RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Route-level error boundary. Renders a branded recovery screen instead of
 * a blank page when a server or client component throws. `reset()` re-renders
 * the failing segment; "Go home" navigates to the landing page.
 */
export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // The error has already been surfaced to the console by Next.js; nothing
    // sensitive is rendered to the user (digest only).
    void error.digest;
  }, [error]);

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-glass-border bg-glass p-8 text-center shadow-glass backdrop-blur">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-destructive/10">
          <TriangleAlert className="h-7 w-7 text-destructive" />
        </div>
        <h1 className="mt-5 text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          An unexpected error occurred while loading this page. Please try again — if the problem
          persists, contact support.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-muted">
            Error {error.digest}
          </p>
        ) : null}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover"
          >
            <RotateCcw className="h-4 w-4" />
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm transition hover:bg-surface-hover"
          >
            <House className="h-4 w-4" />
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
