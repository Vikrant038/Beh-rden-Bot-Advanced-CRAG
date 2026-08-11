import type { HybridRetriever } from "@/server/rag/retrieval/hybrid";
import { agentResearchReact, type ResearchStep } from "@/server/rag/agents/research";
import { generateSubQueries, type QueryExpansion } from "@/server/rag/query-expansion";
import {
  agentAnalystEvaluation,
  agentWriterSynthesis,
  type AnalystMatrix,
} from "@/server/rag/agents/analyst";
import type { SemanticCache, CachedResponse } from "@/server/rag/cache/semantic-cache";
import type {
  Source,
  RetrievalTelemetry,
  ToolCallTelemetry,
  PipelineEvent,
  PreProcessingTelemetry,
  PostProcessingTelemetry,
  AgentCostTelemetry,
} from "@/server/rag/types";
import { maskPii } from "@/server/pii/masker";
import { isQueryOutOfDomain, OUT_OF_DOMAIN_MESSAGE } from "@/server/rag/guardrail";
import { createLogger } from "@/server/lib/logger";
import {
  LlmUsageCollector,
  withLlmUsageCollector,
  aggregateAgentCosts,
  type LlmCallRecord,
} from "@/server/llm/usage";

const logger = createLogger("agentic-rag");

/** Structural memory contract (satisfied by SummaryBufferMemory and test doubles). */
export interface MemoryLike {
  ensureLoaded(): Promise<void>;
  addTurn(userQuery: string, assistantResponse: string): Promise<void>;
  getContextFormatted(): Promise<string>;
  clear(): Promise<void>;
}

export interface AgenticRagOptions {
  hybridRetriever: HybridRetriever;
  cache: SemanticCache;
  memory: MemoryLike;
  bypassCache?: boolean;
  disambiguation?: { durationMs: number; isAmbiguous: boolean; options: string[] };
  /**
   * Pre-masked query. When the caller already ran Stage 0 (chat stream, admin
   * pipeline tester), pass the masked text here so PII masking never runs
   * twice for the same query.
   */
  maskedQuery?: string;
  onEvent?: (event: PipelineEvent) => void;
}

/** Per-stage timing recorded for the pipeline tracer. */
export interface PipelineStage {
  /** Stage index 0-3. */
  index: number;
  /** Short display name. */
  name: string;
  durationMs: number;
  /** "executed" | "skipped" — short-circuit paths mark later stages skipped. */
  status: "executed" | "skipped";
}

export interface AgenticRagResponse {
  userQuery: string;
  maskedQuery: string;
  guardrail: { passed: boolean; reason?: string; durationMs?: number };
  finalAnswer: string;
  /** ISO 639-1 language of the user's query, detected during expansion. */
  language?: string;
  /**
   * True when a cache hit served an answer written in a different language
   * than the current user's query (known only on the canonical-English path,
   * where expansion ran to produce the cache key).
   */
  languageMismatch?: boolean;
  researchSteps: ResearchStep[];
  analysisMatrix: AnalystMatrix;
  sources: Source[];
  disambiguation?: { durationMs: number; isAmbiguous: boolean; options: string[] };
  retrievalTelemetry?: RetrievalTelemetry;
  toolCalls: ToolCallTelemetry[];
  totalLatencyMs: number;
  /** Per-stage timings — unique durations, not the total repeated. */
  stages: PipelineStage[];
  /** One record per LLM call with its own latency + token usage + cost. */
  llmCalls: LlmCallRecord[];
  /** Sum of estimated LLM call costs (USD). */
  totalCostUsd: number;
  /** Per-agent aggregated token + cost usage (research / analyst / writer). */
  agentCosts?: AgentCostTelemetry[];
  /** PII masking + semantic cache lookup times (before Stage 0). */
  preProcessing?: PreProcessingTelemetry;
  /** Cache write + memory write times (after Stage 3). */
  postProcessing?: PostProcessingTelemetry;
}

/** Small helper so `maskedQuery` / `guardrail` populate identically everywhere. */
function withStageZero(
  response: Omit<AgenticRagResponse, "maskedQuery" | "guardrail">,
  maskedQuery: string,
  guardrail: AgenticRagResponse["guardrail"],
): AgenticRagResponse {
  return { ...response, maskedQuery, guardrail };
}

