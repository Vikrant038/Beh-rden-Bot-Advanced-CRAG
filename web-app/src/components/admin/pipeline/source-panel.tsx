"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { Source } from "@/server/rag/types";
import { cn } from "@/lib/utils";

interface SourcePanelProps {
  source: Source;
  index: number;
}

export function SourcePanel({ source, index }: SourcePanelProps) {
  const [open, setOpen] = useState(false);
  const hasParent = Boolean(source.parentText);

  return (
    <div className="rounded-xl border border-glass-border bg-surface/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-accent/10 font-mono text-[10px] text-accent">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {source.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted">
          {(source.score * 100).toFixed(0)}%
        </span>
        {source.url && /^https?:\/\//i.test(source.url) ? (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            aria-label={`Open ${source.name}`}
            className="shrink-0 rounded p-0.5 text-muted transition hover:text-accent"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="space-y-2 border-t border-glass-border px-3 py-2">
          {source.childText ? (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-primary">
                Matched child snippet
              </p>
              <p className="rounded-lg bg-primary/5 p-2 text-xs text-foreground/80">
                {source.childText}
              </p>
            </div>
          ) : null}
          {hasParent ? (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-accent">
                Expanded parent context
              </p>
              <p className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-accent/5 p-2 text-xs text-foreground/80">
                {source.parentText}
              </p>
            </div>
          ) : null}
          {!source.childText && !hasParent ? (
            <p className="text-xs text-muted">No parent expansion available.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
