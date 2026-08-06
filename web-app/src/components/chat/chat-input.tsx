"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  ClipboardPaste,
  SendHorizontal,
  Sparkles,
  Square,
  X,
  Zap,
} from "lucide-react";
import type { ChatMode } from "@/lib/chat/types";
import { MAX_QUERY_LENGTH } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

/** Fraction of the cap at which the counter warns the user they're running out of room. */
const WARN_THRESHOLD = 0.9;

interface ChatInputProps {
  conversationId?: string;
  onSubmit: (query: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  mode?: ChatMode;
  onModeChange?: (mode: ChatMode) => void;
  suggestions?: string[];
  /** Called when the clipboard cannot be read, so the caller can surface a toast. */
  onPasteUnavailable?: () => void;
}

function draftKey(conversationId: string): string {
  return `behoerden-draft:${conversationId}`;
}

export function ChatInput({
  conversationId,
  onSubmit,
  onStop,
  isStreaming,
  disabled,
  mode = "agentic",
  onModeChange,
  suggestions = [],
  onPasteUnavailable,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const atLimit = value.length >= MAX_QUERY_LENGTH;
  const nearLimit = value.length >= MAX_QUERY_LENGTH * WARN_THRESHOLD;

  // Restore this conversation's draft, and clear any draft carried over from a
  // previously viewed conversation (ChatInterface is not remounted per id).
  useEffect(() => {
    if (!conversationId) {
      return;
    }
    setValue(window.localStorage.getItem(draftKey(conversationId)) ?? "");
  }, [conversationId]);

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
  }, [value]);

  const submit = () => {
    const trimmed = value.trim();
    // Guard on isStreaming too: useChat ignores sends mid-stream, so without
    // this the text would be cleared and silently lost.
    if (!trimmed || disabled || isStreaming) {
      return;
    }
    onSubmit(trimmed);
    setValue("");
  };

  const insertDraft = (suggestion: string) => {
    setValue(suggestion);
    textareaRef.current?.focus();
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        return;
      }
      const el = textareaRef.current;
      if (el) {
        const start = el.selectionStart ?? value.length;
        const end = el.selectionEnd ?? value.length;
        const next = (value.slice(0, start) + text + value.slice(end)).slice(0, MAX_QUERY_LENGTH);
        setValue(next);
        window.setTimeout(() => {
          el.focus();
          // Clamp against the truncated value, not the pre-slice length.
          const caret = Math.min(start + text.length, next.length);
          el.setSelectionRange(caret, caret);
        }, 0);
      } else {
        setValue((current) => (current + text).slice(0, MAX_QUERY_LENGTH));
      }
    } catch {
      // Firefox has no readText(), and permission can be denied. Tell the user
      // rather than leaving the button looking broken.
      onPasteUnavailable?.();
    }
  };

  const showQuickPrompts = suggestions.length > 0 && !isStreaming && value.trim() === "";

  return (
    // #57 — keep the textarea clear of the iOS home indicator on notched phones
    <div className="border-t border-border bg-background/80 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto max-w-3xl">
        {isStreaming && (
          <p className="mb-2 text-xs text-muted" role="status" aria-live="polite">
            Generating answer…
          </p>
        )}
        {onModeChange && (
          <div
            role="group"
            aria-label="Answer mode"
            // #55 — icons-only labels under 400px so the toggle never crowds the input row
            className="mb-2 inline-flex items-center gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-0.5"
          >
            <button
              type="button"
              onClick={() => onModeChange("standard")}
              aria-pressed={mode === "standard"}
              className={cn(
                "flex min-h-9 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition",
                mode === "standard"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted hover:text-foreground",
              )}
            >
              <BookOpen className="h-3 w-3" />
              <span className="hidden min-[400px]:inline">Standard</span>
            </button>
            <button
              type="button"
              onClick={() => onModeChange("agentic")}
              aria-pressed={mode === "agentic"}
              className={cn(
                "flex min-h-9 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition",
                mode === "agentic"
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted hover:text-foreground",
              )}
            >
              <Zap className="h-3 w-3" />
              <span className="hidden min-[400px]:inline">Agentic</span>
            </button>
          </div>
        )}
        <div
          className={cn(
            "flex items-end gap-2 rounded-xl border border-border bg-surface px-2 transition focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_var(--color-primary)/10]",
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
            maxLength={MAX_QUERY_LENGTH}
            placeholder="Ask about visas, APS, blocked accounts, university admissions…"
            disabled={disabled}
            aria-label="Ask a question"
            aria-describedby="chat-input-limit"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm outline-none transition-[height] duration-150 placeholder:text-muted disabled:opacity-60"
          />
          {/* #53 — shrink the four input controls below sm so they don't crowd the textarea */}
          {value && !isStreaming && (
            <button
              type="button"
              onClick={() => {
                setValue("");
                textareaRef.current?.focus();
              }}
              aria-label="Clear input"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground sm:h-10 sm:w-10"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {!isStreaming && (
            <button
              type="button"
              onClick={() => void pasteFromClipboard()}
              aria-label="Paste from clipboard"
              title="Paste from clipboard"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground sm:h-10 sm:w-10"
            >
              <ClipboardPaste className="h-4 w-4" />
            </button>
          )}
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              title="Stop generating"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-glass-border bg-surface text-muted transition hover:bg-surface-hover hover:text-foreground sm:h-10 sm:w-10"
            >
              <Square className="h-3.5 w-3.5 fill-muted-foreground text-muted-foreground" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={disabled || !value.trim()}
              aria-label="Send message"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition hover:text-foreground hover:shadow-sm hover:[&_svg]:stroke-[2.5] disabled:pointer-events-none disabled:opacity-40 sm:h-10 sm:w-10"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          )}
        </div>
        {/* #56 — quick-prompt chips scroll horizontally instead of wrapping into rows on phones */}
        {showQuickPrompts && (
          <div className="mt-2 flex flex-nowrap items-center gap-1.5 overflow-x-auto overscroll-x-contain pb-1 [-webkit-overflow-scrolling:touch]">
            <Sparkles className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => insertDraft(suggestion)}
                className="rounded-full border border-glass-border bg-glass px-2.5 py-1 text-[11px] text-muted backdrop-blur transition hover:border-primary hover:text-foreground"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
        {/* #54 — disclaimer + counter stack vertically below sm */}
        <div className="mt-1.5 flex flex-col items-start justify-between gap-1 sm:flex-row sm:items-center sm:gap-2">
          <p className="flex items-center gap-1 text-[10px] text-muted">
            <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span title="AI answers can be wrong. Always verify important details against official sources.">
              AI may make mistakes — verify against official sources.
            </span>
          </p>
          <p
            className={cn(
              "font-mono text-[10px] text-muted",
              nearLimit && "text-warning",
              atLimit && "text-destructive",
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
