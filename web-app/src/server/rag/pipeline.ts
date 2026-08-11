import type { Source } from "@/server/rag/types";
import {
  type PreProcessingTelemetry,
  type PostProcessingTelemetry,
  type RetrievalTelemetry,
} from "@/server/rag/types";
// Type-only import (erased at runtime) — avoids any runtime cycle with the
// orchestrator, which imports this module's pipeline runner.
import type { PipelineStage } from "@/server/rag/agents/orchestrator";
import type { HybridRetriever } from "@/server/rag/retrieval/hybrid";
import { runCragGate } from "@/server/rag/crag-gate";
import { generateSubQueries } from "@/server/rag/query-expansion";
import { callLLM } from "@/server/llm/client";
import type { LlmMessage } from "@/server/llm/client";
import { maskPii } from "@/server/pii/masker";
import { formatChunksForPrompt } from "@/server/rag/tools/web-search";
import type { SemanticCache, CachedResponse } from "@/server/rag/cache/semantic-cache";
import { buildStandardSystemPrompt } from "@/server/rag/prompt";
import { LLM_MAX_TOKENS_ANSWER, LLM_TEMPERATURE_MEDIUM } from "@/config/app";
import { LlmUsageCollector, withLlmUsageCollector, type LlmCallRecord } from "@/server/llm/usage";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("standard-crag");

/**
 * Minimal memory contract the standard CRAG path needs — structural on purpose
 * so the chat passes `SummaryBufferMemory` and the admin pipeline tester can
 * pass its side-effect-free `NoopMemory` (the class's private fields would
 * otherwise make it nominally incompatible).
 */
export interface StandardMemoryLike {
  ensureLoaded(): Promise<void>;
  addTurn(userQuery: string, assistantResponse: string): Promise<void>;
  getContextFormatted(): Promise<string>;
  clear(): Promise<void>;
}

export interface StandardRagOptions {
  hybridRetriever: HybridRetriever;
  cache: SemanticCache;
  memory: StandardMemoryLike;
  bypassCache?: boolean;
  topK?: number;
  /**
   * Pre-masked query. The chat stream already masks in Stage 0; passing the
   * masked text here avoids a second maskPii pass on the same query.
   */
  maskedQuery?: string;
  /**
   * Collect per-stage timings + LLM cost telemetry for the admin pipeline
   * tester. Off by default — the chat path never pays for it.
   */
  collectTrace?: boolean;
}

export interface StandardRagResult {
  question: string;
  answer: string;
  sources: Source[];
  retrievalPath: string;
  latencyMs: number;
  isGrounded: boolean;
  isCached: boolean;
  /** ISO 639-1 language of the user's query, detected during expansion. */
  language?: string;
  /**
   * True when a cache hit served an answer written in a different language
   * than the current user's query (known only on the canonical-English path,
   * where expansion ran to produce the cache key).
   */
  languageMismatch?: boolean;
  /** Glass-box trace — present only when `collectTrace` was set. */
  trace?: StandardRagTrace;
}

/**
 * Glass-box trace for the standard CRAG pipeline, shaped so the admin pipeline
 * visualizer can render it next to the agentic trace. `guardrail` defaults to
 * passed inside the pipeline (CRAG itself is guardrail-free — the guardrail
 * runs at the orchestrating router); the caller may override it.
 */
export interface StandardRagTrace {
  pipeline: "standard";
  userQuery: string;
  maskedQuery: string;
  guardrail: { passed: boolean; reason?: string; durationMs?: number };
  finalAnswer: string;
  sources: Source[];
  retrievalPath: string;
  isGrounded: boolean;
  isCached: boolean;
  /** ISO 639-1 language of the user's query, detected during expansion. */
  language?: string;
  /** True when a cache hit's answer language differs from the query language. */
  languageMismatch?: boolean;
  disambiguation?: { durationMs: number; isAmbiguous: boolean; options: string[] };
  retrievalTelemetry?: RetrievalTelemetry;
  totalLatencyMs: number;
  stages: PipelineStage[];
  llmCalls: LlmCallRecord[];
  totalCostUsd: number;
  preProcessing?: PreProcessingTelemetry;
  postProcessing?: PostProcessingTelemetry;
}

/** CRAG stage names, indexed to match `PipelineStage.index`. */
const CRAG_STAGE_NAMES = [
  "Query preprocessing & cache lookup",
  "Sub-query expansion & hybrid retrieval",
  "CRAG gate (relevance grading)",
  "Grounded generation (LLM)",
  "Cache write & memory persist",
];

