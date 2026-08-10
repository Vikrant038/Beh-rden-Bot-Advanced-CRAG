"use client";

import { MessageCircle } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

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

/**
 * The friendly "How can I help you today?" landing shown on the /chat composer
 * and inside an empty loaded conversation. Deliberately minimal: the suggested
 * questions live in the separate ChatSuggestions panel above the composer so
 * this view never competes with the input.
 */
export function ChatEmptyState() {
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
        <h2 className="mt-5 text-xl font-semibold sm:mt-6 sm:text-2xl">
          How can I help you today?
        </h2>
        <p className="mt-2 max-w-md px-2 text-sm text-muted">
          Ask about German student visas, APS certification, blocked accounts, or university
          applications.
        </p>
      </div>
    </div>
  );
}
