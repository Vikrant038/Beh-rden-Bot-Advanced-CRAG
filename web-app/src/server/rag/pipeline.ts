import type { Chunk, Source } from "@/server/rag/types";
import type { HybridRetriever } from "@/server/rag/retrieval/hybrid";
import { runCragGate } from "@/server/rag/crag-gate";
import { generateSubQueries } from "@/server/rag/query-expansion";
import { callLLM } from "@/server/llm/client";
import type { LlmMessage } from "@/server/llm/client";
import { maskPii } from "@/server/pii/masker";
import type { SemanticCache } from "@/server/rag/cache/semantic-cache";
import { SummaryBufferMemory } from "@/server/rag/memory/summary-buffer";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("standard-crag");

export interface StandardRagOptions {
  hybridRetriever: HybridRetriever;
  cache: SemanticCache;
  memory: SummaryBufferMemory;
  bypassCache?: boolean;
  topK?: number;
}

export interface StandardRagResult {
  question: string;
  answer: string;
  sources: Source[];
  retrievalPath: string;
  latencyMs: number;
  isGrounded: boolean;
  isCached: boolean;
}

const SYSTEM_PROMPT =
  "You are Behoerden-Bot, an official expert assistant for German university admissions, " +
  "student visa processes, APS certification, and blocked accounts.\n" +
  "Your answers must be clear, factual, well-structured, and strictly grounded in the provided official context.";

function formatContextForPrompt(chunks: Chunk[]): string {
  if (chunks.length === 0) {
    return "No relevant context found.";
  }
  return chunks
    .map((chunk) => `[Source: ${chunk.sourceName} (${chunk.sourceUrl})]\n${chunk.text}`)
    .join("\n\n");
}

/**
 * Standard CRAG pipeline (ported from `src/rag.py:rag_answer`):
 * cache check → guardrail-free hybrid retrieval (guardrail runs at entry of
 * the orchestrating router) → CRAG gate → grounded LLM generation → persist.
 */
export async function runStandardCrag(
  question: string,
  options: StandardRagOptions,
): Promise<StandardRagResult> {
  const startTime = Date.now();
  const { hybridRetriever, cache, memory, bypassCache = false } = options;

  const { text: maskedQuestion } = maskPii(question);
  const queryVector = await hybridRetriever.embedQuery(maskedQuestion);

  const cached = await cache.checkCache(maskedQuestion, queryVector);
  if (cached) {
    await memory.addTurn(question, cached.answer);
    return {
      question,
      answer: cached.answer,
      sources: cached.sources,
      retrievalPath: cached.retrievalPath,
      latencyMs: Date.now() - startTime,
      isGrounded: true,
      isCached: true,
    };
  }

  const subQueries = await generateSubQueries(maskedQuestion, 5);
  const retrieval = await hybridRetriever.retrieve(maskedQuestion, subQueries);
  const gate = await runCragGate(retrieval, maskedQuestion);

  const filteredChunks = gate.chunks.filter(
    (chunk) => (chunk.crossScore ?? chunk.similarityScore ?? 0) >= 0.2,
  );

  let answerText: string;
  let isGrounded: boolean;
  let pathUsed: string;

  if (filteredChunks.length === 0 || gate.needsWebFallback) {
    answerText =
      "I do not have sufficient official information in my knowledge base to answer this question reliably.";
    isGrounded = false;
    pathUsed = "CRAG_FALLBACK_UNGROUNDED";
  } else {
    const memoryContext = await memory.getContextFormatted();
    const contextText = formatContextForPrompt(filteredChunks);
    const userPrompt =
      `${memoryContext}\n\n` +
      `OFFICIAL CONTEXT CHUNKS:\n${contextText}\n\n` +
      `USER QUESTION:\n${question}\n\n` +
      `Generate a structured, professional markdown response with subheadings, bullet points, and an 'Actionable Next Steps' section.`;

    const messages: LlmMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ];
    try {
      answerText = await callLLM(messages, { maxTokens: 600, temperature: 0.2 });
      isGrounded = true;
      pathUsed = gate.pathUsed;
    } catch (error) {
      logger.warn({ error: String(error) }, "[CRAG] generation failed");
      answerText =
        "I do not have sufficient official information in my knowledge base to answer this question reliably.";
      isGrounded = false;
      pathUsed = "LLM_GENERATION_FAILED";
    }
  }

  const sources: Source[] = filteredChunks.map((chunk) => ({
    name: chunk.sourceName,
    url: chunk.sourceUrl,
    score: chunk.crossScore ?? chunk.similarityScore ?? 0,
    documentId: chunk.documentId,
  }));

  const parentDocIds = Array.from(
    new Set(sources.map((source) => source.documentId).filter((id): id is string => Boolean(id))),
  );

  // M1: never cache ungrounded fallback/error answers — a transient failure
  // (e.g. web-search timeout) must not be persisted as a 7-day cached reply.
  if (!bypassCache && isGrounded) {
    await cache.addToCache(
      maskedQuestion,
      queryVector,
      { answer: answerText, sources },
      parentDocIds,
    );
  }
  await memory.addTurn(question, answerText);

  return {
    question,
    answer: answerText,
    sources,
    retrievalPath: pathUsed,
    latencyMs: Date.now() - startTime,
    isGrounded,
    isCached: false,
  };
}
