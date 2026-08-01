import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  lines?: number;
}

/** Accessible loading placeholder rendered as glass pulse blocks. */
export function Skeleton({ className, lines = 1 }: SkeletonProps) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className={cn("animate-pulse rounded-lg bg-surface-hover", className ?? "h-4 w-full")}
        />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
