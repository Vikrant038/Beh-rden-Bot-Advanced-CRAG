import type { HybridRetriever } from "@/server/rag/retrieval/hybrid";
import { agentResearchReact, type ResearchStep } from "@/server/rag/agents/research";
import {
  agentAnalystEvaluation,
  agentWriterSynthesis,
  type AnalystMatrix,
} from "@/server/rag/agents/analyst";
import type { SemanticCache } from "@/server/rag/cache/semantic-cache";
import type { SummaryBufferMemory } from "@/server/rag/memory/summary-buffer";
import type { Source } from "@/server/rag/types";
import { maskPii } from "@/server/pii/masker";
import { isQueryOutOfDomain } from "@/server/rag/guardrail";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("agentic-rag");

export interface AgenticRagOptions {
  hybridRetriever: HybridRetriever;
  cache: SemanticCache;
  memory: SummaryBufferMemory;
  bypassCache?: boolean;
}

export interface AgenticRagResponse {
  userQuery: string;
  finalAnswer: string;
  researchSteps: ResearchStep[];
  analysisMatrix: AnalystMatrix;
  sources: Source[];
  totalLatencyMs: number;
}

const OUT_OF_DOMAIN_MESSAGE =
  "**Out of Domain Detected:** I am a specialized assistant for German immigration, " +
  "student visas, and university admissions. I cannot help with general queries such as " +
  "programming, sports, or other out-of-scope topics.";

/**
 * 3-Agent ReAct orchestrator (ported from `src/agentic_rag.py:run_agentic_rag_pipeline`):
 * PII mask → cache check → Stage-0A guardrail → Research → Analyst → Writer.
 */
export async function runAgenticRag(
  userQuery: string,
  options: AgenticRagOptions,
): Promise<AgenticRagResponse> {
  const startTime = Date.now();
  const { hybridRetriever, cache, memory, bypassCache = false } = options;

  const { text: maskedQuery } = maskPii(userQuery);
  const queryVector = await hybridRetriever.embedQuery(maskedQuery);

  const cached = await cache.checkCache(maskedQuery, queryVector);
  if (cached) {
    await memory.addTurn(userQuery, cached.answer);
    return {
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
    };
  }

  if (await isQueryOutOfDomain(maskedQuery)) {
    logger.info("[AGENT ORCHESTRATOR] Out-of-domain query rejected early");
    return {
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
    };
  }

  const memoryContext = await memory.getContextFormatted();
  const research = await agentResearchReact(maskedQuery, hybridRetriever, memoryContext);
  const analysis = await agentAnalystEvaluation(maskedQuery, research);
  const finalAnswer = await agentWriterSynthesis(maskedQuery, research, analysis);

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

  return {
    userQuery,
    finalAnswer,
    researchSteps: research.researchSteps,
    analysisMatrix: analysis,
    sources: research.sources,
    totalLatencyMs: Date.now() - startTime,
  };
}
