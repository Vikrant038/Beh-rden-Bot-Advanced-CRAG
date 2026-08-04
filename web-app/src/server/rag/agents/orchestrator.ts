import type { HybridRetriever } from "@/server/rag/retrieval/hybrid";
import { agentResearchReact, type ResearchStep } from "@/server/rag/agents/research";
import {
  agentAnalystEvaluation,
  agentWriterSynthesis,
  type AnalystMatrix,
} from "@/server/rag/agents/analyst";
import type { SemanticCache, CachedResponse } from "@/server/rag/cache/semantic-cache";
import type { Source } from "@/server/rag/types";
import { maskPii } from "@/server/pii/masker";
import { isQueryOutOfDomain } from "@/server/rag/guardrail";
import { createLogger } from "@/server/lib/logger";
import { LlmUsageCollector, withLlmUsageCollector, type LlmCallRecord } from "@/server/llm/usage";

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
  guardrail: { passed: boolean; reason?: string };
  finalAnswer: string;
  researchSteps: ResearchStep[];
  analysisMatrix: AnalystMatrix;
  sources: Source[];
  totalLatencyMs: number;
  /** Per-stage timings — unique durations, not the total repeated. */
  stages: PipelineStage[];
  /** One record per LLM call with its own latency + token usage + cost. */
  llmCalls: LlmCallRecord[];
  /** Sum of estimated LLM call costs (USD). */
  totalCostUsd: number;
}

const OUT_OF_DOMAIN_MESSAGE =
  "**Out of Domain Detected:** I am a specialized assistant for German immigration, " +
  "student visas, and university admissions. I cannot help with general queries such as " +
  "programming, sports, or other out-of-scope topics.";

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
    const { hybridRetriever, cache, memory, bypassCache = false } = options;

    const { text: maskedQuery } = maskPii(userQuery);
    const queryVector = await hybridRetriever.embedQuery(maskedQuery);

    // Stage 0 — Query disambiguation & guardrail (includes the guardrail LLM call).
    const stage0Start = Date.now();
    collector.setStage("Stage 0 — Query disambiguation & guardrail");
    let cached: CachedResponse | null = null;
    if (!bypassCache) {
      cached = await cache.checkCache(maskedQuery, queryVector);
    }
    if (cached) {
      await memory.addTurn(userQuery, cached.answer);
      return withStageZero(
        {
          userQuery,
          finalAnswer: cached.answer,
          researchSteps: [
            {
              iteration: 0,
              thought: "Check cache.",
              action: "Semantic Cache Hit",
              observation: "Found matching response in cache.",
            },
          ],
          analysisMatrix: {
            summary: "Served from cache.",
            structured_table: "",
            key_insights: [],
            verified_facts: [],
          },
          sources: cached.sources,
          totalLatencyMs: Date.now() - startTime,
          stages: buildStages([Date.now() - stage0Start, 0, 0, 0], 0),
          llmCalls: collector.calls,
          totalCostUsd: collector.totalCostUsd,
        },
        maskedQuery,
        { passed: true, reason: "In-domain" },
      );
    }

    const blocked = await isQueryOutOfDomain(maskedQuery);
    if (blocked) {
      logger.info("[AGENT ORCHESTRATOR] Out-of-domain query rejected early");
      return withStageZero(
        {
          userQuery,
          finalAnswer: OUT_OF_DOMAIN_MESSAGE,
          researchSteps: [
            {
              iteration: 1,
              thought: "Check domain validity of the query.",
              action: "Stage 0A Guardrail",
              observation: "Query rejected as Out of Domain.",
            },
          ],
          analysisMatrix: {
            summary: "Out of domain.",
            structured_table: "",
            key_insights: [],
            verified_facts: [],
          },
          sources: [],
          totalLatencyMs: Date.now() - startTime,
          stages: buildStages([Date.now() - stage0Start, 0, 0, 0], 0),
          llmCalls: collector.calls,
          totalCostUsd: collector.totalCostUsd,
        },
        maskedQuery,
        { passed: false, reason: "Out of domain" },
      );
    }
    const stage0Duration = Date.now() - stage0Start;

    const memoryContext = await memory.getContextFormatted();

    // Stage 1 — Research agent (ReAct).
    const stage1Start = Date.now();
    collector.setStage("Stage 1 — Research agent (ReAct)");
    const research = await agentResearchReact(maskedQuery, hybridRetriever, memoryContext);
    const stage1Duration = Date.now() - stage1Start;

    // Stage 2 — Analyst (comparison matrix).
    const stage2Start = Date.now();
    collector.setStage("Stage 2 — Analyst (comparison matrix)");
    const analysis = await agentAnalystEvaluation(maskedQuery, research);
    const stage2Duration = Date.now() - stage2Start;

    // Stage 3 — Writer (markdown synthesis).
    const stage3Start = Date.now();
    collector.setStage("Stage 3 — Writer (markdown synthesis)");
    const finalAnswer = await agentWriterSynthesis(maskedQuery, research, analysis);
    const stage3Duration = Date.now() - stage3Start;

    if (!bypassCache) {
      const parentDocIds = Array.from(
        new Set(
          research.sources
            .map((source) => source.documentId)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      await cache.addToCache(
        maskedQuery,
        queryVector,
        { answer: finalAnswer, sources: research.sources },
        parentDocIds,
      );
    }
    await memory.addTurn(userQuery, finalAnswer);

    return withStageZero(
      {
        userQuery,
        finalAnswer,
        researchSteps: research.researchSteps,
        analysisMatrix: analysis,
        sources: research.sources,
        totalLatencyMs: Date.now() - startTime,
        stages: buildStages([stage0Duration, stage1Duration, stage2Duration, stage3Duration], 3),
        llmCalls: collector.calls,
        totalCostUsd: collector.totalCostUsd,
      },
      maskedQuery,
      { passed: true, reason: "In-domain" },
    );
  });
}
