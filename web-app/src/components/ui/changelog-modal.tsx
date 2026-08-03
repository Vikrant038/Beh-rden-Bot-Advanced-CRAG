"use client";

import { useEffect } from "react";
import { Check, X } from "lucide-react";

interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  items: string[];
}

const CHANGELOG: ChangelogEntry[] = [
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

export function ChangelogModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label="What's new"
    >
      <button
        type="button"
        aria-label="Close changelog"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div className="relative z-10 max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-glass-border bg-surface shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">What&apos;s new</h2>
            <p className="text-xs text-muted">Recent changes to Behörden-Bot</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-6 px-6 py-5">
          {CHANGELOG.map((entry) => (
            <section key={entry.version}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {entry.version} — {entry.title}
                </h3>
                <span className="text-xs text-muted">{entry.date}</span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {entry.items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-muted">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
