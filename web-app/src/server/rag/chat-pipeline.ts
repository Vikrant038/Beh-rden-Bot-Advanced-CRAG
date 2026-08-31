import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { createMemory } from "@/server/rag/memory/summary-buffer";
import { runStandardCrag } from "@/server/rag/pipeline";
import { runAgenticRag } from "@/server/rag/agents/orchestrator";
import { isQueryOutOfDomain, OUT_OF_DOMAIN_MESSAGE } from "@/server/rag/guardrail";
import { getHybridRetriever } from "@/server/rag/instance";
import { runStageZero } from "@/server/rag/stage-zero";
import type { PipelineEvent } from "@/server/rag/types";
import { runWithTraceGen, setTraceInput } from "@/server/tracing";
import { NotFoundError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";
import type { ChatMetadata, ChatMode, ChatSource, ChatStreamEvent } from "@/lib/chat/types";
import { MAX_QUERY_LENGTH } from "@/lib/chat/types";
import { WORDS_PER_CHUNK } from "@/config/app";

const logger = createLogger("chat-stream");

export interface ChatStreamInput {
  conversationId: string;
  userId: string;
  query: string;
  mode: ChatMode;
  bypassCache?: boolean;
  signal?: AbortSignal;
}

const GENERIC_ERROR_MESSAGE =
  "I'm sorry, I encountered an error while processing your request. Please try again in a moment.";

function chunkText(text: string, wordsPerChunk: number = WORDS_PER_CHUNK): string[] {
  // Keep each word's trailing whitespace (spaces + newlines) attached so that
  // concatenating the chunks reconstructs the original text exactly. Splitting
  // on \s+ and re-joining words dropped the space between chunk boundaries
  // ("ensure a" + "smooth…" → "ensure asmooth…") and flattened markdown.
  const tokens = text.match(/\S+\s*/g) ?? [];
  if (tokens.length === 0) {
    return [""];
  }
  const chunks: string[] = [];
  for (let i = 0; i < tokens.length; i += wordsPerChunk) {
    chunks.push(tokens.slice(i, i + wordsPerChunk).join(""));
  }
  return chunks;
}

/**
 * Minimal async push-queue used to stream `onEvent` telemetry out of
 * `runAgenticRag` (which runs as a plain promise) through this async
 * generator. Unlike a manual promise/queue bridge, the iterator protocol
 * guarantees no event can be lost or double-woken, and terminating the
 * consumer (SSE client disconnect) wakes any pending waiter instead of
 * leaking a microtask.
 */
class AsyncEventQueue<T> {
  private events: T[] = [];
  private waiters: Array<(result: IteratorResult<T>) => void> = [];
  private done = false;
  private error: unknown = undefined;

  push(event: T): void {
    if (this.done) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.events.push(event);
    }
  }

  complete(): void {
    this.finish(undefined);
  }

  fail(error: unknown): void {
    this.finish(error);
  }

  private finish(error: unknown): void {
    if (this.done) {
      return;
    }
    this.done = true;
    this.error = error;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => this.next(),
      return: (): Promise<IteratorResult<T>> => {
        // Consumer bailed early (stream cancelled) — wake pending waiters so
        // the background pipeline promise can settle without a leaked task.
        this.finish(undefined);
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }

  private next(): Promise<IteratorResult<T>> {
    const event = this.events.shift();
    if (event !== undefined) {
      return Promise.resolve({ value: event, done: false });
    }
    if (this.done) {
      return this.error !== undefined
        ? Promise.reject(this.error)
        : Promise.resolve({ value: undefined, done: true });
    }
    return new Promise<IteratorResult<T>>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

async function findOrCreateUserMessage(
  conversationId: string,
  query: string,
  mode: ChatMode,
): Promise<{ id: string }> {
  const last = await prisma.message.findFirst({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    select: { id: true, role: true, content: true },
  });
  if (last && last.role === "USER" && last.content === query) {
    return last;
  }
  return prisma.message.create({
    data: {
      conversationId,
      role: "USER",
      content: query,
      metadata: { mode },
    },
  });
}

/**
 * Runs the full chat turn for the SSE endpoint and yields streaming events:
 * ownership check → persist user message → Stage-0B disambiguation →
 * Stage-0A guardrail (standard) → pipeline (statuses) → persist assistant →
 * token stream → done. The answer is produced by the synchronous pipeline and
 * then revealed token-by-token so the status bar + typing indicator stay live.
 */
export async function* runChatStream(input: ChatStreamInput): AsyncGenerator<ChatStreamEvent> {
  const { conversationId, userId, query, mode } = input;
  yield* runWithTraceGen(
    {
      name: "chat-turn",
      userId,
      sessionId: conversationId,
      metadata: { mode },
      input: query.trim().slice(0, 200),
    },
    () => runChatStreamInner(input),
  );
}

async function* runChatStreamInner(input: ChatStreamInput): AsyncGenerator<ChatStreamEvent> {
  const { conversationId, userId, query, mode, bypassCache = false, signal } = input;
  const trimmedQuery = query.trim().slice(0, MAX_QUERY_LENGTH);

  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.userId !== userId) {
    throw new NotFoundError("Conversation", conversationId);
  }

  await findOrCreateUserMessage(conversationId, trimmedQuery, mode);

  // Always bump updatedAt when a message is sent so the conversation moves to
  // the top of the sidebar immediately (not only after the stream finishes).
  // The first message also claims the title from the query.
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      title:
        conversation.title && conversation.title !== "New conversation"
          ? conversation.title
          : trimmedQuery.slice(0, 48),
      updatedAt: new Date(),
    },
  });
  // Stage 0 — PII mask + disambiguation, run exactly once. The returned
  // `maskedQuery` is passed into the pipelines below so neither re-masks.
  // The stage events bracket the call so the client sees the Disambiguation
  // indicator live while the (slow) disambiguation LLM call runs.
  const t0_dis = Date.now();
  yield {
    type: "stage_start",
    stage: "disambiguation",
    label: "Disambiguation Check",
    timestamp: t0_dis,
  };
  const { maskedQuery, disambiguation } = await runStageZero(trimmedQuery);
  setTraceInput(maskedQuery);
  yield {
    type: "stage_end",
    stage: "disambiguation",
    label: "Disambiguation Check",
    timestamp: Date.now(),
    durationMs: disambiguation.durationMs,
  };

  if (disambiguation.isAmbiguous && disambiguation.options.length >= 2) {
    yield { type: "disambiguation", options: disambiguation.options };
    return;
  }

  const memory = createMemory(conversationId);

  if (mode === "standard") {
    const blocked = await isQueryOutOfDomain(maskedQuery);
    if (blocked) {
      const blockedMetadata: ChatMetadata = {
        retrievalPath: "GUARDRAIL_BLOCKED",
        isGrounded: false,
        isCached: false,
        mode,
        blocked: true,
      };
      yield { type: "status", stage: "agent_writer" };
      yield* finishWithAnswer(conversationId, OUT_OF_DOMAIN_MESSAGE, [], blockedMetadata, signal);
      return;
    }
  }

  let result: {
    answer: string;
    sources: ChatSource[];
    retrievalPath: string;
    latencyMs: number;
    isGrounded: boolean;
    isCached: boolean;
  };

  // True once the writer has streamed its answer live, so the finished string
  // must not be replayed as tokens afterwards.
  let streamedAnswer = false;

  try {
    if (mode === "standard") {
      yield { type: "status", stage: "retrieving" };
      const standardResult = await runStandardCrag(trimmedQuery, {
        hybridRetriever: getHybridRetriever(),
        cache: semanticCache,
        memory,
        bypassCache,
        maskedQuery,
      });
      result = {
        answer: standardResult.answer,
        sources: standardResult.sources,
        retrievalPath: standardResult.retrievalPath,
        latencyMs: standardResult.latencyMs,
        isGrounded: standardResult.isGrounded,
        isCached: standardResult.isCached,
      };
    } else {
      // No coarse `agent_research` status here: the orchestrator emits a
      // granular `agent_start: research` event (mapped to the Research Tools
      // stage by the client) AFTER the guardrail, keeping the status-bar
      // order correct (Disambiguation → Guardrail → … → Research → …).
      const eventQueue = new AsyncEventQueue<PipelineEvent>();
      const agenticPromise = runAgenticRag(trimmedQuery, {
        hybridRetriever: getHybridRetriever(),
        cache: semanticCache,
        memory,
        bypassCache,
        maskedQuery,
        disambiguation,
        onEvent: (event) => eventQueue.push(event),
      });
      // Close the queue when the pipeline settles so the iterator terminates.
      agenticPromise.then(() => eventQueue.complete()).catch((error) => eventQueue.fail(error));

      // Stream granular telemetry (stage_start/stage_end, agent_start/end,
      // retrieval_telemetry, tool_call) as it is produced, then await the result.
      // Writer `token` events are the live answer; note that we saw them so the
      // finished string is not replayed a second time below.
      for await (const event of eventQueue) {
        if (event.type === "token") {
          streamedAnswer = true;
        }
        yield event as unknown as ChatStreamEvent;
      }
      const agenticResult = await agenticPromise;

      result = {
        answer: agenticResult.finalAnswer,
        sources: agenticResult.sources,
        retrievalPath: "AGENTIC_3_AGENT_REACT",
        latencyMs: agenticResult.totalLatencyMs,
        isGrounded: agenticResult.finalAnswer.includes("Out of Domain") ? false : true,
        isCached: agenticResult.researchSteps[0]?.action === "Semantic Cache Hit",
      };
    }
  } catch (error) {
    logger.error({ error: String(error), conversationId }, "[CHAT STREAM] pipeline failed");
    yield { type: "error", message: GENERIC_ERROR_MESSAGE };
    yield* finishWithAnswer(
      conversationId,
      GENERIC_ERROR_MESSAGE,
      [],
      {
        retrievalPath: "PIPELINE_ERROR",
        isGrounded: false,
        isCached: false,
        mode,
      },
      signal,
    );
    return;
  }

  if (mode === "agentic") {
    yield { type: "status", stage: "agent_analyst" };
    yield { type: "status", stage: "agent_writer" };
  } else {
    yield { type: "status", stage: "agent_writer" };
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
  const persisted = await persistAssistant(conversationId, result.answer, result.sources, {
    retrievalPath: result.retrievalPath,
    latencyMs: result.latencyMs,
    isGrounded: result.isGrounded,
    isCached: result.isCached,
    mode,
  });

  // A cache hit or a writer fallback yields no live tokens, so the answer still
  // has to be revealed here. When the writer streamed, it is already on screen.
  if (!streamedAnswer) {
    yield* streamTokens(result.answer, signal);
  }
  yield {
    type: "done",
    messageId: persisted.id,
    sources: result.sources,
    metadata: {
      retrievalPath: result.retrievalPath,
      latencyMs: result.latencyMs,
      isGrounded: result.isGrounded,
      isCached: result.isCached,
      mode,
    },
  };
}

async function persistAssistant(
  conversationId: string,
  content: string,
  sources: ChatSource[],
  metadata: ChatMetadata,
): Promise<{ id: string }> {
  return prisma.message.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      content,
      sources: sources as unknown as Prisma.InputJsonValue,
      metadata: metadata as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

/**
 * Terminal path for a pre-known answer (guardrail block / pipeline error):
 * persists the message, streams it token-by-token, and closes with `done`.
 */
async function* finishWithAnswer(
  conversationId: string,
  content: string,
  sources: ChatSource[],
  metadata: ChatMetadata,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent, void, undefined> {
  const persisted = await persistAssistant(conversationId, content, sources, metadata);
  yield* streamTokens(content, signal);
  yield { type: "done", messageId: persisted.id, sources, metadata };
}

async function* streamTokens(
  text: string,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent, void, undefined> {
  for (const chunk of chunkText(text)) {
    if (signal?.aborted) {
      break;
    }
    yield { type: "token", content: chunk };
  }
}

export { chunkText };
