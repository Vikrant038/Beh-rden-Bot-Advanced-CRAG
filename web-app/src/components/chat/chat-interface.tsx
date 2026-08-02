"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat, STREAMING_ID } from "@/hooks/use-chat";
import type { ChatMode } from "@/lib/chat/types";
import { MessageBubble } from "@/components/chat/message-bubble";
import { PipelineStatus } from "@/components/chat/pipeline-status";
import { ChatInput } from "@/components/chat/chat-input";
import { DisambiguationCards } from "@/components/chat/disambiguation-cards";

const SUGGESTED_PROMPTS = [
  "What documents do I need for a German student visa?",
  "How much do I need in a blocked account for 2026?",
  "What is the APS certificate and how long does it take?",
  "Compare blocked account vs scholarship funding options.",
];

export function ChatInterface({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const { messages, isStreaming, status, error, disambiguationOptions, sendMessage, stop } =
    useChat({ conversationId, onNotFound: () => router.replace("/chat") });

  const bottomRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ChatMode>("agentic");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  const isEmpty = messages.length === 0 && !isStreaming && disambiguationOptions.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
          {isEmpty && (
            <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
              <h2 className="text-xl font-semibold">How can I help you today?</h2>
              <p className="mt-2 max-w-md text-sm text-muted">
                Ask about German student visas, APS certification, blocked accounts, or university
                applications.
              </p>
              <div className="mt-6 flex w-full max-w-lg flex-col gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void sendMessage(prompt, mode)}
                    className="rounded-xl border border-border bg-surface px-4 py-2.5 text-left text-sm text-muted transition hover:border-primary hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              streaming={message.id === STREAMING_ID}
            />
          ))}

          {disambiguationOptions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted">Which of these did you mean?</p>
              <DisambiguationCards
                options={disambiguationOptions}
                onSelect={(option) => void sendMessage(option, mode)}
              />
            </div>
          )}

          {isStreaming && <PipelineStatus status={status} />}

          {error && !isStreaming && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>
      <ChatInput
        onSubmit={(query) => void sendMessage(query, mode)}
        onStop={stop}
        isStreaming={isStreaming}
        mode={mode}
        onModeChange={setMode}
      />
    </div>
  );
}
