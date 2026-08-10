"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, SendHorizontal, Square } from "lucide-react";
import { MAX_QUERY_LENGTH } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  conversationId?: string;
  onSubmit: (query: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  /** Focus the composer immediately (first-paint caret). Desktop-only: auto-
      focusing on touch devices pops the on-screen keyboard on page load. */
  autoFocus?: boolean;
}

function draftKey(conversationId: string): string {
  return `behoerden-draft:${conversationId}`;
}

/**
 * Minimalist floating composer: just the text field and a send button.
 * The answer-mode toggle lives at the top of the screen (ModeToggle) and the
 * quick suggestions live in a separate panel above (ChatSuggestions) — the
 * input row itself stays sleek. The character cap is enforced silently; the
 * only feedback is an over-limit warning once the user actually exceeds it.
 */
export function ChatInput({
  conversationId,
  onSubmit,
  onStop,
  isStreaming,
  disabled,
  autoFocus = false,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [multiLine, setMultiLine] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overBy = value.length - MAX_QUERY_LENGTH;
  const overLimit = overBy > 0;

  // Restore this conversation's draft, and clear any draft carried over from a
  // previously viewed conversation (ChatInterface is not remounted per id).
  useEffect(() => {
    if (!conversationId) {
      return;
    }
    setValue(window.localStorage.getItem(draftKey(conversationId)) ?? "");
  }, [conversationId]);

  // First-paint composer: focus the caret as soon as the empty state shows.
  // Guarded to desktop (md+) so phones don't pop the keyboard on load.
  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    // matchMedia may be missing in jsdom (tests) — treat as non-desktop.
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function" ||
      !window.matchMedia("(min-width: 768px)").matches
    ) {
      return;
    }
    const t = window.setTimeout(() => textareaRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [autoFocus]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }
    window.localStorage.setItem(draftKey(conversationId), value);
  }, [conversationId, value]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 40), 160)}px`;
    // One logical line (scrollHeight ≤ 40px of padding+line) keeps the send
    // button vertically centered; wrapping input moves it to the bottom right.
    setMultiLine(el.scrollHeight > 44);
  }, [value]);

  const submit = () => {
    const trimmed = value.trim().slice(0, MAX_QUERY_LENGTH);
    // Guard on isStreaming too: useChat ignores sends mid-stream, so without
    // this the text would be cleared and silently lost.
    if (!trimmed || disabled || isStreaming || overLimit) {
      return;
    }
    onSubmit(trimmed);
    setValue("");
  };

  return (
    // #57 — keep the textarea clear of the iOS home indicator on notched phones
    <div className="px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="composer-glass chat-column rounded-2xl px-2 pb-2 pt-2 sm:px-3">
        {isStreaming && (
          <p className="mb-2 px-1 text-xs text-muted" role="status" aria-live="polite">
            Generating answer…
          </p>
        )}
        <div
          className={cn(
            // Single line: the send/stop control stays vertically centered.
            // Multi-line: it drops to the bottom right, padded from every edge
            // (p-2 keeps it off the border on all sides).
            "flex items-center gap-2 rounded-xl border border-glass-border bg-background/60 p-2 transition focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.12)]",
            multiLine && "items-end",
            overLimit && "border-destructive/60",
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            // Deliberately short so the placeholder never wraps on phones — the
            // input row stays a single sleek line.
            placeholder="Ask about visas, APS, blocked accounts…"
            disabled={disabled}
            aria-label="Ask a question"
            aria-describedby={overLimit ? "chat-input-limit" : undefined}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1.5 py-2.5 text-sm outline-none transition-[height] duration-150 placeholder:text-muted disabled:opacity-60"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              title="Stop generating"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-glass-border bg-surface text-muted transition hover:bg-surface-hover hover:text-foreground"
            >
              <Square className="h-3.5 w-3.5 fill-muted-foreground text-muted-foreground" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={disabled || !value.trim() || overLimit}
              aria-label="Send message"
              className={cn(
                "grid h-10 w-10 shrink-0 place-items-center rounded-lg transition",
                value.trim() && !disabled && !overLimit
                  ? "brand-gradient text-white shadow-[0_4px_14px_-4px_var(--color-primary)] hover:brightness-110"
                  : "text-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
              )}
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Over-limit feedback only — no live counter. Shown once the user
            actually exceeds the cap, naming exactly how much over they are. */}
        {overLimit && (
          <p
            id="chat-input-limit"
            role="alert"
            className="mt-1.5 flex items-center gap-1 px-1 text-[10px] font-medium text-destructive"
          >
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
            This is {overBy.toLocaleString()} characters over the{" "}
            {MAX_QUERY_LENGTH.toLocaleString()}-character limit.
          </p>
        )}

        <div className="mt-1.5 flex flex-col items-start justify-between gap-1 sm:flex-row sm:items-center sm:gap-2">
          <p className="flex items-center gap-1 text-[10px] text-muted">
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span title="AI answers can be wrong. Always verify important details against official sources.">
              AI may make mistakes — verify against official sources.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
