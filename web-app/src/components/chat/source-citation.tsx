"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, Globe } from "lucide-react";
import type { ChatSource } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

/**
 * 4.7 — Source chips with favicons. Extracts the host from any URL shape the
 * pipeline can produce (`https://…`, `pdf://…`, plain hostnames).
 */
function sourceHost(url: string): string | null {
  try {
    if (url.startsWith("pdf://")) {
      // Local pdf:// pseudo-URLs have no host — skip the favicon lookup.
      // The displayed name (source.name) is the document title/filename.
      return null;
    }
    const parsed = new URL(url);
    return parsed.hostname || null;
  } catch {
    const match = url.match(/^([^/:]+)/);
    return match?.[1] || null;
  }
}

function Favicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] bg-surface-hover">
        <Globe className="h-2.5 w-2.5 text-muted" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 16px external favicon from Google s2; Next Image adds no benefit at this size and would need a remote-domain allowlist.
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-4 w-4 shrink-0 rounded-[4px]"
    />
  );
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
            const score = Math.round(source.score * 100);
            const host = sourceHost(source.url);
            const isPdf = source.url.startsWith("pdf://");
            const body = (
              <>
                {host ? <Favicon host={host} /> : null}
                {!isPdf && <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted" />}
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
              </>
            );
            const classes =
              "flex items-center gap-2 rounded-lg border border-glass-border bg-surface/60 px-2.5 py-1.5 transition hover:border-primary hover:bg-surface";
            return (
              <li key={`${source.url}-${index}`}>
                {isPdf ? (
                  // pdf:// is not a clickable URL — render as a plain chip.
                  <div className={classes} title={source.url}>
                    {body}
                  </div>
                ) : (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={classes}
                  >
                    {body}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
