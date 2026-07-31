import { search, SafeSearchType } from "duck-duck-scrape";
import type { WebSearchResult } from "@/server/rag/types";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("web-search");

const FALLBACK_RESULTS: WebSearchResult[] = [
  {
    title: "DAAD Official Portal",
    url: "https://www.daad.de/en/study-and-research-in-germany/",
    snippet: "Official German academic exchange service guidelines for student visa & admissions.",
  },
];

/**
 * Live web search fallback via DuckDuckGo scrape (`duck-duck-scrape`).
 * Ported from `src/agentic_rag.py:tool_web_search`; returns sanitized results
 * and falls back to a DAAD portal entry when search fails.
 */
export async function webSearch(query: string, maxResults: number = 3): Promise<WebSearchResult[]> {
  if (maxResults < 1 || maxResults > 10) {
    maxResults = 3;
  }

  try {
    const results = await search(query, {
      safeSearch: SafeSearchType.STRICT,
    });

    const webResults = results.results.slice(0, maxResults).map((item) => ({
      title: item.title || "Web Result",
      url: item.url || "#",
      snippet: item.description || item.rawDescription || "",
    }));

    if (webResults.length === 0) {
      logger.warn("[WEB] Search returned no results; using fallback");
      return FALLBACK_RESULTS;
    }
    return webResults;
  } catch (error) {
    logger.warn({ error: String(error) }, "[WEB] DuckDuckGo search failed; using fallback");
    return FALLBACK_RESULTS;
  }
}

/**
 * Synthesizes a flat context block from web results for the LLM prompt.
 */
export function formatWebResultsForPrompt(results: WebSearchResult[]): string {
  if (results.length === 0) {
    return "";
  }
  return results
    .map((result) => `[WEB]: ${result.title}\n${result.snippet}\n(${result.url})`)
    .join("\n\n");
}
