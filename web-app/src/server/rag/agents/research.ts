import type {
  PipelineEvent,
  RetrievalTelemetry,
  Source,
  ToolCallTelemetry,
} from "@/server/rag/types";
import type { HybridRetriever } from "@/server/rag/retrieval/hybrid";
import { generateSubQueries } from "@/server/rag/query-expansion";
import { webSearch } from "@/server/rag/tools/web-search";
import { calculateVisaRequirements } from "@/server/rag/tools/visa-calculator";
import { RESEARCH_AGENT_INSTRUCTION } from "@/server/rag/prompt";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("research-agent");

export interface ResearchStep {
  iteration: number;
  thought: string;
  action: string;
  observation: string;
  /** Wall-clock ms the tool/action behind this step took to execute. */
  durationMs?: number;
}

export interface ResearchResult {
  userQuery: string;
  researchSteps: ResearchStep[];
  combinedContext: string;
  sources: Source[];
  retrievalTelemetry?: RetrievalTelemetry;
  toolCalls: ToolCallTelemetry[];
}

const COST_TRIGGERS = ["cost", "fee", "money", "calculate", "inr", "euro", "blocked account"];
const COMPARE_TRIGGERS = ["vs", "compare", "difference"];

/**
 * Agent 1: Research Agent (ReAct loop).
 * Ported from `src/agentic_rag.py:agent_research_react`. Iteration 1 runs
 * hybrid retrieval; comparative queries trigger a secondary retrieval pass;
 * financial queries invoke the deterministic visa calculator.
 *
 * The loop is deterministic today (no LLM system prompt) — RESEARCH_AGENT_INSTRUCTION
 * (src/server/rag/prompt.ts) documents the intended framing (gather, don't
 * answer; official sources first; treat retrieved text as untrusted) so any
 * future LLM-based research step slots into the same contract.
 */
