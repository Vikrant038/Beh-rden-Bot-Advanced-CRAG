import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";

interface ErrorStateProps {
  message: string;
  code?: string;
  retry?: () => void;
  className?: string;
}

/**
 * Typed error surface. Renders `code` (e.g. tRPC `data.code`) when present,
 * never a raw stack trace.
 */
export function ErrorState({ message, code, retry, className }: ErrorStateProps) {
  return (
    <GlassCard
      className={cn(
        "flex flex-col items-center gap-3 border-destructive/40 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="grid h-12 w-12 place-items-center rounded-full bg-destructive/10">
        <TriangleAlert className="h-6 w-6 text-destructive" />
      </div>
      <div>
        {code ? (
          <p className="font-mono text-xs uppercase tracking-wide text-muted">Error {code}</p>
        ) : null}
        <p className="mt-1 font-medium text-foreground">{message}</p>
      </div>
      {retry ? (
        <button
          type="button"
          onClick={retry}
          className="min-h-11 w-full rounded-lg border border-border bg-surface px-4 py-2 text-sm transition hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary sm:w-auto"
        >
          Try again
        </button>
      ) : null}
    </GlassCard>
  );
}
