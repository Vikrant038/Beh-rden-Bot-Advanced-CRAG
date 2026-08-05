import type { Source } from "@/server/rag/types";
import type { HybridRetriever } from "@/server/rag/retrieval/hybrid";
import { generateSubQueries } from "@/server/rag/query-expansion";
import { webSearch } from "@/server/rag/tools/web-search";
import { calculateVisaRequirements } from "@/server/rag/tools/visa-calculator";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("research-agent");

export interface ResearchStep {
  iteration: number;
  thought: string;
  action: string;
  observation: string;
}

export interface ResearchResult {
  userQuery: string;
  researchSteps: ResearchStep[];
  combinedContext: string;
  sources: Source[];
}

const COST_TRIGGERS = ["cost", "fee", "money", "calculate", "inr", "euro", "blocked account"];
const COMPARE_TRIGGERS = ["vs", "compare", "difference"];

/**
 * Agent 1: Research Agent (ReAct loop).
 * Ported from `src/agentic_rag.py:agent_research_react`. Iteration 1 runs
 * hybrid retrieval; comparative queries trigger a secondary retrieval pass;
 * financial queries invoke the deterministic visa calculator.
 */
export async function agentResearchReact(
  userQuery: string,
  hybridRetriever: HybridRetriever,
  sessionMemory: string = "",
): Promise<ResearchResult> {
  logger.info("[AGENT 1] Research agent starting ReAct loop");
  const researchSteps: ResearchStep[] = [];
  const accumulatedContext: string[] = [];
  const sources: Source[] = [];

  if (sessionMemory) {
    accumulatedContext.push(`[CONVERSATION HISTORY]:\n${sessionMemory}`);
  }

  const lower = userQuery.toLowerCase();

  // ReAct iteration 1: retrieve from the knowledge base. Bilingual sub-query
  // expansion (EN + DE) so BM25 matches both halves of the corpus.
  const searchQueries = await generateSubQueries(userQuery, 5);
  const retrieval = await hybridRetriever.retrieve(userQuery, searchQueries);
  const chunks = retrieval.chunks;

  if (chunks.length > 0) {
    researchSteps.push({
      iteration: 1,
      thought: "Primary query received. Searching vector index for official documentation.",
      action: "tool_vector_search",
      observation: `Retrieved ${chunks.length} relevant chunks from local database.`,
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
    });
    const webResults = await webSearch(userQuery, 3);
    for (const result of webResults) {
      accumulatedContext.push(`[WEB]: ${result.title}\n${result.snippet}`);
      sources.push({ name: result.title, url: result.url, score: 0.7 });
    }
  }

  // ReAct iteration 2: comparative queries expand retrieval.
  if (COMPARE_TRIGGERS.some((trigger) => lower.includes(trigger))) {
    const subQuery = `${userQuery} requirements breakdown`;
    const secondary = await hybridRetriever.retrieve(subQuery, [subQuery]);
    researchSteps.push({
      iteration: 2,
      thought: "Comparative query detected. Expanding retrieval for secondary dimension.",
      action: "tool_vector_search(sub_query)",
      observation: `Retrieved ${secondary.chunks.length} secondary chunks.`,
    });
    for (const chunk of secondary.chunks) {
      accumulatedContext.push(chunk.text);
    }
  }

  // ReAct iteration 3: financial queries run the visa calculator.
  if (COST_TRIGGERS.some((trigger) => lower.includes(trigger))) {
    const calculation = calculateVisaRequirements();
    researchSteps.push({
      iteration: researchSteps.length + 1,
      thought: "Query involves financial fees. Executing deterministic visa calculator tool.",
      action: "tool_visa_calculator",
      observation: calculation.summary,
    });
    accumulatedContext.unshift(`[CRITICAL CALCULATED FINANCIAL SUMMARY]: ${calculation.summary}`);
  }

  return {
    userQuery,
    researchSteps,
    combinedContext: accumulatedContext.join("\n\n"),
    sources,
  };
}
