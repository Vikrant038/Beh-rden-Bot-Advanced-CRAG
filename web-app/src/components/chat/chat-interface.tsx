"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  BadgeCheck,
  BookOpen,
  Copy,
  FileText,
  Landmark,
  MessageCircle,
  Plus,
  Scale,
  Trash2,
  Zap,
} from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useChat, STREAMING_ID } from "@/hooks/use-chat";
import type { ChatMode, PipelineStage } from "@/lib/chat/types";
import { MessageBubble } from "@/components/chat/message-bubble";
import { PipelineStatus } from "@/components/chat/pipeline-status";
import { ChatInput } from "@/components/chat/chat-input";
import { DisambiguationCards } from "@/components/chat/disambiguation-cards";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/lib/toast";
import { api } from "@/lib/trpc/client";

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

const QUICK_PROMPTS = [
  "APS verification timeline",
  "Blocked account amount for 2026",
  "Student visa appointment checklist",
];

const FOLLOW_UP_BANK: Array<{ keywords: string[]; prompts: string[] }> = [
  {
    keywords: ["visa", "appointment", "documents", "apply"],
    prompts: [
      "How long does a German student visa take to process?",
      "What is the visa appointment wait time in India?",
    ],
  },
  {
    keywords: ["blocked account", "fund", "euros", "money"],
    prompts: [
      "Which banks offer blocked accounts for students?",
      "Can my parents fund my blocked account?",
    ],
  },
  {
    keywords: ["aps", "certificate", "verification"],
    prompts: ["How long does APS verification take?", "Is APS required for every university?"],
  },
  {
    keywords: ["insurance", "health"],
    prompts: ["Which health insurance do I need for a student visa?", "How much does public health insurance cost?"],
  },
];

const DEFAULT_FOLLOW_UPS = [
  "What are the next steps after getting admission?",
  "How do I get health insurance for Germany?",
];

const PIPELINE_STAGES: PipelineStage[] = ["guardrail", "retrieving", "research", "analyst", "writer"];

function pipelineProgress(status: PipelineStage): number {
  if (status === "done") {
    return 100;
  }
  const index = PIPELINE_STAGES.indexOf(status);
  if (index < 0) {
    return 0;
  }
  return ((index + 1) / PIPELINE_STAGES.length) * 100;
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (diffDays === 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function followUpsFor(lastQuery: string): string[] {
  const haystack = lastQuery.toLowerCase();
  const match = FOLLOW_UP_BANK.find((group) =>
    group.keywords.some((keyword) => haystack.includes(keyword)),
  );
  return match?.prompts ?? DEFAULT_FOLLOW_UPS;
}

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
  const utils = api.useUtils();
  const { toast } = useToast();
  const createMutation = api.conversation.create.useMutation();
  const clearMutation = api.conversation.clear.useMutation();
  const { messages, isStreaming, status, error, disambiguationOptions, sendMessage, regenerate, stop, resetMessages } =
    useChat({ conversationId, onNotFound: () => router.replace("/chat") });

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<ChatMode>("agentic");
  const [showScrollButton, setShowScrollButton] = useState(false);
  const reduceMotion = useReducedMotion();

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
  const lastAssistant = lastAssistantIndex >= 0 ? messages[lastAssistantIndex] : undefined;
  const lastUserContent = [...messages].reverse().find((message) => message.role === "USER")?.content ?? "";
  const followUps = lastAssistant && !isStreaming ? followUpsFor(lastUserContent) : [];
  const progress = pipelineProgress(status);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  const newChat = () => {
    createMutation.mutate(
      {},
      {
        onSuccess: (conversation) => {
          router.push(`/chat/${conversation.id}`);
        },
        onError: () => {
          toast({ title: "Could not start a new chat", variant: "error" });
        },
      },
    );
  };

  const copyConversation = async () => {
    const transcript = messages
      .map((message) => {
        const speaker = message.role === "USER" ? "You" : "Behörden-Bot";
        return `${speaker}:\n${message.content}`;
      })
      .join("\n\n");
    if (!transcript) {
      return;
    }
    try {
      await navigator.clipboard.writeText(transcript);
      toast({ title: "Conversation copied to clipboard", variant: "success" });
    } catch {
      toast({ title: "Could not copy the conversation", variant: "error" });
    }
  };

  const clearConversation = () => {
    clearMutation.mutate(
      { id: conversationId },
      {
        onSuccess: () => {
          resetMessages();
          void utils.conversation.getById.invalidate({ id: conversationId });
          void utils.conversation.list.invalidate();
          toast({ title: "Conversation cleared", variant: "success" });
        },
        onError: () => {
          toast({ title: "Could not clear the conversation", variant: "error" });
        },
      },
    );
  };

  const bubbleAnimation = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  let lastDay = "";

  return (
    <div className="relative flex h-full flex-col">
      {/* ─── Chat header ─── */}
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-background/80 px-4 py-2.5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">
            {mode === "agentic" ? "Agentic mode" : "Standard mode"}
          </span>
          <Badge variant={mode === "agentic" ? "accent" : "default"} className="shrink-0">
            {mode === "agentic" ? <Zap className="h-3 w-3" /> : <BookOpen className="h-3 w-3" />}
            {mode === "agentic" ? "3-Agent ReAct" : "Single pass"}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void copyConversation()}
            aria-label="Copy conversation"
            title="Copy conversation"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={clearConversation}
            disabled={clearMutation.isPending}
            aria-label="Clear conversation"
            title="Clear conversation"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={newChat}
            disabled={createMutation.isPending}
            className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            New chat
          </button>
        </div>
      </header>

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
            const day = dayLabel(message.createdAt);
            const showSeparator = day !== lastDay;
            lastDay = day;
            const isLastAssistant = index === lastAssistantIndex;
            return (
              <div key={message.id}>
                {showSeparator && (
                  <div className="my-2 flex items-center gap-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-[10px] uppercase tracking-wider text-muted">{day}</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                )}
                <motion.div
                  {...bubbleAnimation}
                  transition={reduceMotion ? undefined : { duration: 0.25, ease: "easeOut" }}
                >
                  <MessageBubble
                    message={message}
                    streaming={message.id === STREAMING_ID}
                    onRegenerate={isLastAssistant ? () => void regenerate() : undefined}
                  />
                </motion.div>
              </div>
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

          {followUps.length > 0 && lastAssistant && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted">Follow up</span>
              {followUps.map((followUp) => (
                <button
                  key={followUp}
                  type="button"
                  onClick={() => void sendMessage(followUp, mode)}
                  className="rounded-full border border-glass-border bg-glass px-3 py-1.5 text-xs text-muted backdrop-blur transition hover:border-primary hover:text-foreground"
                >
                  {followUp}
                </button>
              ))}
            </div>
          )}

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
          className="absolute bottom-28 right-6 z-20 grid h-10 w-10 place-items-center rounded-full border border-glass-border bg-glass text-foreground shadow-glass backdrop-blur transition hover:bg-surface-hover"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}

      <ChatInput
        conversationId={conversationId}
        onSubmit={(query) => void sendMessage(query, mode)}
        onStop={stop}
        isStreaming={isStreaming}
        progress={progress}
        mode={mode}
        onModeChange={setMode}
        suggestions={QUICK_PROMPTS}
      />
    </div>
  );
}
