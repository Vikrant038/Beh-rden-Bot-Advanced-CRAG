"use client";

import { ArrowRight, HelpCircle } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

export function DisambiguationCards({
  options,
  onSelect,
}: {
  options: string[];
  onSelect: (option: string) => void;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="space-y-2" role="group" aria-label="Clarifying question">
      <div className="flex items-center gap-2 border-b border-glass-border pb-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/10 text-primary">
          <HelpCircle className="h-3.5 w-3.5" />
        </span>
        <p className="text-xs text-muted">
          I found a few interpretations — which did you mean?
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {options.map((option, index) => (
          <motion.button
            key={option}
            type="button"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08 }}
            whileHover={reduceMotion ? undefined : { y: -2, scale: 1.01 }}
            onClick={() => onSelect(option)}
            className="group flex items-center justify-between gap-3 rounded-xl border border-glass-border bg-glass px-4 py-3 text-left text-sm backdrop-blur transition-colors hover:border-primary hover:bg-surface"
          >
            <span className="flex-1 text-foreground">{option}</span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted transition-colors group-hover:text-primary" />
          </motion.button>
        ))}
      </div>
    </div>
  );
}
