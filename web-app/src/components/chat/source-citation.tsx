"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { ChatSource } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

function faviconUrl(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=16`;
  } catch {
    return null;
  }
}

export function SourceCitation({ sources }: { sources: ChatSource[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 border-t border-glass-border pt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        Sources ({sources.length})
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {sources.map((source, index) => {
            const favicon = faviconUrl(source.url);
            const score = Math.round(source.score * 100);
            return (
              <li key={`${source.url}-${index}`}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-glass-border bg-surface/60 px-2.5 py-1.5 transition hover:border-primary hover:bg-surface"
                >
                  {favicon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={favicon}
                      alt=""
                      width={16}
                      height={16}
                      className="h-4 w-4 shrink-0 rounded-sm"
                    />
                  ) : (
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs text-accent">
                    {source.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span
                      className="h-1 w-8 overflow-hidden rounded-full bg-border"
                      aria-hidden="true"
                    >
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${score}%` }}
                      />
                    </span>
                    <span className="font-mono text-[10px] text-muted">{score}%</span>
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