/**
 * Builds the 4-stage timing array. Short-circuit paths (cache hit / blocked)
 * mark downstream stages as skipped with 0ms so the trace stays honest.
 */
function buildStages(
  durations: [number, number, number, number],
  executedThrough: 0 | 1 | 2 | 3,
): PipelineStage[] {
  const names = [
    "Query disambiguation & guardrail",
    "Research agent (ReAct)",
    "Analyst (comparison matrix)",
    "Writer (markdown synthesis)",
  ];
  return names.map((name, index) => ({
    index,
    name,
    durationMs: index <= executedThrough ? durations[index] : 0,
    status: index <= executedThrough ? "executed" : "skipped",
  }));
}

/**
 * 3-Agent ReAct orchestrator (ported from `src/agentic_rag.py:run_agentic_rag_pipeline`):
 * PII mask → cache check → Stage-0A guardrail → Research → Analyst → Writer.
 * Each stage is timed individually and every LLM call records its own latency,
 * token usage, and estimated cost into the returned trace.
 */
export async function runAgenticRag(
  userQuery: string,
  options: AgenticRagOptions,
): Promise<AgenticRagResponse> {
  const collector = new LlmUsageCollector();
  return withLlmUsageCollector(collector, async () => {
    const startTime = Date.now();
    const {
      hybridRetriever,
      cache,
      memory,
      bypassCache = false,
      disambiguation,
      onEvent,
    } = options;

    // Stage -1 — PII masking. Callers that already ran Stage 0 (chat stream,
    // admin tester) hand the masked query in via `options.maskedQuery`; the
    // mask cost is then attributed to their stage, not counted here.
    const t_piiStart = Date.now();
    const maskedQuery = options.maskedQuery ?? maskPii(userQuery).text;
    const piiMaskingDurationMs = options.maskedQuery !== undefined ? 0 : Date.now() - t_piiStart;

    // Stage 0 — Query disambiguation & guardrail (includes the guardrail LLM call).
    const stage0Start = Date.now();
    collector.setStage("Stage 0 — Query disambiguation & guardrail");
    let cached: CachedResponse | null = null;
    let queryVector: number[] | null = null;
    let cacheLookupDurationMs = 0;
    // The query vector is only needed for the semantic-cache lookup/write, so
    // skip the embed entirely when the cache is bypassed (the admin pipeline
    // tester defaults to bypassCache=true). Each embed is a round-trip to the
    // embedding endpoint — on a cold Cloudflare Worker that's a 10-20s model
    // load, so skipping it removes a full cold start from every glass-box run.
    if (!bypassCache) {
      const t_cacheStart = Date.now();
      queryVector = await hybridRetriever.embedQuery(maskedQuery);
      cached = await cache.checkCache(maskedQuery, queryVector);
      cacheLookupDurationMs = Date.now() - t_cacheStart;
    }

    // English-first expansion — the SAME shared module the standard CRAG path
    // uses, so both pipelines can never drift apart. On a cache miss the LLM
    // detects the query's language, translates it to English when needed, and
    // emits English paraphrases. queries[0] is the canonical English form,
    // which doubles as the cross-language cache key checked below (a German
    // ask and its English equivalent share one cached answer).
    let expansion: QueryExpansion | null = null;
    if (!cached) {
      expansion = await generateSubQueries(maskedQuery);
    }
    let englishCached: CachedResponse | null = null;
    let englishQueryVector: number[] | null = null;
    let englishCacheLookupDurationMs = 0;
    const englishCanonical = expansion?.queries[0] ?? maskedQuery;
    if (!bypassCache && englishCanonical !== maskedQuery) {
      const t_engCache = Date.now();
      englishQueryVector = await hybridRetriever.embedQuery(englishCanonical);
      englishCached = await cache.checkCache(englishCanonical, englishQueryVector);
      englishCacheLookupDurationMs = Date.now() - t_engCache;
    }

    const preProcessing: PreProcessingTelemetry = {
      piiMaskingDurationMs,
      cacheLookupDurationMs: cacheLookupDurationMs + englishCacheLookupDurationMs,
      cacheHit: Boolean(cached) || Boolean(englishCached),
    };

    // Shared cache-hit return — used by both the original-key and the
    // canonical-English hits: persists the turn to memory and shapes the
    // traced response.
    const serveCached = async (entry: CachedResponse): Promise<AgenticRagResponse> => {
      await memory.addTurn(userQuery, entry.answer);
      // Answers are always English (shared writer contract), so no
      // cross-language mismatch flag is surfaced — a cached answer language
      // other than "en" predates the English-only change.
      return withStageZero(
        {
          userQuery,
          finalAnswer: entry.answer,
          language: "en",
          languageMismatch: undefined,
          researchSteps: [
            {
              iteration: 0,
              thought: "Check cache.",
              action: "Semantic Cache Hit",
              observation: "Found matching response in cache.",
              durationMs: cacheLookupDurationMs + englishCacheLookupDurationMs,
            },
          ],
          analysisMatrix: {
            summary: "Served from cache.",
            structured_table: "",
            key_insights: [],
            verified_facts: [],
          },
          sources: entry.sources,
          disambiguation,
          retrievalTelemetry: undefined,
          toolCalls: [],
          totalLatencyMs: Date.now() - startTime,
          stages: buildStages([Date.now() - stage0Start, 0, 0, 0], 0),
          llmCalls: collector.calls,
          totalCostUsd: collector.totalCostUsd,
          agentCosts: aggregateAgentCosts(collector.calls),
          preProcessing,
        },
        maskedQuery,
        { passed: true, reason: "In-domain", durationMs: Date.now() - stage0Start },
      );
    };

    if (cached) {
      return serveCached(cached);
    }
    if (englishCached) {
      logger.info("[AGENT ORCHESTRATOR] Canonical-English cache hit for a non-English query");
      return serveCached(englishCached);
    }

    const t0_guardrail = Date.now();
    onEvent?.({
      type: "stage_start",
      stage: "guardrail",
      label: "Domain Guardrail",
      timestamp: t0_guardrail,
    });
    const blocked = await isQueryOutOfDomain(maskedQuery);
    const stage0Duration = Date.now() - t0_guardrail;
    onEvent?.({
      type: "stage_end",
      stage: "guardrail",
      label: "Domain Guardrail",
      timestamp: Date.now(),
      durationMs: stage0Duration,
    });

    if (blocked) {
      logger.info("[AGENT ORCHESTRATOR] Out-of-domain query rejected early");
      return withStageZero(
        {
          userQuery,
          finalAnswer: OUT_OF_DOMAIN_MESSAGE,
          language: expansion?.language ?? undefined,
          researchSteps: [
            {
              iteration: 1,
              thought: "Check domain validity of the query.",
              action: "Stage 0A Guardrail",
              observation: "Query rejected as Out of Domain.",
              durationMs: stage0Duration,
            },
          ],
          analysisMatrix: {
            summary: "Out of domain.",
            structured_table: "",
            key_insights: [],
            verified_facts: [],
          },
          sources: [],
          disambiguation,
          retrievalTelemetry: undefined,
          toolCalls: [],
          totalLatencyMs: Date.now() - startTime,
          stages: buildStages([Date.now() - stage0Start, 0, 0, 0], 0),
          llmCalls: collector.calls,
          totalCostUsd: collector.totalCostUsd,
          agentCosts: aggregateAgentCosts(collector.calls),
          preProcessing,
        },
        maskedQuery,
        { passed: false, reason: "Out of domain", durationMs: stage0Duration },
      );
    }

    const memoryContext = await memory.getContextFormatted();

    // Stage 1 — Research agent (ReAct).
    const stage1Start = Date.now();
    onEvent?.({ type: "agent_start", agent: "research", timestamp: stage1Start });
    collector.setStage("Stage 1 — Research agent (ReAct)");
    const research = await agentResearchReact(
      maskedQuery,
      hybridRetriever,
      memoryContext,
      onEvent,
      expansion ?? undefined,
    );

    // Emit telemetry events
    if (research.retrievalTelemetry) {
      onEvent?.({
        type: "retrieval_telemetry",
        telemetry: research.retrievalTelemetry,
        timestamp: Date.now(),
      });
    }
    for (const call of research.toolCalls) {
      onEvent?.({ type: "tool_call", telemetry: call, timestamp: Date.now() });
    }

    const stage1Duration = Date.now() - stage1Start;
    onEvent?.({
      type: "agent_end",
      agent: "research",
      timestamp: Date.now(),
      durationMs: stage1Duration,
    });

    // Stage 2 — Analyst (comparison matrix).
    const stage2Start = Date.now();
    onEvent?.({ type: "agent_start", agent: "analyst", timestamp: stage2Start });
    collector.setStage("Stage 2 — Analyst (comparison matrix)");
    const analysis = await agentAnalystEvaluation(maskedQuery, research);
    const stage2Duration = Date.now() - stage2Start;
    onEvent?.({
      type: "agent_end",
      agent: "analyst",
      timestamp: Date.now(),
      durationMs: stage2Duration,
    });

    // Stage 3 — Writer (markdown synthesis).
    const stage3Start = Date.now();
    onEvent?.({ type: "agent_start", agent: "writer", timestamp: stage3Start });
    collector.setStage("Stage 3 — Writer (markdown synthesis)");
    // Stream writer deltas only when someone is listening (chat SSE). The
    // glass-box tester passes no `onEvent`, so it keeps the buffered call.
    const finalAnswer = await agentWriterSynthesis(
      maskedQuery,
      research,
      analysis,
      onEvent
        ? (delta) => onEvent({ type: "token", content: delta, timestamp: Date.now() })
        : undefined,
    );
    const stage3Duration = Date.now() - stage3Start;
    onEvent?.({
      type: "agent_end",
      agent: "writer",
      timestamp: Date.now(),
      durationMs: stage3Duration,
    });

    let cacheWriteDurationMs = 0;
    let cacheWritten = false;
    if (!bypassCache && queryVector) {
      const t_cacheWriteStart = Date.now();
      const parentDocIds = Array.from(
        new Set(
          research.sources
            .map((source) => source.documentId)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      // Answers are always written in English (enforced by the shared writer
      // prompt), so the cache records "en" as the answer language regardless
      // of the query language. The canonical-English dual-write still lets
      // German and English re-asks of the same question converge on one answer.
      const ANSWER_LANGUAGE = "en";
      await cache.addToCache(
        maskedQuery,
        queryVector,
        { answer: finalAnswer, sources: research.sources },
        parentDocIds,
        ANSWER_LANGUAGE,
      );
      // Also cache under the canonical English form so future German and
      // English re-asks of the same question converge on this answer. Skipped
      // for English-only asks (language === "en"): the canonical English form
      // IS the query itself, so writing a second key would duplicate the row
      // for a reworded/truncated canonical with zero convergence benefit.
      if (englishQueryVector && englishCanonical !== maskedQuery && expansion?.language !== "en") {
        await cache.addToCache(
          englishCanonical,
          englishQueryVector,
          { answer: finalAnswer, sources: research.sources },
          parentDocIds,
          ANSWER_LANGUAGE,
        );
      }
      cacheWriteDurationMs = Date.now() - t_cacheWriteStart;
      cacheWritten = true;
    }
    const t_memoryStart = Date.now();
    await memory.addTurn(userQuery, finalAnswer);
    const memoryWriteDurationMs = Date.now() - t_memoryStart;

    const postProcessing: PostProcessingTelemetry = {
      cacheWriteDurationMs,
      memoryWriteDurationMs,
      cacheWritten,
    };

    return withStageZero(
      {
        userQuery,
        finalAnswer,
        language: "en", // answers are always English
        researchSteps: research.researchSteps,
        analysisMatrix: analysis,
        sources: research.sources,
        disambiguation,
        retrievalTelemetry: research.retrievalTelemetry,
        toolCalls: research.toolCalls,
        totalLatencyMs: Date.now() - startTime,
        stages: buildStages(
          [Date.now() - stage0Start, stage1Duration, stage2Duration, stage3Duration],
          3,
        ),
        llmCalls: collector.calls,
        totalCostUsd: collector.totalCostUsd,
        agentCosts: aggregateAgentCosts(collector.calls),
        preProcessing,
        postProcessing,
      },
      maskedQuery,
      { passed: true, reason: "In-domain", durationMs: stage0Duration },
    );
  });
}
