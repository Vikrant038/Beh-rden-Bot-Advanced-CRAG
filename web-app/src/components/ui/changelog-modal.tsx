"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChangelogEntry } from "@/server/lib/changelog";

/**
 * 1.14 — Fallback snapshot used only while the fetch is in flight or when the
 * API route is unavailable (offline, deploy hiccup). The source of truth is
 * `CHANGELOG.md`, served by `/api/changelog`.
 */
const FALLBACK: ChangelogEntry[] = [
  {
    version: "v1.1.0",
    date: "Aug 2026",
    title: "UI/UX Enhancement Batch",
    items: [
      "Command palette (⌘K) for instant navigation",
      "Live chat demo mockup on the landing page",
      "Message entrance animations and timestamp separators",
      "Follow-up question chips, copy & clear conversation actions",
      "Suggested-prompt quick row and draft persistence in the composer",
    ],
  },
  {
    version: "v1.0.0",
    date: "Jul 2026",
    title: "Initial Release",
    items: [
      "3-Agent ReAct pipeline with hybrid retrieval and CRAG fallback",
      "Cited answers with source chips and relevance scores",
      "Google & GitHub sign-in with private conversation history",
      "Admin dashboard, document manager, and pipeline tester",
    ],
  },
];

export function ChangelogModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Start with the fallback so the dialog never flashes empty; swap in the
  // live CHANGELOG.md entries as soon as the fetch resolves.
  const [entries, setEntries] = useState<ChangelogEntry[]>(FALLBACK);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    fetch("/api/changelog")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("bad status"))))
      .then((data: { entries?: ChangelogEntry[] }) => {
        if (!cancelled && Array.isArray(data.entries) && data.entries.length > 0) {
          setEntries(data.entries);
        }
      })
      .catch(() => {
        // Keep the fallback snapshot.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">What&apos;s new</DialogTitle>
          <DialogDescription className="text-xs text-muted">
            Recent changes to Behörden-Bot
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5 max-h-[80dvh] space-y-6 overflow-y-auto overscroll-contain pr-1">
          {/* Keys include the index: the real CHANGELOG.md can contain several
              groups with the same version+title (e.g. three "Unreleased —
              Changed" groups), which would otherwise collide as React keys. */}
          {entries.map((entry, entryIndex) => (
            <section key={`${entry.version}-${entry.title}-${entryIndex}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {entry.version} — {entry.title}
                  {entry.date ? (
                    <span className="ml-2 text-xs text-muted">{entry.date}</span>
                  ) : null}
                </h3>
              </div>
              <ul className="mt-2 space-y-1.5">
                {entry.items.map((item, itemIndex) => (
                  <li
                    key={`${itemIndex}-${item}`}
                    className="flex items-start gap-2 text-sm text-muted"
                  >
                    <Check
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success"
                      aria-hidden="true"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
