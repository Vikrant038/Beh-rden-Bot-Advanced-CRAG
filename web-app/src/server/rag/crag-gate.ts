import type { RetrievedContext, WebSearchResult } from "@/server/rag/types";
import { CRAG_THRESHOLD } from "@/server/rag/types";
import {
  webSearch,
  formatWebResultsForPrompt,
  formatChunksForPrompt,
} from "@/server/rag/tools/web-search";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("crag-gate");

export interface CragResult {
  chunks: RetrievedContext["chunks"];
  contextText: string;
  needsWebFallback: boolean;
  pathUsed: string;
  webResults: WebSearchResult[];
}

/**
 * CRAG confidence gate. If the top cross-encoder score is below threshold,
 * triggers a live web search fallback and builds a synthesized context block.
 * Ported from `src/rag.py` + `src/advanced_retrieval.py`.
 */
export async function runCragGate(
  retrieval: Pick<RetrievedContext, "chunks" | "bestCrossScore" | "needsWebFallback" | "pathUsed">,
  query: string,
): Promise<CragResult> {
  const needsWebFallback = retrieval.bestCrossScore < CRAG_THRESHOLD || retrieval.needsWebFallback;

  if (needsWebFallback) {
    logger.info("[CRAG] Gate FAIL — triggering live web search fallback");
    const webResults = await webSearch(query, 3);
    const webContext = formatWebResultsForPrompt(webResults);
    return {
      chunks: retrieval.chunks,
      contextText: webContext,
      needsWebFallback: true,
      pathUsed: "CRAG_CONFIDENCE_GATE_WEB_FALLBACK",
      webResults,
    };
  }

  const contextText = formatChunksForPrompt(retrieval.chunks);

  return {
    chunks: retrieval.chunks,
    contextText,
    needsWebFallback: false,
    pathUsed: retrieval.pathUsed,
    webResults: [],
  };
}
