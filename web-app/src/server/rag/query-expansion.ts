import { callLLMJson } from "@/server/llm/json";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("query-expansion");

const MAX_SUBQUERY_CHARS = 500;

/**
 * Multi-query expansion (Stage 1): LLM generates alternative search queries.
 * Ported from `src/advanced_retrieval.py:generate_sub_queries`. Returns the
 * original query alone when expansion fails.
 */
export async function generateSubQueries(query: string, numQueries: number = 3): Promise<string[]> {
  const prompt =
    `You are an AI research assistant for German university admissions and student visas.\n` +
    `Generate ${numQueries - 1} alternative search queries in English for: '${query}'.\n` +
    `Return ONLY a JSON list of strings, e.g. ["query 1", "query 2"].`;

  const parsed = await callLLMJson<string[]>(prompt, 150, 0.2);
  if (Array.isArray(parsed)) {
    const alternatives = parsed
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0 && item !== query)
      .map((item) => item.slice(0, MAX_SUBQUERY_CHARS));
    return [query, ...alternatives].slice(0, numQueries);
  }

  logger.warn("[EXPANSION] failed to parse; falling back to original query");
  return [query];
}
