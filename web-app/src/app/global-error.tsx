"use client";

import { TriangleAlert } from "lucide-react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Root error boundary. Next.js requires this file to render its own
 * <html>/<body> tags because the root layout may itself have failed.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  void error.digest;
  return (
    <html lang="en">
      <body className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
        <div className="w-full max-w-md rounded-2xl border border-glass-border bg-glass p-8 text-center shadow-glass backdrop-blur">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-destructive/10">
            <TriangleAlert className="h-7 w-7 text-destructive" />
          </div>
          <h1 className="mt-5 text-xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted">
            A critical error occurred. Please reload the page to continue.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover"
          >
            Reload page
          </button>
        </div>
      </body>
    </html>
  );
}
