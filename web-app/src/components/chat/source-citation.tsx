"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { ChatSource } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

export function SourceCitation({ sources }: { sources: ChatSource[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 border-t border-glass-border pt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        Sources ({sources.length})
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {sources.map((source, index) => (
            <li
              key={`${source.url}-${index}`}
              className="flex items-start justify-between gap-2 text-xs"
            >
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-w-0 items-center gap-1.5 text-accent hover:underline"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="line-clamp-2">{source.name}</span>
              </a>
              <span className="shrink-0 font-mono text-muted">
                {(source.score * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
