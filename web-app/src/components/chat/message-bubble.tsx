"use client";

import type { ChatMessage } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { StreamingText } from "@/components/chat/streaming-text";
import { Markdown } from "@/components/chat/markdown";
import { SourceCitation } from "@/components/chat/source-citation";

export function MessageBubble({
  message,
  streaming,
}: {
  message: ChatMessage;
  streaming: boolean;
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

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "max-w-[85%] rounded-2xl rounded-bl-sm border border-glass-border bg-glass px-4 py-3 text-sm backdrop-blur",
        )}
      >
        {streaming ? (
          <div className="whitespace-pre-wrap">
            <StreamingText text={message.content} streaming />
          </div>
        ) : message.content ? (
          <Markdown content={message.content} />
        ) : (
          <span className="text-muted">Thinking…</span>
        )}

        {hasSources && !streaming && <SourceCitation sources={message.sources ?? []} />}

        {message.metadata?.isCached && !streaming && (
          <p className="mt-2 text-[10px] text-muted">Served from semantic cache.</p>
        )}
      </div>
    </div>
  );
}
