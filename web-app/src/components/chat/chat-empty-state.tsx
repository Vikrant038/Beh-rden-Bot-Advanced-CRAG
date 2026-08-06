"use client";

import { BadgeCheck, FileText, Landmark, MessageCircle, Scale } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { ChatMode } from "@/lib/chat/types";

const SUGGESTED_PROMPTS = [
  {
    title: "Visa documents",
    description: "What do I need for a German student visa?",
    query: "What documents do I need for a German student visa?",
    icon: FileText,
  },
  {
    title: "Blocked account",
    description: "How much for 2026?",
    query: "How much do I need in a blocked account for 2026?",
    icon: Landmark,
  },
  {
    title: "APS certificate",
    description: "What is it and how long does it take?",
    query: "What is the APS certificate and how long does it take?",
    icon: BadgeCheck,
  },
  {
    title: "Funding options",
    description: "Blocked account vs scholarship",
    query: "Compare blocked account vs scholarship funding options.",
    icon: Scale,
  },
];

export const QUICK_PROMPTS = [
  "APS verification timeline",
  "Blocked account amount needed for the Germany visa for 2026",
  "Student visa appointment checklist",
];

function ChatEmptyIllustration() {
  const reduceMotion = useReducedMotion();
  return (
    <div
      className="relative mx-auto grid h-20 w-20 place-items-center rounded-3xl border border-glass-border bg-glass shadow-glass backdrop-blur sm:h-28 sm:w-28"
      aria-hidden="true"
    >
      <motion.div
        className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/15 text-primary sm:h-14 sm:w-14"
        animate={reduceMotion ? undefined : { y: [0, -4, 0] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      >
        <MessageCircle className="h-5 w-5 sm:h-7 sm:w-7" />
      </motion.div>
      <motion.div
        className="absolute -right-2 top-4 h-5 w-5 rounded-lg bg-accent/25"
        animate={reduceMotion ? undefined : { y: [0, 5, 0], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-2 left-4 h-4 w-4 rounded-lg bg-warning/25"
        animate={reduceMotion ? undefined : { y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

interface ChatEmptyStateProps {
  onSubmit: (query: string, mode: ChatMode) => void;
}

/**
 * The "How can I help you today?" landing used both on the standalone `/chat`
 * composer (no conversation exists yet — creates one on first send) and inside
 * an empty loaded conversation. `onSubmit` carries the chosen mode so the
 * caller controls whether the prompt goes through the agentic or standard
 * pipeline.
 */
export function ChatEmptyState({ onSubmit }: ChatEmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-10 text-center sm:py-14">
      <ChatEmptyIllustration />
      <h2 className="mt-4 text-lg font-semibold sm:mt-6 sm:text-xl">How can I help you today?</h2>
      <p className="mt-2 max-w-md px-2 text-sm text-muted">
        Ask about German student visas, APS certification, blocked accounts, or university
        applications.
      </p>
      <div className="mt-6 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTED_PROMPTS.map((prompt) => {
          const Icon = prompt.icon;
          return (
            <button
              key={prompt.title}
              type="button"
              onClick={() => onSubmit(prompt.query, "agentic")}
              className="group flex min-h-11 items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 text-left transition hover:border-primary hover:bg-surface-hover"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-medium">{prompt.title}</span>
                <span className="mt-0.5 block text-xs text-muted">{prompt.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
