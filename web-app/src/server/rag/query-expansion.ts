import { callLLMJson } from "@/server/llm/json";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("query-expansion");

const MAX_SUBQUERY_CHARS = 500;

/**
 * Multi-query bilingual expansion (Stage 1): LLM generates alternative search
 * queries in BOTH English and German so hybrid retrieval covers the whole
 * corpus. The knowledge base holds ~2/3 English chunks (official legal
 * translations, HRK/uni-assist guides) and ~1/3 German chunks (BAMF brochures,
 * forms). BM25 is lexical, so English-only sub-queries would never match
 * German chunks and vice-versa; emitting both languages guarantees sparse
 * coverage on both sides. The dense (pgvector) path needs no language split —
 * BGE-M3 is multilingual — but benefits from the extra diverse queries.
 *
 * The LLM returns a structured `{"english": [...], "german": [...]}` object so
 * the split is deterministic: exactly `perLanguage` English and `perLanguage`
 * German alternatives (2+2 for the default 5 queries), instead of leaving the
 * mix to prompt compliance.
 *
 * Returns the original query plus (up to numQueries-1) deduplicated,
 * length-capped alternatives. Falls back to the original query alone when
 * expansion fails. Ported from `src/advanced_retrieval.py:generate_sub_queries`.
 */
export async function generateSubQueries(query: string, numQueries: number = 5): Promise<string[]> {
  const perLanguage = Math.floor((numQueries - 1) / 2);
  const prompt =
    `You are an AI research assistant for German university admissions and student visas.\n` +
    `The knowledge base contains official documents in BOTH English and German.\n` +
    `For the query: '${query}'.\n` +
    `Generate exactly ${perLanguage} English search queries and exactly ${perLanguage} German ` +
    `search queries (translations or rephrasings of the query).\n` +
    `Return ONLY a JSON object with the exact shape: ` +
    `{"english": ["..."], "german": ["..."]}.`;

  const parsed = await callLLMJson<{ english?: unknown; german?: unknown }>(prompt, 250, 0.2);
  const english = Array.isArray(parsed?.english) ? parsed.english : [];
  const german = Array.isArray(parsed?.german) ? parsed.german : [];
  if (english.length > 0 || german.length > 0) {
    const seen = new Set<string>([query]);
    const alternatives: string[] = [];
    for (const item of [...english, ...german]) {
      const trimmed = String(item).trim();
      if (trimmed.length === 0 || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      alternatives.push(trimmed.slice(0, MAX_SUBQUERY_CHARS));
    }
    return [query, ...alternatives].slice(0, numQueries);
  }

  logger.warn("[EXPANSION] failed to parse; falling back to original query");
  return [query];
}
