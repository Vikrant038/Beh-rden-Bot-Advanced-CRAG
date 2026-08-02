"use client";

import { useState } from "react";
import { SendHorizontal, Square, Zap, BookOpen } from "lucide-react";
import type { ChatMode } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

export function ChatInput({
  onSubmit,
  onStop,
  isStreaming,
  disabled,
  mode = "agentic",
  onModeChange,
}: {
  onSubmit: (query: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  mode?: ChatMode;
  onModeChange?: (mode: ChatMode) => void;
}) {
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) {
      return;
    }
    onSubmit(trimmed);
    setValue("");
  };

  return (
    <div className="border-t border-border bg-background/80 p-4 backdrop-blur">
      <div className="mx-auto max-w-3xl">
        {onModeChange && !isStreaming && (
          <div className="mb-2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => onModeChange("standard")}
              aria-pressed={mode === "standard"}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition",
                mode === "standard"
                  ? "bg-primary/15 text-primary"
                  : "text-muted hover:text-foreground",
              )}
            >
              <BookOpen className="h-3 w-3" />
              Standard
            </button>
            <button
              type="button"
              onClick={() => onModeChange("agentic")}
              aria-pressed={mode === "agentic"}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition",
                mode === "agentic"
                  ? "bg-primary/15 text-primary"
                  : "text-muted hover:text-foreground",
              )}
            >
              <Zap className="h-3 w-3" />
              Agentic
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Ask about visas, APS, blocked accounts, university admissions…"
            disabled={disabled}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-primary disabled:opacity-60"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-surface text-destructive transition hover:bg-surface-hover"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={disabled || !value.trim()}
              aria-label="Send message"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary text-white transition hover:bg-primary-hover disabled:opacity-40"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-muted">
        Behoerden-Bot may make mistakes. Verify important information against official sources.
      </p>
    </div>
  );
}
