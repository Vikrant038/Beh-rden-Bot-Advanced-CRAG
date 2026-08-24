"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { GraduationCap, LogIn, MessagesSquare } from "lucide-react";
import { api } from "@/lib/trpc/client";
import { ChatEmptyState } from "@/components/chat/chat-empty-state";
import { ChatSuggestions } from "@/components/chat/chat-suggestions";
import { ModeToggle } from "@/components/chat/mode-toggle";
import { useMode } from "@/components/chat/mode-context";
import { ChatInput } from "@/components/chat/chat-input";
import type { ChatMode } from "@/lib/chat/types";
import { GUEST_LIMIT_REACHED_CODE, GUEST_PROMPT_LIMIT } from "@/lib/guest";

/**
 * New-chat landing. Unlike the old eager auto-create (which spawned an empty
 * conversation on every mount — and twice under React StrictMode, flooding
 * history with "New conversation" rows), this page creates NOTHING until the
 * user actually sends a message. The first message creates the conversation and
 * is handed off to /chat/:id via the `q` search param.
 */
export default function NewChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = api.useUtils();
  const createMutation = api.conversation.create.useMutation();
  // Shared with the mobile top-bar dropdown (ModeProvider in ChatLayout).
  const { mode, setMode } = useMode();
  const startedPrefillRef = useRef(false);

  const limitReached = createMutation.error?.data?.code === GUEST_LIMIT_REACHED_CODE;

  const startConversation = async (query: string, chatMode: ChatMode) => {
    if (createMutation.isPending) {
      return;
    }
    try {
      const conversation = await createMutation.mutateAsync({ mode: chatMode });

      // Pre-seed cache so ChatInterface getById query resolves in 0ms without waiting for a database roundtrip
      utils.conversation.getById.setData(
        { id: conversation.id },
        {
          id: conversation.id,
          mode: chatMode === "agentic" ? "AGENTIC" : "STANDARD",
          title: query.slice(0, 50),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: [],
          readOnly: false,
        },
      );

      // Hand the first message (and its mode) to the fresh conversation via the URL
      router.replace(
        `/chat/${conversation.id}?q=${encodeURIComponent(query.trim())}&m=${chatMode}`,
      );
    } catch {
      // Guest limit / generic error surfaced via createMutation.error below.
    }
  };

  // Landing-page sample chips deep-link here as /chat?q=<query> — start the
  // conversation immediately with the prefilled question. Guarded so StrictMode's
  // double-mount only starts it once.
  useEffect(() => {
    const query = searchParams.get("q")?.trim();
    if (!query || startedPrefillRef.current) {
      return;
    }
    startedPrefillRef.current = true;
    void startConversation(query, "agentic");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (limitReached) {
    return (
      <div className="grid h-full place-items-center px-4">
        <div className="max-w-sm rounded-2xl border border-glass-border bg-glass p-8 text-center shadow-glass backdrop-blur">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
            <MessagesSquare className="h-6 w-6" />
          </span>
          <h1 className="mt-5 text-lg font-semibold">Guest limit reached</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Free guest browsing includes up to {GUEST_PROMPT_LIMIT} prompts. Sign in to keep
            chatting — your existing conversations will be saved to your account automatically.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover"
          >
            <LogIn className="h-4 w-4" />
            Sign in to continue
          </Link>
          <p className="mt-3 text-[11px] text-muted">
            <GraduationCap className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
            Your conversations move to your account after sign-in.
          </p>
        </div>
      </div>
    );
  }

  if (createMutation.isError) {
    return (
      <div className="grid h-full place-items-center px-4 text-center">
        <div>
          <p className="text-sm text-destructive">Could not start a conversation.</p>
          <button
            type="button"
            onClick={() => createMutation.reset()}
            className="mt-4 rounded-xl border border-border px-4 py-2 text-sm text-muted transition hover:bg-surface-hover hover:text-foreground"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Answer mode is chosen at the top of the screen, before typing.
          Desktop (md+) only — phones use the top-bar dropdown in ChatLayout. */}
      <header className="hidden shrink-0 items-center justify-between gap-2 px-4 py-2 md:flex">
        <ModeToggle mode={mode} onChange={setMode} />
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
          <ChatEmptyState />
        </div>
      </div>
      {/* Separate suggestions window above the composer. */}
      <ChatSuggestions onSubmit={(query) => void startConversation(query, mode)} />
      <ChatInput
        onSubmit={(query) => void startConversation(query, mode)}
        onStop={() => undefined}
        isStreaming={false}
        disabled={createMutation.isPending}
      />
    </div>
  );
}
