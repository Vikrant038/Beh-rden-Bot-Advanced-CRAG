import { Skeleton } from "@/components/ui/skeleton";

/**
 * Branded route-transition loading screen. Rendered by `loading.tsx` files
 * while a server component below the boundary is streaming its HTML.
 */
export function RouteLoader() {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-xl space-y-4">
        <div className="flex items-center justify-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          <span className="text-sm text-muted">Behörden-Bot is loading…</span>
        </div>
        <div className="rounded-2xl border border-glass-border bg-glass p-6 shadow-glass backdrop-blur">
          <Skeleton className="h-6 w-2/3" />
          <div className="mt-4 space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
