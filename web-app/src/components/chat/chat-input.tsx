"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, BookOpen, SendHorizontal, Square, X, Zap } from "lucide-react";
import type { ChatMode } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

const MAX_QUERY_LENGTH = 4000;

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const atLimit = value.length >= MAX_QUERY_LENGTH;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 40), 160)}px`;
  }, [value]);

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
        {isStreaming && (
          <p className="mb-2 text-xs text-muted" role="status" aria-live="polite">
            Generating answer…
          </p>
        )}
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
        <div
          className={cn(
            "flex items-end gap-2 rounded-xl border border-border bg-surface px-2 transition focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15",
            atLimit && "border-warning",
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value.slice(0, MAX_QUERY_LENGTH))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Ask about visas, APS, blocked accounts, university admissions…"
            disabled={disabled}
            aria-describedby={atLimit ? "chat-input-limit" : undefined}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm outline-none transition placeholder:text-muted disabled:opacity-60"
          />
          {value && !isStreaming && (
            <button
              type="button"
              onClick={() => {
                setValue("");
                textareaRef.current?.focus();
              }}
              aria-label="Clear input"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border bg-surface text-destructive transition hover:bg-surface-hover"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={disabled || !value.trim() || atLimit}
              aria-label="Send message"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary text-white transition hover:bg-primary-hover active:scale-95 disabled:opacity-40"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1 text-[10px] text-muted">
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span title="AI answers can be wrong. Always verify important details against official sources.">
              AI may make mistakes — verify against official sources.
            </span>
          </p>
          <p
            className={cn(
              "font-mono text-[10px] text-muted",
              atLimit && "text-warning",
            )}
            id="chat-input-limit"
          >
            {value.length.toLocaleString()} / {MAX_QUERY_LENGTH.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
