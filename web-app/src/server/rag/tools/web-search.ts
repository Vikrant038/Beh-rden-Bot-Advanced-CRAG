import type { WebSearchResult } from "@/server/rag/types";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("web-search");

// ─── Provider interface ───────────────────────────────────────────────────────

/**
 * Abstraction over web-search backends.
 *
 * Current implementation: DuckDuckGoProvider (duck-duck-scrape, unofficial
 * scraper — may break without notice if DDG changes its HTML).
 *
 * To migrate to a stable API (Brave Search, Tavily, Serper):
 *   1. Implement WebSearchProvider with the new client.
 *   2. Set ACTIVE_PROVIDER to the new instance.
 *   3. Add the API key to .env.example and src/server/env.ts.
 *   No call-site changes needed — webSearch() delegates to ACTIVE_PROVIDER.
 *
 * ⚠️  KNOWN LIMITATION: DuckDuckGoProvider uses duck-duck-scrape, an
 * unofficial scraper. It is NOT suitable for production SLAs. Track the
 * migration to a stable search API in docs/ROADMAP.md.
 */
export interface WebSearchProvider {
  search(query: string, maxResults: number): Promise<WebSearchResult[]>;
  /** Human-readable name used in logs and trace metadata. */
  readonly name: string;
}

// ─── Static fallback ─────────────────────────────────────────────────────────

const FALLBACK_RESULTS: WebSearchResult[] = [
  {
    title: "DAAD Official Portal",
    url: "https://www.daad.de/en/study-and-research-in-germany/",
    snippet: "Official German academic exchange service guidelines for student visa & admissions.",
  },
];

// ─── DuckDuckGo provider (current default) ───────────────────────────────────

/**
 * Web search via the `duck-duck-scrape` library.
 *
 * This provider is the current default because it requires no API key. It is
 * fragile: DDG can change its HTML at any time and break the scraper silently.
 * Use BraveSearchProvider or TavilyProvider in production.
 */
export class DuckDuckGoProvider implements WebSearchProvider {
  readonly name = "DuckDuckGo (duck-duck-scrape)";

  async search(query: string, maxResults: number): Promise<WebSearchResult[]> {
    // Dynamic import keeps duck-duck-scrape out of the critical path when the
    // provider is swapped out, and avoids top-level import failures if the
    // package is removed.
    const { search: ddgSearch, SafeSearchType } = await import("duck-duck-scrape");

    const results = await ddgSearch(query, { safeSearch: SafeSearchType.STRICT });

    return results.results.slice(0, maxResults).map((item) => ({
      title: item.title || "Web Result",
      url: item.url || "#",
      snippet: item.description || item.rawDescription || "",
    }));
  }
}

// ─── Active provider singleton ───────────────────────────────────────────────

/**
 * The active web-search provider.
 * Swap this to BraveSearchProvider / TavilyProvider when ready.
 */
let ACTIVE_PROVIDER: WebSearchProvider = new DuckDuckGoProvider();

/**
 * Replaces the active provider at runtime. Useful for tests (mock provider)
 * and for swapping to a stable API without restarting the process.
 */
export function setWebSearchProvider(provider: WebSearchProvider): void {
  ACTIVE_PROVIDER = provider;
  logger.info(`[WEB] search provider changed to: ${provider.name}`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Executes a web search via the active provider. Falls back to static DAAD
 * portal results when the provider fails, so the pipeline never hard-errors
 * on a search backend outage.
 *
 * Ported from `src/agentic_rag.py:tool_web_search`.
 */
export async function webSearch(query: string, maxResults: number = 3): Promise<WebSearchResult[]> {
  const clampedMax = Math.min(10, Math.max(1, maxResults));

  try {
    const results = await ACTIVE_PROVIDER.search(query, clampedMax);

    if (results.length === 0) {
      logger.warn(
        { provider: ACTIVE_PROVIDER.name },
        "[WEB] search returned no results; using fallback",
      );
      return FALLBACK_RESULTS;
    }

    logger.info(
      { provider: ACTIVE_PROVIDER.name, count: results.length, query: query.slice(0, 60) },
      "[WEB] search completed",
    );
    return results;
  } catch (error) {
    logger.warn(
      { error: String(error), provider: ACTIVE_PROVIDER.name },
      "[WEB] search failed; using fallback",
    );
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
