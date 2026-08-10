"use client";

import { BookOpen, Zap } from "lucide-react";
import type { ChatMode } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

interface ModeToggleProps {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
  className?: string;
}

/**
 * Standard / Agentic answer-mode selector. Lives at the TOP of the chat
 * surface (header on conversations, top bar on the /chat composer) so the
 * composer below stays a plain input — the choice is made once, up front.
 */
export function ModeToggle({ mode, onChange, className }: ModeToggleProps) {
  const option = (value: ChatMode, label: string, Icon: typeof Zap) => {
    const active = mode === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => onChange(value)}
        aria-pressed={active}
        className={cn(
          "flex min-h-9 items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition",
          active
            ? "brand-gradient text-white shadow-[0_2px_10px_-2px_var(--color-primary)]"
            : "text-muted hover:text-foreground",
        )}
      >
        <Icon className="h-3 w-3" />
        {label}
      </button>
    );
  };

  return (
    <div
      role="group"
      aria-label="Answer mode"
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border border-glass-border bg-background/40 p-0.5",
        className,
      )}
    >
      {option("standard", "Standard", BookOpen)}
      {option("agentic", "Agentic", Zap)}
    </div>
  );
}