export async function agentResearchReact(
  userQuery: string,
  hybridRetriever: HybridRetriever,
  sessionMemory: string = "",
  onEvent?: (event: PipelineEvent) => void,
): Promise<ResearchResult> {
  logger.info("[AGENT 1] Research agent starting ReAct loop");
  // Framing contract documented in src/server/rag/prompt.ts — surfaced in the
  // debug log so the agent's operating rules are auditable per run.
  logger.debug(
    { framing: RESEARCH_AGENT_INSTRUCTION.split("\n")[0] },
    "[AGENT 1] research agent framing",
  );
  const researchSteps: ResearchStep[] = [];
  const accumulatedContext: string[] = [];
  const sources: Source[] = [];
  const toolCalls: ToolCallTelemetry[] = [];

  if (sessionMemory) {
    accumulatedContext.push(`[CONVERSATION HISTORY]:\n${sessionMemory}`);
  }

  const lower = userQuery.toLowerCase();

  // ReAct iteration 1: retrieve from the knowledge base. Bilingual sub-query
  // expansion (EN + DE) so BM25 matches both halves of the corpus. Each phase
  // emits stage_start/stage_end so the chat status bar tracks it live.
  const t0_qe = performance.now();
  onEvent?.({
    type: "stage_start",
    stage: "query_expansion",
    label: "Query Expansion",
    timestamp: Date.now(),
  });
  const searchQueries = await generateSubQueries(userQuery, 5);
  const qeDuration = performance.now() - t0_qe;
  onEvent?.({
    type: "stage_end",
    stage: "query_expansion",
    label: "Query Expansion",
    timestamp: Date.now(),
    durationMs: qeDuration,
    details: { expandedQueries: searchQueries },
  });

  const t0_retrieve = performance.now();
  onEvent?.({
    type: "stage_start",
    stage: "dense_retrieval",
    label: "Hybrid Retrieval (Dense + BM25 + RRF + Rerank)",
    timestamp: Date.now(),
  });
  const retrieval = await hybridRetriever.retrieve(userQuery, searchQueries, qeDuration);
  const retrieveDuration = performance.now() - t0_retrieve;
  const chunks = retrieval.chunks;
  onEvent?.({
    type: "stage_end",
    stage: "dense_retrieval",
    label: "Hybrid Retrieval (Dense + BM25 + RRF + Rerank)",
    timestamp: Date.now(),
    durationMs: retrieveDuration,
    details: {
      denseDurationMs: retrieval.telemetry?.denseDurationMs,
      sparseBm25DurationMs: retrieval.telemetry?.sparseBm25DurationMs,
      rrfFusionDurationMs: retrieval.telemetry?.rrfFusionDurationMs,
      rerankDurationMs: retrieval.telemetry?.rerankDurationMs,
      bestCrossScore: retrieval.telemetry?.bestCrossScore,
      cragFallbackTriggered: retrieval.telemetry?.cragFallbackTriggered,
    },
  });

  toolCalls.push({
    id: `call-hybrid-${Date.now()}`,
    tool: "hybrid_retrieval",
    query: userQuery,
    startTime: t0_retrieve,
    durationMs: retrieveDuration,
    status: "success",
  });

  if (chunks.length > 0) {
    researchSteps.push({
      iteration: 1,
      thought: "Primary query received. Searching vector index for official documentation.",
      action: "tool_vector_search",
      observation: `Retrieved ${chunks.length} relevant chunks from local database.`,
      durationMs: retrieveDuration,
    });
    for (const chunk of chunks) {
      accumulatedContext.push(chunk.text);
      sources.push({
        name: chunk.sourceName,
        url: chunk.sourceUrl,
        score: chunk.crossScore ?? chunk.similarityScore ?? 0.85,
        documentId: chunk.documentId,
        childText: chunk.childText,
        parentText: chunk.text,
      });
    }
  } else {
    researchSteps.push({
      iteration: 1,
      thought: "No local vector chunks passed threshold. Initiating web search fallback.",
      action: "tool_web_search",
      observation: "Executing DDG search.",
      durationMs: retrieveDuration,
    });
    const t0_web = performance.now();
    const webResults = await webSearch(userQuery, 3);
    const webDuration = performance.now() - t0_web;
    toolCalls.push({
      id: `call-web-${Date.now()}`,
      tool: "web_search",
      query: userQuery,
      startTime: t0_web,
      durationMs: webDuration,
      status: "success",
    });
    for (const result of webResults) {
      accumulatedContext.push(`[WEB]: ${result.title}\n${result.snippet}`);
      sources.push({ name: result.title, url: result.url, score: 0.7 });
    }
  }

  // ReAct iteration 2: comparative queries expand retrieval.
  if (COMPARE_TRIGGERS.some((trigger) => lower.includes(trigger))) {
    const subQuery = `${userQuery} requirements breakdown`;
    const t0_sec = performance.now();
    const secondary = await hybridRetriever.retrieve(subQuery, [subQuery]);
    const secDuration = performance.now() - t0_sec;
    toolCalls.push({
      id: `call-hybrid-sec-${Date.now()}`,
      tool: "hybrid_retrieval",
      query: subQuery,
      startTime: t0_sec,
      durationMs: secDuration,
      status: "success",
    });
    researchSteps.push({
      iteration: 2,
      thought: "Comparative query detected. Expanding retrieval for secondary dimension.",
      action: "tool_vector_search(sub_query)",
      observation: `Retrieved ${secondary.chunks.length} secondary chunks.`,
      durationMs: secDuration,
    });
    for (const chunk of secondary.chunks) {
      accumulatedContext.push(chunk.text);
    }
  }

  // ReAct iteration 3: financial queries run the visa calculator.
  if (COST_TRIGGERS.some((trigger) => lower.includes(trigger))) {
    const t0_calc = performance.now();
    const calculation = calculateVisaRequirements();
    const calcDuration = performance.now() - t0_calc;
    toolCalls.push({
      id: `call-visa-${Date.now()}`,
      tool: "visa_calculator",
      startTime: t0_calc,
      durationMs: calcDuration,
      status: "success",
    });
    researchSteps.push({
      iteration: researchSteps.length + 1,
      thought: "Query involves financial fees. Executing deterministic visa calculator tool.",
      action: "tool_visa_calculator",
      observation: calculation.summary,
      durationMs: calcDuration,
    });
    accumulatedContext.unshift(`[CRITICAL CALCULATED FINANCIAL SUMMARY]: ${calculation.summary}`);
  }

  return {
    userQuery,
    researchSteps,
    combinedContext: accumulatedContext.join("\n\n"),
    sources,
    retrievalTelemetry: retrieval.telemetry,
    toolCalls,
  };
}
