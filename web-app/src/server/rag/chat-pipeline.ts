import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { createMemory } from "@/server/rag/memory/summary-buffer";
import { runStandardCrag } from "@/server/rag/pipeline";
import { runAgenticRag } from "@/server/rag/agents/orchestrator";
import { disambiguateQuery } from "@/server/rag/disambiguation";
import { isQueryOutOfDomain } from "@/server/rag/guardrail";
import { getHybridRetriever } from "@/server/rag/instance";
import { maskPii } from "@/server/pii/masker";
import { runWithTraceGen, setTraceInput } from "@/server/tracing";
import { NotFoundError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";
import type {
  ChatMetadata,
  ChatMode,
  ChatSource,
  ChatStage,
  ChatStreamEvent,
} from "@/lib/chat/types";
import { MAX_QUERY_LENGTH } from "@/lib/chat/types";

const logger = createLogger("chat-stream");

export type { ChatStage, ChatStreamEvent };

export interface ChatStreamInput {
  conversationId: string;
  userId: string;
  query: string;
  mode: ChatMode;
  bypassCache?: boolean;
  signal?: AbortSignal;
}

const OUT_OF_DOMAIN_MESSAGE =
  "**Out of Domain Detected:** I am a specialized assistant for German immigration, " +
  "student visas, and university admissions. I cannot help with general queries such as " +
  "programming, sports, or other out-of-scope topics.";

const GENERIC_ERROR_MESSAGE =
  "I'm sorry, I encountered an error while processing your request. Please try again in a moment.";

const WORDS_PER_CHUNK = 3;

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

  yield { type: "status", stage: "guardrail" };

  const { text: maskedQuery } = maskPii(trimmedQuery);
  setTraceInput(maskedQuery);
  const disambiguation = await disambiguateQuery(maskedQuery);
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
      const persisted = await persistAssistant(
        conversationId,
        OUT_OF_DOMAIN_MESSAGE,
        [],
        blockedMetadata,
      );
      yield { type: "status", stage: "agent_writer" };
      yield* streamTokens(OUT_OF_DOMAIN_MESSAGE, signal);
      yield { type: "done", messageId: persisted.id, sources: [], metadata: blockedMetadata };
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

  try {
    if (mode === "standard") {
      yield { type: "status", stage: "retrieving" };
      const standardResult = await runStandardCrag(trimmedQuery, {
        hybridRetriever: getHybridRetriever(),
        cache: semanticCache,
        memory,
        bypassCache,
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
      yield { type: "status", stage: "agent_research" };
      const agenticResult = await runAgenticRag(trimmedQuery, {
        hybridRetriever: getHybridRetriever(),
        cache: semanticCache,
        memory,
        bypassCache,
      });
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
    const persisted = await persistAssistant(conversationId, GENERIC_ERROR_MESSAGE, [], {
      retrievalPath: "PIPELINE_ERROR",
      isGrounded: false,
      isCached: false,
      mode,
    });
    yield { type: "error", message: GENERIC_ERROR_MESSAGE };
    yield { type: "status", stage: "agent_writer" };
    yield* streamTokens(GENERIC_ERROR_MESSAGE, signal);
    yield {
      type: "done",
      messageId: persisted.id,
      sources: [],
      metadata: { retrievalPath: "PIPELINE_ERROR", isGrounded: false, isCached: false, mode },
    };
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

  yield* streamTokens(result.answer, signal);
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
