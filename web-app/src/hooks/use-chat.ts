"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/trpc/client";
import type { ChatMessage, ChatMode, ChatStreamEvent, PipelineStage } from "@/lib/chat/types";
import { mapChatStageToPipeline } from "@/lib/chat/types";

export const STREAMING_ID = "__streaming__";

export interface UseChatOptions {
  conversationId: string | null;
  onNotFound?: () => void;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  status: PipelineStage;
  error: string | null;
  disambiguationOptions: string[];
  sendMessage: (query: string, mode?: ChatMode) => Promise<void>;
  regenerate: () => Promise<void>;
  stop: () => void;
  resetMessages: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Client-side chat hook: consumes the SSE stream from POST /api/chat/stream
 * (WEB_APP_PLAN §10). Persists the user message via the chat.sendMessage
 * mutation, then appends streaming tokens to a local assistant message until
 * the `done` event replaces it with the persisted message.
 */
export function useChat({ conversationId, onNotFound }: UseChatOptions): UseChatReturn {
  const utils = api.useUtils();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<PipelineStage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [disambiguationOptions, setDisambiguationOptions] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const currentConvIdRef = useRef<string | null>(null);

  const sendMessageMutation = api.chat.sendMessage.useMutation();
  const regenerateMutation = api.chat.regenerate.useMutation();

  const { data: conversation, isLoading, isError } = api.conversation.getById.useQuery(
    { id: conversationId ?? "" },
    { enabled: Boolean(conversationId) },
  );

  useEffect(() => {
    if (conversation) {
      setMessages(conversation.messages);
      if (currentConvIdRef.current !== conversation.id) {
        setDisambiguationOptions([]);
        currentConvIdRef.current = conversation.id;
      }
      setStatus("idle");
    }
  }, [conversation]);

  useEffect(() => {
    // Only redirect if query is finished and returned null or errored
    if (!isLoading && conversationId && (conversation === null || isError)) {
      onNotFound?.();
    }
  }, [conversation, isLoading, isError, conversationId, onNotFound]);

  const handleEvent = useCallback((event: ChatStreamEvent) => {
    switch (event.type) {
      case "status":
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
        setMessages((prev) =>
          prev.map((message) =>
            message.id === STREAMING_ID ? { ...message, content: event.message } : message,
          ),
        );
        setStatus("done");
        break;
    }
  }, []);

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
          try {
            const data = (await response.json()) as { error?: string };
            if (data?.error) {
              message = data.error;
            }
          } catch {
            // Ignore malformed error bodies.
          }
          throw new Error(message);
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
  }, [conversationId, utils]);

  const sendMessage = useCallback(
    async (query: string, mode: ChatMode = "agentic") => {
      const trimmed = query.trim();
      if (!trimmed || !conversationId || isStreaming) {
        return;
      }

      setError(null);
      setDisambiguationOptions([]);

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: "USER",
        content: trimmed,
        createdAt: nowIso(),
      };
      const placeholder: ChatMessage = {
        id: STREAMING_ID,
        role: "ASSISTANT",
        content: "",
        createdAt: nowIso(),
      };
      setMessages((prev) => [...prev, userMessage, placeholder]);

      try {
        await sendMessageMutation.mutateAsync({ conversationId, query: trimmed, mode });
      } catch {
        setMessages((prev) =>
          prev.filter((message) => message.id !== STREAMING_ID && message.id !== userMessage.id),
        );
        setError("Failed to send your message. Please try again.");
        setStatus("idle");
        return;
      }

      try {
        await consumeStream({ query: trimmed, mode });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Streaming request failed");
        setMessages((prev) =>
          prev.map((message) =>
            message.id === STREAMING_ID ? { ...message, content: "Streaming request failed." } : message,
          ),
        );
      } finally {
        await invalidateConversation();
      }
    },
    [conversationId, consumeStream, invalidateConversation, isStreaming, sendMessageMutation],
  );

  const regenerate = useCallback(async () => {
    if (!conversationId || isStreaming) {
      return;
    }

    setError(null);
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
    const mode = lastUser?.metadata?.mode ?? "agentic";

    setMessages((prev) => [
      ...prev,
      { id: STREAMING_ID, role: "ASSISTANT", content: "", createdAt: nowIso() },
    ]);

    await consumeStream({ query: result.query, mode, bypassCache: true });
    await invalidateConversation();
  }, [
    conversationId,
    consumeStream,
    invalidateConversation,
    isStreaming,
    messages,
    regenerateMutation,
  ]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setMessages((prev) =>
      prev.map((message) =>
        message.id === STREAMING_ID
          ? { ...message, id: `stopped-${Date.now()}`, createdAt: nowIso() }
          : message,
      ),
    );
    setStatus("done");
    void invalidateConversation();
  }, [invalidateConversation]);

  const resetMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setDisambiguationOptions([]);
    setStatus("idle");
  }, []);

  return {
    messages,
    isStreaming,
    status,
    error,
    disambiguationOptions,
    sendMessage,
    regenerate,
    stop,
    resetMessages,
  };
}
