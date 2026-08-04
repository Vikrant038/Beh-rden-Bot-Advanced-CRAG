"use client";

import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">What&apos;s new</DialogTitle>
          <DialogDescription className="text-xs text-muted">
            Recent changes to Behörden-Bot
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5 space-y-6">
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
