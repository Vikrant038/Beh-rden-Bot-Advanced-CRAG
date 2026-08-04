"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp, Zap } from "lucide-react";
import type { ChatMessage } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/chat/markdown";
import { SourceCitation } from "@/components/chat/source-citation";

type Feedback = "up" | "down" | null;

const COPIED_RESET_MS = 1600;

function MessageActions({
  content,
  currentFeedback,
  onRegenerate,
  onFeedback,
  onCopied,
  onCopyFailed,
}: {
  content: string;
  currentFeedback: Feedback;
  onRegenerate?: () => void;
  onFeedback?: (feedback: Feedback) => void;
  onCopied?: () => void;
  onCopyFailed?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const copy = async () => {
    if (!content) {
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      onCopied?.();
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      // Clipboard unavailable (non-secure context / denied permission). Tell the
      // user rather than leaving the button looking inert.
      onCopyFailed?.();
    }
  };

  const submitFeedback = (value: "up" | "down") => {
    onFeedback?.(currentFeedback === value ? null : value);
  };

  return (
    <div className="mt-2 flex items-center gap-1 opacity-100 transition focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy answer"
        className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {onFeedback && (
        <>
          <button
            type="button"
            onClick={() => submitFeedback("up")}
            aria-pressed={currentFeedback === "up"}
            aria-label="Mark answer as helpful"
            className={cn(
              "grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground",
              currentFeedback === "up" && "text-success",
            )}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => submitFeedback("down")}
            aria-pressed={currentFeedback === "down"}
            aria-label="Mark answer as not helpful"
            className={cn(
              "grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground",
              currentFeedback === "down" && "text-destructive",
            )}
          >
            <ThumbsDown className="h-3.5 w-3.5" />
          </button>
        </>
      )}
      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          aria-label="Regenerate answer"
          className="flex min-h-9 items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted transition hover:bg-surface-hover hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" />
          Regenerate
        </button>
      )}
    </div>
  );
}

export function MessageBubble({
  message,
  streaming,
  feedback = null,
  onRegenerate,
  onFeedback,
  onCopied,
  onCopyFailed,
}: {
  message: ChatMessage;
  streaming: boolean;
  feedback?: Feedback;
  onRegenerate?: () => void;
  onFeedback?: (feedback: Feedback) => void;
  onCopied?: () => void;
  onCopyFailed?: () => void;
}) {
  if (message.role === "USER") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-white">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.role === "SYSTEM" || message.role === "DISAMBIGUATION") {
    return (
      <div className="flex justify-center">
        <div className="max-w-[85%] rounded-xl border border-border bg-surface px-4 py-2 text-xs text-muted">
          {message.content}
        </div>
      </div>
    );
  }

  const hasSources = Boolean(message.sources && message.sources.length > 0);
  const showActions = !streaming && Boolean(message.content);
  const latencyMs = message.metadata?.latencyMs;
  const cachedLatencySeconds = latencyMs ? (latencyMs / 1000).toFixed(1) : null;

  return (
    <div className="group flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-glass-border bg-glass px-4 py-3 text-sm backdrop-blur">
        {streaming ? (
          <Markdown content={message.content} streaming />
        ) : message.content ? (
          <Markdown content={message.content} />
        ) : (
          <span className="text-muted">Thinking…</span>
        )}

        {showActions && (
          <MessageActions
            content={message.content}
            currentFeedback={feedback}
            onRegenerate={onRegenerate}
            onFeedback={onFeedback}
            onCopied={onCopied}
            onCopyFailed={onCopyFailed}
          />
        )}

        {hasSources && !streaming && <SourceCitation sources={message.sources ?? []} />}

        {message.metadata?.isCached && !streaming && (
          <span
            className="mt-2 inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent"
            title={
              cachedLatencySeconds
                ? `Answered from the semantic cache in ${cachedLatencySeconds}s — no pipeline run needed.`
                : "Answered from the semantic cache — no pipeline run needed."
            }
          >
            <Zap className="h-3 w-3" aria-hidden="true" />
            {cachedLatencySeconds
              ? `Answered from cache (${cachedLatencySeconds}s)`
              : "Answered from cache"}
          </span>
        )}
      </div>
    </div>
  );
}
