"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, BadgeCheck, FileText, Landmark, MessageCircle, Scale } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useChat, STREAMING_ID } from "@/hooks/use-chat";
import type { ChatMode } from "@/lib/chat/types";
import { MessageBubble } from "@/components/chat/message-bubble";
import { PipelineStatus } from "@/components/chat/pipeline-status";
import { ChatInput } from "@/components/chat/chat-input";
import { DisambiguationCards } from "@/components/chat/disambiguation-cards";

const SUGGESTED_PROMPTS = [
  {
    title: "Visa documents",
    description: "What do I need for a German student visa?",
    query: "What documents do I need for a German student visa?",
    icon: FileText,
  },
  {
    title: "Blocked account",
    description: "How much for 2026?",
    query: "How much do I need in a blocked account for 2026?",
    icon: Landmark,
  },
  {
    title: "APS certificate",
    description: "What is it and how long does it take?",
    query: "What is the APS certificate and how long does it take?",
    icon: BadgeCheck,
  },
  {
    title: "Funding options",
    description: "Blocked account vs scholarship",
    query: "Compare blocked account vs scholarship funding options.",
    icon: Scale,
  },
];

function ThinkingIndicator() {
  return (
    <div className="flex justify-start" aria-live="polite">
      <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-glass-border bg-glass px-4 py-3 text-sm text-muted backdrop-blur">
        <MessageCircle className="h-4 w-4 text-primary" />
        <span>Behörden-Bot is thinking</span>
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((dot) => (
            <motion.span
              key={dot}
              className="h-1.5 w-1.5 rounded-full bg-primary"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: dot * 0.2 }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

function ChatEmptyIllustration() {
  const reduceMotion = useReducedMotion();
  return (
    <div
      className="relative mx-auto grid h-28 w-28 place-items-center rounded-3xl border border-glass-border bg-glass shadow-glass backdrop-blur"
      aria-hidden="true"
    >
      <motion.div
        className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary"
        animate={reduceMotion ? undefined : { y: [0, -4, 0] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      >
        <MessageCircle className="h-7 w-7" />
      </motion.div>
      <motion.div
        className="absolute -right-2 top-4 h-5 w-5 rounded-lg bg-accent/25"
        animate={reduceMotion ? undefined : { y: [0, 5, 0], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -bottom-2 left-4 h-4 w-4 rounded-lg bg-warning/25"
        animate={reduceMotion ? undefined : { y: [0, -4, 0], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

export function ChatInterface({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const { messages, isStreaming, status, error, disambiguationOptions, sendMessage, regenerate, stop } =
    useChat({ conversationId, onNotFound: () => router.replace("/chat") });

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ChatMode>("agentic");
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const onScroll = () => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollButton(distanceFromBottom > 120);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const isEmpty = messages.length === 0 && !isStreaming && disambiguationOptions.length === 0;
  const isThinking = isStreaming && status === "idle";
  const lastAssistantIndex = messages.findLastIndex(
    (message) => message.role === "ASSISTANT" && message.content && !message.metadata?.isCached,
  );

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  return (
    <div className="relative flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
          {isEmpty && (
            <div className="flex flex-1 flex-col items-center justify-center py-14 text-center">
              <ChatEmptyIllustration />
              <h2 className="mt-6 text-xl font-semibold">How can I help you today?</h2>
              <p className="mt-2 max-w-md text-sm text-muted">
                Ask about German student visas, APS certification, blocked accounts, or university
                applications.
              </p>
              <div className="mt-6 grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTED_PROMPTS.map((prompt) => {
                  const Icon = prompt.icon;
                  return (
                    <button
                      key={prompt.title}
                      type="button"
                      onClick={() => void sendMessage(prompt.query, mode)}
                      className="group flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition hover:border-primary hover:bg-surface-hover"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-medium">{prompt.title}</span>
                        <span className="mt-0.5 block text-xs text-muted">{prompt.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {messages.map((message, index) => {
            const isLastAssistant = index === lastAssistantIndex;
            return (
              <MessageBubble
                key={message.id}
                message={message}
                streaming={message.id === STREAMING_ID}
                onRegenerate={isLastAssistant ? () => void regenerate() : undefined}
              />
            );
          })}

          {disambiguationOptions.length > 0 && (
            <DisambiguationCards
              options={disambiguationOptions}
              onSelect={(option) => void sendMessage(option, mode)}
            />
          )}

          {isThinking && <ThinkingIndicator />}

          {isStreaming && !isThinking && <PipelineStatus status={status} />}

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

      {showScrollButton && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Scroll to latest message"
          className="absolute bottom-28 right-6 grid h-10 w-10 place-items-center rounded-full border border-glass-border bg-glass text-foreground shadow-glass backdrop-blur transition hover:bg-surface-hover"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}

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
