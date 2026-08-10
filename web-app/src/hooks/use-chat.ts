"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/trpc/client";
import type { ChatMessage, ChatMode, ChatStreamEvent, PipelineStage } from "@/lib/chat/types";
import { mapChatStageToPipeline } from "@/lib/chat/types";
import { GUEST_LIMIT_REACHED_CODE } from "@/lib/guest";

export const STREAMING_ID = "__streaming__";

/** Maximum number of automatic retry attempts after a transient stream failure. */
const MAX_STREAM_RETRIES = 2;
/** Initial backoff delay in ms; doubles on each retry (500 → 1000). */
const RETRY_BACKOFF_MS = 500;

export interface UseChatOptions {
  conversationId: string | null;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  /** True while the initial getById fetch is in flight. */
  isLoading: boolean;
  /** True when the conversation 404'd or the user lacks access. */
  notFound: boolean;
  /** True when the conversation may be read but not written (admins viewing
   * another user's conversation from the dashboard). Composer is disabled. */
  readOnly: boolean;
  status: PipelineStage;
  error: string | null;
  /** Transient, non-fatal progress text (e.g. an automatic retry in flight). */
  notice: string | null;
  /** True when the server rejected the prompt because the guest cap was hit. */
  guestLimitReached: boolean;
  disambiguationOptions: string[];
  sendMessage: (query: string, mode?: ChatMode) => Promise<void>;
  regenerate: (mode?: ChatMode) => Promise<void>;
  stop: () => void;
  resetMessages: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Returns true for errors that are worth retrying automatically:
 * network failures and 5xx responses. 4xx errors (401, 403, 422, 429, etc.)
 * indicate a client-side problem that won't be fixed by retrying.
 */
function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // The guest prompt cap is a hard limit — retrying can never succeed.
  if ("code" in err && err.code === GUEST_LIMIT_REACHED_CODE) {
    return false;
  }
  // "Request failed (5xx)" shape set by consumeStream
  const match = err.message.match(/Request failed \((\d+)\)/);
  if (match) {
    const status = Number(match[1]);
    return status >= 500;
  }
  // Network-level failures (no status code in message)
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Client-side chat hook: consumes the SSE stream from POST /api/chat/stream
 * (WEB_APP_PLAN §10). The pipeline's `findOrCreateUserMessage` owns user-message
 * persistence — no separate tRPC mutation is needed from the hook.
 * Streaming tokens are appended to a local assistant message until the `done`
 * event replaces it with the persisted message.
 * Transient stream failures (network / 5xx) are retried up to MAX_STREAM_RETRIES
 * times with exponential backoff before surfacing an error to the user.
 */
export function useChat({ conversationId }: UseChatOptions): UseChatReturn {
  const utils = api.useUtils();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<PipelineStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [guestLimitReached, setGuestLimitReached] = useState(false);
  const [disambiguationOptions, setDisambiguationOptions] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const currentConvIdRef = useRef<string | null>(null);
  // The server persists the user message and bumps updatedAt before the first
  // status event; refresh the sidebar list once per send so the conversation
  // moves to the top / updates its count promptly instead of only after the
  // whole stream finishes.
  const listRefreshedRef = useRef(false);

  const regenerateMutation = api.chat.regenerate.useMutation();

  const {
    data: conversation,
    isLoading,
    isError,
  } = api.conversation.getById.useQuery(
    { id: conversationId ?? "" },
    {
      enabled: Boolean(conversationId),
      staleTime: 1000 * 60 * 5, // 5 minute stale-time cache for instant switching
      placeholderData: (previousData) => previousData,
    },
  );

  useEffect(() => {
    if (conversation) {
      setMessages(conversation.messages);
      if (currentConvIdRef.current !== conversation.id) {
        setDisambiguationOptions([]);
        currentConvIdRef.current = conversation.id;
      }
      setNotFound(false);
      setReadOnly(Boolean(conversation.readOnly));
      setGuestLimitReached(false);
      setStatus("idle");
    }
  }, [conversation]);

  useEffect(() => {
    // A finished query that returned null or errored means the conversation is
    // gone or inaccessible. We surface a notFound flag instead of navigating —
    // a redirect loop here is what used to spawn a fresh empty conversation on
    // every cycle (see /chat lazy-create).
    if (!isLoading && conversationId && (conversation === null || isError)) {
      setNotFound(true);
    }
  }, [conversation, isLoading, isError, conversationId]);

  const handleEvent = useCallback(
    (event: ChatStreamEvent) => {
      // Refresh the sidebar once per turn on the FIRST streamed event (the
      // server has already persisted the user message + bumped updatedAt), so
      // the conversation moves to the top without waiting for the first
      // legacy `status` event.
      const refreshListOnce = () => {
        if (!listRefreshedRef.current) {
          listRefreshedRef.current = true;
          void utils.conversation.list.invalidate();
          // The user message is already persisted at this point — refresh the
          // guest prompt count so the sidebar chip updates live too.
          void utils.conversation.count.invalidate();
        }
      };
      switch (event.type) {
        case "status":
          refreshListOnce();
          setStatus(mapChatStageToPipeline(event.stage));
          break;
        case "token":
          setMessages((prev) =>
            prev.map((message) =>
              message.id === STREAMING_ID
                ? { ...message, content: message.content + event.content }
                : message,
            ),
          );
          break;
        case "disambiguation":
          setMessages((prev) => prev.filter((message) => message.id !== STREAMING_ID));
          setDisambiguationOptions(event.options);
          setStatus("idle");
          break;
        case "stage_start":
          refreshListOnce();
          // Granular sub-stage (query expansion, dense/BM25, …) — drive the
          // status bar live. Later stages override earlier coarse ones.
          setStatus(mapChatStageToPipeline(event.stage));
          break;
        case "agent_start":
          setStatus(mapChatStageToPipeline(`agent_${event.agent}`));
          break;
        // stage_end / agent_end / retrieval_telemetry / tool_call carry metrics
        // for the trace visualizer; the chat status bar needs no state change.
        case "stage_end":
        case "agent_end":
        case "retrieval_telemetry":
        case "tool_call":
          break;
        case "done":
          setMessages((prev) =>
            prev.map((message) =>
              message.id === STREAMING_ID
                ? {
                    id: event.messageId,
                    role: "ASSISTANT",
                    content: message.content,
                    sources: event.sources,
                    metadata: event.metadata,
                    createdAt: nowIso(),
                  }
                : message,
            ),
          );
          setStatus("done");
          break;
        case "error":
          setError(event.message);
          // The server follows an `error` event with the same text as `token`
          // chunks, so clear the bubble here rather than writing the message in —
          // otherwise the apology is appended onto itself and shown twice.
          setMessages((prev) =>
            prev.map((message) =>
              message.id === STREAMING_ID ? { ...message, content: "" } : message,
            ),
          );
          break;
      }
    },
    [utils],
  );

  const consumeStream = useCallback(
    async (payload: { query: string; mode: ChatMode; bypassCache?: boolean }) => {
      if (!conversationId) {
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      setIsStreaming(true);
      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            query: payload.query,
            mode: payload.mode,
            bypassCache: payload.bypassCache ?? false,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let message = `Request failed (${response.status})`;
          let code: string | undefined;
          try {
            const data = (await response.json()) as { error?: string; code?: string };
            if (data?.error) {
              message = data.error;
            }
            code = data?.code;
          } catch {
            // Ignore malformed error bodies.
          }
          if (code === GUEST_LIMIT_REACHED_CODE) {
            setGuestLimitReached(true);
          }
          const error = new Error(message) as Error & { code?: string };
          if (code) {
            error.code = code;
          }
          throw error;
        }

        if (!response.body) {
          throw new Error("Streaming response has no body.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });

          let separator = buffer.indexOf("\n\n");
          while (separator !== -1) {
            const rawEvent = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data: "));
            if (dataLine) {
              try {
                handleEvent(JSON.parse(dataLine.slice(6)) as ChatStreamEvent);
              } catch {
                // Ignore malformed SSE payloads.
              }
            }
            separator = buffer.indexOf("\n\n");
          }
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [conversationId, handleEvent],
  );

  const invalidateConversation = useCallback(async () => {
    if (!conversationId) {
      return;
    }
    await utils.conversation.getById.invalidate({ id: conversationId });
    await utils.conversation.list.invalidate();
    // Guest prompt count changes with every user message (send/regenerate/stop
    // can all persist a USER row) — invalidate so the sidebar chip is live.
    await utils.conversation.count.invalidate();
  }, [conversationId, utils]);

  const sendMessage = useCallback(
    async (query: string, mode: ChatMode = "agentic") => {
      const trimmed = query.trim();
      if (!trimmed || !conversationId || isStreaming || readOnly) {
        return;
      }

      setError(null);
      setNotice(null);
      setDisambiguationOptions([]);
      setGuestLimitReached(false);
      listRefreshedRef.current = false;

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "USER",
        content: trimmed,
        // Record the mode so a later regenerate() can reuse it.
        metadata: { mode },
        createdAt: nowIso(),
      };
      const placeholder: ChatMessage = {
        id: STREAMING_ID,
        role: "ASSISTANT",
        content: "",
        createdAt: nowIso(),
      };
      setMessages((prev) => [...prev, userMessage, placeholder]);

      let lastErr: unknown;
      for (let attempt = 0; attempt <= MAX_STREAM_RETRIES; attempt++) {
        if (attempt > 0) {
          // Re-arm the sidebar refresh for the retry: the previous attempt may
          // have already consumed its first status event, and a fresh attempt
          // bumps updatedAt again on the server — the list should refresh again.
          listRefreshedRef.current = false;
          // Reset the streaming placeholder content between retries so tokens
          // don't double-accumulate if a partial stream succeeded then failed.
          setMessages((prev) =>
            prev.map((message) =>
              message.id === STREAMING_ID ? { ...message, content: "" } : message,
            ),
          );
          await sleep(RETRY_BACKOFF_MS * attempt);
        }

        try {
          await consumeStream({ query: trimmed, mode });
          lastErr = null;
          break; // success — exit retry loop
        } catch (err) {
          lastErr = err;
          if (!isRetryableError(err) || attempt === MAX_STREAM_RETRIES) {
            break; // non-retryable or exhausted — stop
          }
          // Transient error — surface as a non-fatal notice, not an error alert.
          setNotice(`Retrying… (attempt ${attempt + 1}/${MAX_STREAM_RETRIES})`);
        }
      }

      setNotice(null);
      if (lastErr) {
        const message = lastErr instanceof Error ? lastErr.message : "Streaming request failed";
        const limitHit =
          lastErr instanceof Error &&
          "code" in lastErr &&
          lastErr.code === GUEST_LIMIT_REACHED_CODE;
        setError(message);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === STREAMING_ID
              ? { ...msg, content: limitHit ? message : "Streaming request failed." }
              : msg,
          ),
        );
      } else {
        setError(null);
      }

      await invalidateConversation();
    },
    [conversationId, consumeStream, invalidateConversation, isStreaming, readOnly],
  );

  const regenerate = useCallback(
    async (mode?: ChatMode) => {
      if (!conversationId || isStreaming || readOnly) {
        return;
      }

      setError(null);
      setNotice(null);
      setGuestLimitReached(false);
      listRefreshedRef.current = false;
      let result: { userMessageId: string; query: string; conversationId: string };
      try {
        result = await regenerateMutation.mutateAsync({ conversationId });
      } catch {
        setError("Could not regenerate the previous response.");
        return;
      }

      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i -= 1) {
          if (next[i].role === "ASSISTANT") {
            next.splice(i, 1);
            break;
          }
        }
        return next;
      });

