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
  const [open, setOpen] = useState(status !== "pending");
  const meta = STATUS_META[status];
  const hasBody = Boolean(children);

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
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">
            <span className="mr-1.5 font-mono text-xs text-muted">{index}.</span>
            {title}
          </h3>
          {durationMs !== undefined && status !== "pending" && (
            <span className="font-mono text-xs text-muted">{durationMs}ms</span>
          )}
          {hasBody && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="ml-auto rounded-md p-1 text-muted transition hover:bg-surface-hover hover:text-foreground"
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
            </button>
          )}
          <span className={cn("ml-auto flex items-center gap-1 text-xs font-medium", meta.text)}>
            {meta.icon ?? null}
          </span>
        </div>
        {hasBody && open ? <div className="mt-2">{children}</div> : null}
      </div>
    </li>
  );
}
