"use client";

import { useEffect, useState } from "react";
import { Check, ExternalLink, SendHorizontal } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

const ANSWER =
  "For a German national visa (D) you typically need a valid passport, proof of admission, proof of sufficient funds (blocked account ≈ €11,904 for 2026), health insurance, and a completed application form.";

function MockSource({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-[14rem] items-center gap-1.5 truncate rounded-lg border border-glass-border bg-surface/70 px-2 py-1">
      <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
      <span className="truncate text-[10px] text-accent">{name}</span>
      <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted" aria-hidden="true" />
    </span>
  );
}

type Phase = "thinking" | "typing" | "done";

/**
 * Decorative live-type mockup for the landing hero. Renders a short thinking
 * pause, then types the answer with a streaming cursor and reveals the source
 * chips once complete. Purely presentational — `aria-hidden` — and fully
 * reduced-motion safe (skips straight to the finished answer).
 */
export function ChatMockup() {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(reduceMotion ? "done" : "thinking");
  const [typed, setTyped] = useState(reduceMotion ? ANSWER : "");

  // Thinking pause → start typing.
  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    const think = window.setTimeout(() => setPhase("typing"), 650);
    return () => window.clearTimeout(think);
  }, [reduceMotion]);

  // Typewriter loop.
  useEffect(() => {
    if (phase !== "typing") {
      return;
    }
    let index = 0;
    const id = window.setInterval(() => {
      index += 4;
      setTyped(ANSWER.slice(0, index));
      if (index >= ANSWER.length) {
        window.clearInterval(id);
        setPhase("done");
      }
    }, 18);
    return () => window.clearInterval(id);
  }, [phase]);

  const typing = phase === "typing";

  return (
    <div
      className="overflow-hidden rounded-2xl border border-glass-border bg-glass shadow-glass backdrop-blur"
      aria-hidden="true"
    >
      <div className="flex items-center justify-between border-b border-glass-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Behörden-Bot</span>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-4 py-5">
        {/* User message */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex justify-end"
        >
          <div className="brand-gradient max-w-[80%] rounded-2xl rounded-br-sm px-3.5 py-2 text-xs text-white shadow-lg">
            What documents do I need for a German student visa?
          </div>
        </motion.div>

        {/* Thinking state */}
        {phase === "thinking" && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex justify-start"
          >
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-glass-border bg-surface/70 px-3 py-2">
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
        )}

        {/* Typing / finished answer — borderless block, matching the real chat */}
        {(phase === "typing" || phase === "done") && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-start"
          >
            <div className="w-full text-xs">
              <p className="leading-relaxed text-foreground">
                {typed}
                {typing ? <span className="type-cursor" aria-hidden="true" /> : null}
              </p>
              {phase === "done" && (
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: reduceMotion ? 0 : 0.2 }}
                >
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <MockSource name="[Visa] Auswärtiges Amt – Visa Service (EN)" />
                    <MockSource name="[Visa] Make it in Germany – Visa & Residence Overview (EN)" />
                  </div>
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-muted">
                    <Check className="h-3 w-3 text-success" />
                    Grounded in 2 sources
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}

        {/* Composer */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduceMotion ? 0 : 0.9 }}
          className="flex items-center gap-2 rounded-xl border border-glass-border bg-surface/80 px-3 py-2.5"
        >
          <span className="flex-1 text-[10px] text-muted">Ask a follow-up…</span>
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-white">
            <SendHorizontal className="h-3.5 w-3.5" />
          </span>
        </motion.div>
      </div>
    </div>
  );
}