      const lastUser = messages.filter((message) => message.role === "USER").at(-1);
      const effectiveMode = mode ?? lastUser?.metadata?.mode ?? "agentic";

      setMessages((prev) => [
        ...prev,
        { id: STREAMING_ID, role: "ASSISTANT", content: "", createdAt: nowIso() },
      ]);

      try {
        await consumeStream({ query: result.query, mode: effectiveMode, bypassCache: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Regenerate failed";
        setError(message);
        setMessages((prev) => prev.filter((msg) => msg.id !== STREAMING_ID));
      }
      await invalidateConversation();
    },
    [
      conversationId,
      consumeStream,
      invalidateConversation,
      isStreaming,
      messages,
      readOnly,
      regenerateMutation,
    ],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();

    // Detach the streaming placeholder so the tokens received so far stay
    // visible for this session.
    setMessages((prev) =>
      prev.map((message) =>
        message.id === STREAMING_ID
          ? { ...message, id: `stopped-${Date.now()}`, createdAt: nowIso() }
          : message,
      ),
    );

    setStatus("done");

    // No partial write here: the pipeline persists the complete answer before it
    // streams a single token, so the reloaded conversation already holds the
    // full text. Writing the truncated copy too would create a duplicate row.
    void invalidateConversation();
  }, [invalidateConversation]);

  const resetMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setDisambiguationOptions([]);
    setGuestLimitReached(false);
    setStatus("idle");
  }, []);

  return {
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
  };
}
