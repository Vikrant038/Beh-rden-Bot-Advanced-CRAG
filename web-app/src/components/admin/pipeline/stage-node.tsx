"use client";

import { useState } from "react";
import { Check, ChevronDown, CircleAlert, CircleSlash, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type StageStatus = "done" | "warning" | "skipped" | "running" | "pending";

interface StageNodeProps {
  index: number;
  title: string;
  status: StageStatus;
  durationMs?: number;
  children?: React.ReactNode;
}

const STATUS_META: Record<StageStatus, { dot: string; text: string; icon?: React.ReactNode }> = {
  done: {
    dot: "bg-success",
    text: "text-success",
    icon: <Check className="h-3.5 w-3.5" />,
  },
  warning: {
    dot: "bg-warning",
    text: "text-warning",
    icon: <CircleAlert className="h-3.5 w-3.5" />,
  },
  skipped: {
    dot: "bg-border",
    text: "text-muted",
    icon: <CircleSlash className="h-3.5 w-3.5" />,
  },
  running: {
    dot: "bg-primary status-pulse",
    text: "text-primary",
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
  },
  pending: {
    dot: "bg-border",
    text: "text-muted",
  },
};

export function StageNode({ index, title, status, durationMs, children }: StageNodeProps) {
  // Closed by default: the admin pipeline trace reveals each stage's full
  // output and metric breakdown only on an explicit tap of the header row, so
  // the glass-box view stays scannable when every stage is expanded.
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[status];
  const hasBody = Boolean(children);
  const bodyId = `stage-node-${index}-body`;

  // The whole header row toggles (not just the chevron) — a much larger touch
  // target on phones. The title truncates with min-w-0; the duration, status
  // icon, and chevron are shrink-0 so they always sit pinned to the far right
  // beside one another, never wrapping or fighting for space on narrow rows.
  const row = (
    <>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        <span className="mr-1.5 font-mono text-xs text-muted">{index}.</span>
        {title}
      </span>
      {durationMs !== undefined && status !== "pending" && status !== "skipped" && (
        <span className="shrink-0 font-mono text-xs text-muted">{durationMs}ms</span>
      )}
      <span className={cn("flex shrink-0 items-center gap-1 text-xs font-medium", meta.text)}>
        {meta.icon ?? null}
      </span>
      {hasBody && (
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted transition-transform", open && "rotate-180")}
        />
      )}
    </>
  );

  return (
    <li className="relative flex gap-3">
      {/* Connector line */}
      {index > 0 ? (
        <span aria-hidden className="absolute -top-4 left-[9px] h-4 w-px bg-glass-border" />
      ) : null}

      <div className="relative z-10 mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-glass-border bg-surface">
        <span className={cn("h-2 w-2 rounded-full", meta.dot)} />
      </div>

      <div className="min-w-0 flex-1 pb-4">
        {hasBody ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg py-1 text-left transition hover:bg-surface-hover/60 focus-visible:ring-2 focus-visible:ring-primary md:min-h-9"
          >
            {row}
          </button>
        ) : (
          <div className="flex w-full min-w-0 items-center gap-2 py-1">{row}</div>
        )}
        {hasBody && open ? (
          <div id={bodyId} className="mt-2">
            {children}
          </div>
        ) : null}
      </div>
    </li>
  );
}
