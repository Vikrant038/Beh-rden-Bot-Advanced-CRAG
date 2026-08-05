import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  lines?: number;
  variant?: "text" | "card" | "avatar" | "button";
}

const VARIANTS = {
  text: "h-4 w-full",
  card: "h-32 w-full rounded-2xl",
  avatar: "h-10 w-10 rounded-full",
  button: "h-10 w-24 rounded-xl",
};

export function Skeleton({ className, lines = 1, variant = "text" }: SkeletonProps) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "animate-pulse rounded-lg bg-surface-hover",
            variant === "text" ? (className ?? VARIANTS.text) : VARIANTS[variant],
            variant === "text" && lines > 1 && index === lines - 1 && "w-2/3",
          )}
        />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 rounded-xl border border-border p-3"
          aria-hidden="true"
        >
          <Skeleton variant="avatar" />
          <div className="flex-1">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="mt-2 h-3 w-2/3" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
