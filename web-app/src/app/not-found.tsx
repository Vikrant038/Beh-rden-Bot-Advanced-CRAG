import Link from "next/link";
import { MessagesSquare } from "lucide-react";

/**
 * Custom 404 page. Keeps the Behörden-Bot brand, explains the dead end, and
 * offers a path back to the product instead of Next.js's default page.
 */
export default function NotFoundPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="gradient-mesh pointer-events-none absolute inset-0" />
      <div className="relative z-10 grid min-h-screen place-items-center px-4">
        <div className="w-full max-w-md text-center">
          <p className="font-mono text-6xl font-bold text-primary">404</p>
          <h1 className="mt-4 text-2xl font-semibold">This page doesn&apos;t exist</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            The page you&apos;re looking for may have moved, or the link may be out of date.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/"
              className="rounded-xl border border-glass-border bg-glass px-4 py-2 text-sm font-medium shadow-glass backdrop-blur transition hover:bg-surface-hover"
            >
              Back to home
            </Link>
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover"
            >
              <MessagesSquare className="h-4 w-4" />
              Go to Chat
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
