"use client";

import { useState } from "react";
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import type { ChatMessage } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { StreamingText } from "@/components/chat/streaming-text";
import { Markdown } from "@/components/chat/markdown";
import { SourceCitation } from "@/components/chat/source-citation";

type Feedback = "up" | "down" | null;

function MessageActions({
  content,
  onRegenerate,
  onFeedback,
}: {
  content: string;
  onRegenerate?: () => void;
  onFeedback?: (feedback: "up" | "down") => void;
}) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const copy = async () => {
    if (!content) {
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable (e.g. non-secure context) — fail silently
    }
  };

  const submitFeedback = (value: "up" | "down") => {
    const next: Feedback = feedback === value ? null : value;
    setFeedback(next);
    if (next) {
      onFeedback?.(next);
    }
  };

  return (
    <div className="mt-2 flex items-center gap-1 opacity-100 transition md:opacity-0 md:group-hover:opacity-100">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy answer"
        className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      {onFeedback && (
        <>
          <button
            type="button"
            onClick={() => submitFeedback("up")}
            aria-pressed={feedback === "up"}
            aria-label="Mark answer as helpful"
            className={cn(
              "grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground",
              feedback === "up" && "text-success",
            )}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => submitFeedback("down")}
            aria-pressed={feedback === "down"}
            aria-label="Mark answer as not helpful"
            className={cn(
              "grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground",
              feedback === "down" && "text-destructive",
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
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted transition hover:bg-surface-hover hover:text-foreground"
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
  onRegenerate,
  onFeedback,
}: {
  message: ChatMessage;
  streaming: boolean;
  onRegenerate?: () => void;
  onFeedback?: (feedback: "up" | "down") => void;
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

  return (
    <div className="group flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-glass-border bg-glass px-4 py-3 text-sm backdrop-blur">
        {streaming ? (
          <div className="whitespace-pre-wrap">
            <StreamingText text={message.content} streaming />
          </div>
        ) : message.content ? (
          <Markdown content={message.content} />
        ) : (
          <span className="text-muted">Thinking…</span>
        )}

        {showActions && (
          <MessageActions
            content={message.content}
            onRegenerate={onRegenerate}
            onFeedback={onFeedback}
          />
        )}

        {hasSources && !streaming && <SourceCitation sources={message.sources ?? []} />}

        {message.metadata?.isCached && !streaming && (
          <p className="mt-2 text-[10px] text-muted">Served from semantic cache.</p>
        )}
      </div>
    </div>
  );
}