function buildCragStages(
  durations: number[],
  executedThrough: number,
  cacheHit: boolean,
): PipelineStage[] {
  return CRAG_STAGE_NAMES.map((name, index) => ({
    index,
    name,
    durationMs:
      index === 0 && cacheHit
        ? durations[0]
        : index <= executedThrough
          ? (durations[index] ?? 0)
          : 0,
    status: index <= executedThrough ? "executed" : "skipped",
  }));
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
  const collector = new LlmUsageCollector();
  const core = async (): Promise<StandardRagResult> => {
    const startTime = Date.now();
    const { hybridRetriever, cache, memory, bypassCache = false, collectTrace = false } = options;

    // Pre-processing: PII mask + query embedding + semantic cache lookup.
    const t_pii = Date.now();
    const maskedQuestion = options.maskedQuery ?? maskPii(question).text;
    const piiMaskingDurationMs = options.maskedQuery !== undefined ? 0 : Date.now() - t_pii;

    // Serves a cache hit: persists the turn to memory and shapes the result
    // (including the glass-box trace when the admin tester asked for one).
    // Shared by the original-query hit and the canonical-English hit below.
    // `requestLanguage` is the current user's query language (only known on
    // the canonical path, where expansion ran); when it differs from the
    // cached answer's language, the caller can flag/re-render the reply.
    const serveCached = async (
      entry: CachedResponse,
      lookupDurationMs: number,
      requestLanguage?: string,
    ): Promise<StandardRagResult> => {
      const t_mem = Date.now();
      await memory.addTurn(question, entry.answer);
      const memoryWriteDurationMs = Date.now() - t_mem;
      const latencyMs = Date.now() - startTime;
      const languageMismatch =
        requestLanguage !== undefined &&
        entry.language !== undefined &&
        requestLanguage !== entry.language;
      const result: StandardRagResult = {
        question,
        answer: entry.answer,
        sources: entry.sources,
        retrievalPath: entry.retrievalPath,
        latencyMs,
        isGrounded: true,
        isCached: true,
        language: entry.language,
        languageMismatch: languageMismatch || undefined,
      };
      if (collectTrace) {
        result.trace = {
          pipeline: "standard",
          userQuery: question,
          maskedQuery: maskedQuestion,
          guardrail: { passed: true },
          finalAnswer: entry.answer,
          sources: entry.sources,
          retrievalPath: entry.retrievalPath,
          isGrounded: true,
          isCached: true,
          language: entry.language,
          languageMismatch: languageMismatch || undefined,
          totalLatencyMs: latencyMs,
          stages: buildCragStages([piiMaskingDurationMs + lookupDurationMs], 0, true),
          llmCalls: collector.calls,
          totalCostUsd: collector.totalCostUsd,
          preProcessing: {
            piiMaskingDurationMs,
            cacheLookupDurationMs: lookupDurationMs,
            cacheHit: true,
          },
          postProcessing: {
            cacheWriteDurationMs: 0,
            memoryWriteDurationMs,
            cacheWritten: false,
          },
        };
      }
      return result;
    };

    const t_cache = Date.now();
    const queryVector = await hybridRetriever.embedQuery(maskedQuestion);
    const cached = await cache.checkCache(maskedQuestion, queryVector);
    const cacheLookupDurationMs = Date.now() - t_cache;

    if (cached) {
      return serveCached(cached, cacheLookupDurationMs);
    }

    const t_subq = Date.now();
    const expansion = await generateSubQueries(maskedQuestion);
    const subQueries = expansion.queries;
    const subQueryDurationMs = Date.now() - t_subq;

    // Canonical-English cache key. Expansion returns the translated (or
    // original) English form first, so queries[0] is the canonical English
    // question — the stable cross-language cache key. Checking the cache
    // under it (and writing under it below) lets a German ask and its English
    // equivalent share ONE cached answer instead of two full pipeline runs.
    // Tier-1 exact hash covers identical re-asks in either language; the
    // BGE-M3 vector tier bridges close paraphrases. Skipped when expansion
    // fell back to the original query alone, or the cache is bypassed.
    const englishCanonical = subQueries[0] ?? maskedQuestion;
    let englishCached: CachedResponse | null = null;
    let englishQueryVector: number[] | null = null;
    let englishCacheLookupDurationMs = 0;
    if (!bypassCache && englishCanonical !== maskedQuestion) {
      const t_engCache = Date.now();
      englishQueryVector = await hybridRetriever.embedQuery(englishCanonical);
      englishCached = await cache.checkCache(englishCanonical, englishQueryVector);
      englishCacheLookupDurationMs = Date.now() - t_engCache;
    }
    if (englishCached) {
      // The user's query language is known here (expansion produced it), so
      // a cross-language hit can be flagged for the client.
      return serveCached(
        englishCached,
        cacheLookupDurationMs + englishCacheLookupDurationMs,
        expansion.language,
      );
    }

    const retrieval = await hybridRetriever.retrieve(
      // Rerank with the CANONICAL ENGLISH query (queries[0]), not the raw
      // (possibly German) user query: the cross-encoder is English-only, so
      // German-query-vs-English-chunk pairs produced noise (Working Holiday
      // chunks outranking Berlin registration content on CRAG-13). Search
      // itself still runs on every expanded English query.
      subQueries[0] ?? maskedQuestion,
      subQueries,
      subQueryDurationMs,
      // Multi-entity/synthesis questions widen retrieval so the 5-chunk
      // rerank limit can't truncate recall across 4-6 entities.
      { wide: expansion.needsDeepRerank === true },
    );
    const retrievalTelemetry: RetrievalTelemetry = retrieval.telemetry;

    const t_gate = Date.now();
    const gate = await runCragGate(retrieval, maskedQuestion);
    const gateDurationMs = Date.now() - t_gate;

    const filteredChunks = gate.chunks.filter(
      (chunk) => (chunk.crossScore ?? chunk.similarityScore ?? 0) >= 0.2,
    );

    let answerText: string;
    let isGrounded: boolean;
    let pathUsed: string;

    const t_gen = Date.now();
    if (filteredChunks.length === 0 || gate.needsWebFallback) {
      answerText =
        "I do not have sufficient official information in my knowledge base to answer this question reliably.";
      isGrounded = false;
      pathUsed = "CRAG_FALLBACK_UNGROUNDED";
    } else {
      const memoryContext = await memory.getContextFormatted();
      const contextText = formatChunksForPrompt(filteredChunks);
      const userPrompt =
        `${memoryContext}\n\n` +
        `OFFICIAL CONTEXT CHUNKS:\n${contextText}\n\n` +
        `USER QUESTION:\n${question}\n\n` +
        `Generate a structured, professional markdown response with subheadings, bullet points, and an 'Actionable Next Steps' section.`;

      const messages: LlmMessage[] = [
        // The detected language makes "answer in the user's language"
        // deterministic even though the retrieval context is English.
        { role: "system", content: buildStandardSystemPrompt(expansion.language) },
        { role: "user", content: userPrompt },
      ];
      try {
        answerText = await callLLM(messages, {
          maxTokens: LLM_MAX_TOKENS_ANSWER,
          temperature: LLM_TEMPERATURE_MEDIUM,
        });
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
    const generationDurationMs = Date.now() - t_gen;

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
    const t_cacheWrite = Date.now();
    let cacheWritten = false;
    if (!bypassCache && isGrounded) {
      await cache.addToCache(
        maskedQuestion,
        queryVector,
        { answer: answerText, sources },
        parentDocIds,
        expansion.language,
      );
      // Also cache under the canonical English form so future German and
      // English re-asks of the same question converge on this answer. Skipped
      // for English-only asks (language === "en"): the canonical English form
      // IS the query itself, so writing a second key would duplicate the row
      // for a reworded/truncated canonical with zero convergence benefit.
      if (
        englishQueryVector &&
        englishCanonical !== maskedQuestion &&
        expansion.language !== "en"
      ) {
        await cache.addToCache(
          englishCanonical,
          englishQueryVector,
          { answer: answerText, sources },
          parentDocIds,
          expansion.language,
        );
      }
      cacheWritten = true;
    }
    const cacheWriteDurationMs = Date.now() - t_cacheWrite;

    const t_mem = Date.now();
    await memory.addTurn(question, answerText);
    const memoryWriteDurationMs = Date.now() - t_mem;

    const latencyMs = Date.now() - startTime;
    const result: StandardRagResult = {
      question,
      answer: answerText,
      sources,
      retrievalPath: pathUsed,
      latencyMs,
      isGrounded,
      isCached: false,
      language: expansion.language,
    };
    if (collectTrace) {
      const stage1DurationMs =
        subQueryDurationMs +
        (retrievalTelemetry.denseDurationMs +
          retrievalTelemetry.sparseBm25DurationMs +
          retrievalTelemetry.rrfFusionDurationMs +
          retrievalTelemetry.rerankDurationMs);
      result.trace = {
        pipeline: "standard",
        userQuery: question,
        maskedQuery: maskedQuestion,
        guardrail: { passed: true },
        finalAnswer: answerText,
        sources,
        retrievalPath: pathUsed,
        isGrounded,
        isCached: false,
        language: expansion.language,
        retrievalTelemetry,
        totalLatencyMs: latencyMs,
        stages: buildCragStages(
          [
            piiMaskingDurationMs + cacheLookupDurationMs,
            stage1DurationMs,
            gateDurationMs,
            generationDurationMs,
            cacheWriteDurationMs + memoryWriteDurationMs,
          ],
          4,
          false,
        ),
        llmCalls: collector.calls,
        totalCostUsd: collector.totalCostUsd,
        preProcessing: { piiMaskingDurationMs, cacheLookupDurationMs, cacheHit: false },
        postProcessing: { cacheWriteDurationMs, memoryWriteDurationMs, cacheWritten },
      };
    }
    return result;
  };

  if (options.collectTrace) {
    return withLlmUsageCollector(collector, core);
  }
  return core();
}
