"use client";

import { Check, ExternalLink, Send } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

function MockSource({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-[14rem] items-center gap-1.5 truncate rounded-lg border border-glass-border bg-surface/60 px-2 py-1">
      <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
      <span className="truncate text-[10px] text-accent">{name}</span>
      <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted" aria-hidden="true" />
    </span>
  );
}

export function ChatMockup() {
  const reduceMotion = useReducedMotion();

  return (
    <div
      className="overflow-hidden rounded-2xl border border-glass-border bg-glass shadow-glass backdrop-blur"
      aria-hidden="true"
    >
      {" "}
      <div className="flex items-center justify-between border-b border-glass-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-glass-border px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted">
            Sample
          </span>
          <span className="text-xs text-muted">Behörden-Bot</span>
        </div>
      </div>
      <div className="flex flex-col gap-3 px-4 py-5">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex justify-end"
        >
          <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-xs text-white">
            What documents do I need for a German student visa?
          </div>
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="flex justify-start"
        >
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-glass-border bg-surface px-3.5 py-2.5 text-xs">
            <p className="leading-relaxed text-foreground">
              For a German national visa (D) you typically need a valid passport, proof of
              admission, proof of sufficient funds (blocked account ≈{" "}
              <span className="font-semibold">€11,904</span> for 2026), health insurance, and a
              completed application form.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <MockSource name="[Visa] Auswärtiges Amt – Visa Service (EN)" />
              <MockSource name="[Visa] Make it in Germany – Visa & Residence Overview (EN)" />
            </div>
            <div className="mt-2 flex items-center gap-1 text-[10px] text-muted">
              <Check className="h-3 w-3 text-success" />
              Grounded in 2 sources
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="flex justify-start"
        >
          <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-glass-border bg-surface px-3 py-2">
            <span className="text-[10px] text-muted">Behörden-Bot is thinking</span>
            <span className="flex gap-0.5">
              {[0, 1, 2].map((dot) => (
                <motion.span
                  key={dot}
                  className="h-1 w-1 rounded-full bg-primary"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 1, repeat: Infinity, delay: dot * 0.2 }}
                />
              ))}
            </span>
          </div>
        </motion.div>

        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5">
          <span className="flex-1 text-[10px] text-muted">Ask a follow-up…</span>
          <span className="grid h-6 w-6 place-items-center rounded-lg bg-primary text-white">
            <Send className="h-3 w-3" />
          </span>
        </div>
      </div>
    </div>
  );
}
