"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, Copy, MessageCircle, Plus, Trash2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useChat, STREAMING_ID } from "@/hooks/use-chat";
import type { ChatMode } from "@/lib/chat/types";
import { MessageBubble } from "@/components/chat/message-bubble";
import { PipelineStatus } from "@/components/chat/pipeline-status";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatEmptyState } from "@/components/chat/chat-empty-state";
import { ChatSuggestions } from "@/components/chat/chat-suggestions";
import { ModeToggle } from "@/components/chat/mode-toggle";
import { useMode } from "@/components/chat/mode-context";
import { useChatActions, type ChatActions } from "@/components/chat/chat-actions-context";
import { DisambiguationCards } from "@/components/chat/disambiguation-cards";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { GuestLimitDialog } from "@/components/chat/guest-limit-dialog";
import { useToast } from "@/lib/toast";
import { api } from "@/lib/trpc/client";

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
    prompts: [
      "Which health insurance do I need for a student visa?",
      "How much does public health insurance cost?",
    ],
  },
];

const DEFAULT_FOLLOW_UPS = [
  "What are the next steps after getting admission?",
  "How do I get health insurance for Germany?",
];

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
      <div className="flex items-center gap-2.5 rounded-2xl rounded-bl-sm border border-glass-border bg-glass px-4 py-3 text-sm text-muted shadow-[0_0_20px_-8px_var(--color-primary)] backdrop-blur">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-primary/10 text-primary">
          <MessageCircle className="h-3.5 w-3.5" />
        </span>
        <span>Behörden-Bot is thinking</span>
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((dot) => (
            <motion.span
              key={dot}
              className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_6px_var(--color-primary)]"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: dot * 0.2 }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

export function ChatInterface({
  conversationId,
  initialQuery,
  initialMode,
}: {
  conversationId: string;
  /** First message handed off from /chat via ?q= (auto-sent once, then dropped). */
  initialQuery?: string;
  /** Mode handed off from /chat via ?m= (falls back to the default). */
  initialMode?: ChatMode;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const { toast } = useToast();
  const clearMutation = api.conversation.clear.useMutation();
  const feedbackMutation = api.chat.feedback.useMutation();
  const [feedbackState, setFeedbackState] = useState<Record<string, "up" | "down" | null>>({});
  const {
    messages,
    isStreaming,
    isLoading,
    notFound,
    readOnly,
    status,
    error,
    notice,
    guestLimitReached,
    disambiguationOptions,
    sendMessage,
    regenerate,
    stop,
    resetMessages,
  } = useChat({ conversationId });

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Shared mode with the mobile top-bar dropdown (ModeProvider in ChatLayout).
  const { mode, setMode } = useMode();
  // Deep link / handoff (?m=) wins once on mount; the provider persists the
  // choice across navigation afterwards.
  const appliedInitialModeRef = useRef(false);
  useEffect(() => {
    if (initialMode && !appliedInitialModeRef.current) {
      appliedInitialModeRef.current = true;
      setMode(initialMode);
    }
  }, [initialMode, setMode]);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Hydrate saved feedback so thumbs stay colored after a reload / when
  // switching conversations. Seeded once per (conversation, message-set) and
  // never overwrites an in-session click (existing keys are skipped).
  const seededFeedbackKeyRef = useRef<string>("");
  useEffect(() => {
    if (messages.length === 0) {
      return;
    }
    const key = `${conversationId}:${messages[0]?.id ?? ""}:${messages[messages.length - 1]?.id ?? ""}`;
    if (seededFeedbackKeyRef.current === key) {
      return;
    }
    seededFeedbackKeyRef.current = key;
    setFeedbackState((prev) => {
      const seeded = { ...prev };
      for (const message of messages) {
        if (message.feedback && !(message.id in seeded)) {
          seeded[message.id] = message.feedback;
        }
      }
      return seeded;
    });
  }, [conversationId, messages]);

  // ── First-message handoff from the /chat composer ───────────────────────
  // /chat creates the conversation and redirects with ?q=<query>. Auto-send it
  // exactly once once the conversation has loaded, then strip the param so a
  // reload never re-sends (or re-creates) anything.
  const initialSentRef = useRef(false);
  useEffect(() => {
    if (initialSentRef.current || !initialQuery || notFound) {
      return;
    }
    initialSentRef.current = true;
    void sendMessage(initialQuery, mode);
    // Use window.history.replaceState to cleanly strip query params without triggering
    // Next.js App Router layout re-renders or screen flashes.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/chat/${conversationId}`);
    }
  }, [initialQuery, notFound, sendMessage, mode, conversationId]);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [guestLimitOpen, setGuestLimitOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  // The stream route rejects a guest prompt past the cap with a 403 + code; the
  // hook surfaces that as `guestLimitReached` and we surface the sign-in dialog.
  useEffect(() => {
    if (guestLimitReached) {
      setGuestLimitOpen(true);
    }
  }, [guestLimitReached]);

  // Only follow the stream while the user is already at the bottom, so scrolling
  // up to re-read an earlier answer doesn't yank them back down.
  useEffect(() => {
    if (showScrollButton) {
      return;
    }
    bottomRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, status, showScrollButton, reduceMotion]);

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

  // A missing/inaccessible conversation renders the not-found panel instead of
  // the empty state, so the two never appear together.
  const isEmpty =
    !notFound && messages.length === 0 && !isStreaming && disambiguationOptions.length === 0;
  const isThinking = isStreaming && status === "idle";
  // Must be the newest assistant message: chat.regenerate deletes the newest one
  // server-side, so excluding cached answers here would delete a different
  // message than the one the button is attached to.
  const lastAssistantIndex = messages.findLastIndex(
    (message) => message.role === "ASSISTANT" && Boolean(message.content),
  );
  const lastAssistant = lastAssistantIndex >= 0 ? messages[lastAssistantIndex] : undefined;
  const lastUserContent =
    [...messages].reverse().find((message) => message.role === "USER")?.content ?? "";
  const followUps = lastAssistant && !isStreaming ? followUpsFor(lastUserContent) : [];

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  // The /chat route is a lazy composer: it creates the conversation only when
  // the first message is sent, so "New chat" never leaves an empty row behind.
  const newChat = () => {
    router.push("/chat");
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
          setConfirmClearOpen(false);
          resetMessages();
          void utils.conversation.getById.invalidate({ id: conversationId });
          void utils.conversation.list.invalidate();
          toast({ title: "Conversation cleared", variant: "success" });
        },
        onError: () => {
          setConfirmClearOpen(false);
          toast({ title: "Could not clear the conversation", variant: "error" });
        },
      },
    );
  };

  // ── Mobile top-bar actions (copy / delete) ───────────────────────────────
  // The desktop header shows these inline; on phones they live in the overflow
  // menu in ChatLayout's top bar. Register the handlers here so the menu only
  // appears while a conversation is open (the new-chat page registers none).
  // Read-only views (admin inspecting another user's conversation) keep copy
  // but drop the clear/delete entry — the server would reject it anyway.
  const actionsRef = useRef<ChatActions>({ onCopy: () => undefined });
  actionsRef.current = {
    onCopy: copyConversation,
    onClear: readOnly ? undefined : () => setConfirmClearOpen(true),
  };
  const { setActions } = useChatActions();
  useEffect(() => {
    setActions({
      onCopy: () => actionsRef.current.onCopy(),
      ...(actionsRef.current.onClear ? { onClear: () => actionsRef.current.onClear?.() } : {}),
    });
    return () => setActions(null);
    // `readOnly` arrives asynchronously (conversation.getById resolves after
    // mount, flipping readOnly false→true). Without it in the deps the mobile
    // overflow menu would keep its Delete entry for read-only views — the
    // registration effect must re-run once the read-only state is known.
  }, [setActions, readOnly]);

  const bubbleAnimation = reduceMotion
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  let lastDay = "";

  return (
    <div className="relative flex h-full flex-col">
      {/* ─── Quiet minimal header ───
          No border, no slab: a slim floating row so the conversation is the
          focus. Desktop (md+) shows the segmented answer-mode toggle on the
          left and copy/clear/new-chat on the right; on phones the header is
          hidden entirely — the top bar carries the mode dropdown on the left
          and copy/delete behind its overflow menu on the right. */}
      <header className="hidden shrink-0 flex-nowrap items-center justify-between gap-2 px-4 py-2 md:flex">
        <ModeToggle mode={mode} onChange={setMode} className="hidden shrink-0 md:inline-flex" />
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void copyConversation()}
            aria-label="Copy conversation"
            title="Copy conversation"
            className="grid h-11 w-11 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground sm:h-9 sm:w-9"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setConfirmClearOpen(true)}
            disabled={clearMutation.isPending || messages.length === 0 || readOnly}
            aria-label="Clear conversation"
            title={
              readOnly
                ? "Read-only view — you cannot modify this conversation"
                : "Clear conversation"
            }
            className="grid h-11 w-11 place-items-center rounded-lg text-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50 sm:h-9 sm:w-9"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={newChat}
            aria-label="New chat"
            className="brand-gradient ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-white shadow-[0_4px_12px_-4px_var(--color-primary)] transition hover:brightness-110 sm:min-h-9 sm:px-2.5 sm:py-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {/* Keep the label on anything wider than a phone; icon-only below so
                the row never wraps on 320px screens. */}
            <span className="hidden sm:inline">New chat</span>
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="touch-pan-y flex-1 overflow-y-auto">
        {" "}
        <div
          className="chat-column flex flex-col gap-4 px-4 py-6"
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label="Conversation"
        >
          {readOnly && !isEmpty && (
            <div
              role="note"
              className="rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 text-center text-xs text-muted"
            >
              Read-only view — this conversation belongs to another user. You can read and copy it,
              but sending messages is disabled.
            </div>
          )}

          {isEmpty && <ChatEmptyState />}

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
                    feedback={feedbackState[message.id] ?? null}
                    onRegenerate={
                      isLastAssistant && !readOnly ? () => void regenerate(mode) : undefined
                    }
                    onFeedback={(rating) => {
                      setFeedbackState((prev) => ({ ...prev, [message.id]: rating }));
                      feedbackMutation.mutate(
                        {
                          messageId: message.id,
                          rating: rating === "up" ? "UP" : rating === "down" ? "DOWN" : null,
                        },
                        {
                          onError: () => {
                            toast({
                              title: "Could not save feedback",
                              variant: "error",
                            });
                          },
                        },
                      );
                    }}
                    onCopied={() =>
                      toast({
                        title: "Copied to clipboard",
                        variant: "success",
                      })
                    }
                    onCopyFailed={() =>
                      toast({
                        title: "Clipboard access unavailable",
                        variant: "error",
                      })
                    }
                  />
                </motion.div>
              </div>
            );
          })}

          {!readOnly && disambiguationOptions.length > 0 && (
            <DisambiguationCards
              options={disambiguationOptions}
              onSelect={(option) => void sendMessage(option, mode)}
            />
          )}

          {isThinking && <ThinkingIndicator />}

          {isStreaming && !isThinking && <PipelineStatus status={status} />}

          {!readOnly && followUps.length > 0 && lastAssistant && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted">Follow up</span>
              {followUps.map((followUp) => (
                <button
                  key={followUp}
                  type="button"
                  onClick={() => void sendMessage(followUp, mode)}
                  className="grid min-h-11 place-items-center rounded-full border border-glass-border bg-glass px-3 py-1.5 text-xs text-muted backdrop-blur transition hover:border-primary/60 hover:text-foreground hover:shadow-[0_0_16px_-6px_var(--color-primary)] sm:inline-flex"
                >
                  {followUp}
                </button>
              ))}
            </div>
          )}

          {notice && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted"
            >
              {notice}
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

          {notFound && !isLoading && (
            <div className="grid h-full place-items-center px-4">
              <div className="max-w-sm rounded-2xl border border-glass-border bg-glass p-8 text-center shadow-glass backdrop-blur">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <MessageCircle className="h-6 w-6" />
                </span>
                <h2 className="mt-5 text-lg font-semibold">Conversation not found</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  This conversation may have been deleted, or you don&apos;t have access to it.
                </p>
                <button
                  type="button"
                  onClick={newChat}
                  className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover"
                >
                  <Plus className="h-4 w-4" />
                  Start a new chat
                </button>
              </div>
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
          className="absolute bottom-36 right-4 z-20 grid h-10 w-10 place-items-center rounded-full border border-glass-border bg-glass text-foreground shadow-glass backdrop-blur transition hover:bg-surface-hover sm:bottom-28 sm:right-6"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}

      {!notFound && !readOnly && (
        <>
          {/* Separate suggestions window above the composer — never inside the
              conversation view, and only BEFORE the first ask: once the first
              message exists the panel disappears and the thread stays clean. */}
          {isEmpty && <ChatSuggestions onSubmit={(query) => void sendMessage(query, mode)} />}
          <ChatInput
            conversationId={conversationId}
            onSubmit={(query) => void sendMessage(query, mode)}
            onStop={stop}
            isStreaming={isStreaming}
            autoFocus={isEmpty}
          />
        </>
      )}

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Clear this conversation?"
        description={`This permanently deletes all ${messages.length} message${messages.length === 1 ? "" : "s"} in this conversation. This cannot be undone.`}
        confirmLabel="Clear conversation"
        isPending={clearMutation.isPending}
        onConfirm={clearConversation}
      />

      <GuestLimitDialog open={guestLimitOpen} onOpenChange={setGuestLimitOpen} />
    </div>
  );
}
