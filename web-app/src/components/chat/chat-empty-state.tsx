"use client";

import { ArrowUpRight, BadgeCheck, FileText, Landmark, MessageCircle, Scale } from "lucide-react";
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
      className="relative mx-auto grid h-24 w-24 place-items-center sm:h-32 sm:w-32"
      aria-hidden="true"
    >
      {/* Luminous gradient ring */}
      <div className="brand-gradient absolute inset-0 rounded-[2rem] opacity-60 blur-lg" />
      <div className="relative grid h-20 w-20 place-items-center rounded-3xl border border-glass-border bg-glass shadow-glass backdrop-blur sm:h-24 sm:w-24">
        <motion.div
          className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/15 text-primary sm:h-14 sm:w-14"
          animate={reduceMotion ? undefined : { y: [0, -4, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        >
          <MessageCircle className="h-5 w-5 sm:h-7 sm:w-7" />
        </motion.div>
        <motion.div
          className="absolute -right-2 top-4 h-5 w-5 rounded-lg bg-accent/30 shadow-[0_0_12px_var(--color-accent)]"
          animate={reduceMotion ? undefined : { y: [0, 5, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -bottom-2 left-4 h-4 w-4 rounded-lg bg-primary/30 shadow-[0_0_12px_var(--color-primary)]"
          animate={reduceMotion ? undefined : { y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
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
    // Ambient aurora behind the empty state — the Gemini-style "alive, not
    // empty" background. Dim orbs drift slowly; reduced-motion-safe via CSS.
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden py-10 text-center sm:py-14">
      <div className="aurora" aria-hidden="true">
        <div className="aurora-orb aurora-orb-a left-[-14%] top-[-22%] h-72 w-72 bg-primary/25 sm:h-80 sm:w-80" />
        <div className="aurora-orb aurora-orb-b right-[-12%] top-[8%] h-64 w-64 bg-accent/20 sm:h-72 sm:w-72" />
        <div className="aurora-orb aurora-orb-c bottom-[-30%] left-[28%] h-72 w-72 bg-primary/15" />
      </div>
      <div className="relative">
        <ChatEmptyIllustration />
      <h2 className="mt-5 text-xl font-semibold sm:mt-6 sm:text-2xl">How can I help you today?</h2>
      <p className="mt-2 max-w-md px-2 text-sm text-muted">
        Ask about German student visas, APS certification, blocked accounts, or university
        applications.
      </p>
      <div className="mt-7 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTED_PROMPTS.map((prompt) => {
          const Icon = prompt.icon;
          return (
            <button
              key={prompt.title}
              type="button"
              onClick={() => onSubmit(prompt.query, "agentic")}
              className="group flex min-h-11 items-start gap-3 rounded-xl border border-glass-border bg-glass px-4 py-3.5 text-left shadow-glass backdrop-blur transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-surface hover:shadow-[0_8px_24px_-8px_var(--color-primary)]"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary shadow-[0_0_14px_-4px_var(--color-primary)]">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{prompt.title}</span>
                <span className="mt-0.5 block text-xs text-muted">{prompt.description}</span>
              </span>
              <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}
