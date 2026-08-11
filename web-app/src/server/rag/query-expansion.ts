import { callLLMJson } from "@/server/llm/json";
import { createLogger } from "@/server/lib/logger";
import {
  MAX_SUBQUERY_CHARS,
  QUERY_EXPANSION_MAX_TOKENS,
  QUERY_EXPANSION_TEMPERATURE,
} from "@/config/app";

const logger = createLogger("query-expansion");

/**
 * Result of the English-first query expansion (Stage 1).
 *
 * The corpus is stored entirely in English (the ingest pipeline normalizes
 * every document through detect → translate), so retrieval must happen in
 * English. One LLM call detects the user's query language, translates it to
 * English when needed, and generates English paraphrases — the returned
 * `queries` array is therefore always English.
 *
 * `queries[0]` is the CANONICAL English form: the exact translation of the
 * user's query (or the query itself when already English). It is the stable
 * semantic-cache key — a German ask and its English equivalent converge on
 * the same key, so one pipeline run serves re-asks in any language.
 */
export interface QueryExpansion {
  /** ISO 639-1 code of the user's query language (detected by the LLM). */
  language: string;
  /**
   * English-only search queries: `[canonical-english, paraphrase-1, …]`,
   * deduplicated, trimmed, length-capped, up to `numQueries` total.
   */
  queries: string[];
  /**
   * True when the query names multiple distinct entities (universities,
   * providers, institutions, legal texts) or requires synthesis across
   * several documents. The retriever widens its top-K + parent window for
   * these so the 5-chunk rerank limit cannot truncate recall. Absent/undefined
   * means a single-fact lookup → default narrow retrieval.

   */
  needsDeepRerank?: boolean;
}

/** Keeps an LLM-supplied language code safe for prompt/metadata use. */
function sanitizeLanguage(raw: unknown): string {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z-]/g, "")
    .slice(0, 8);
  return /^[a-z]{2,3}(-[a-z]{2,3})?$/.test(value) ? value : "en";
}

/**
 * Accepts only a strict boolean true for `needsDeepRerank`. The LLM may
 * return the string "true", a bare `true`, or omit it — anything else
 * (false, 0, garbage) degrades to the default narrow retrieval.
 */
function sanitizeDeepRerank(raw: unknown): boolean | undefined {
  return raw === true || raw === "true" ? true : undefined;
}

/**
 * Deterministic backstop for `needsDeepRerank`. The LLM flag is reliable most
 * of the time but is nondeterministic — CRAG-16 ("Which government bodies…")
 * never flagged and CRAG-29 flipped across calls, leaving multi-entity
 * (case-insensitive), length-capped. Order is preserved — index 0 is the
 * canonical English form the prompt demanded.
 */
function sanitizeQueries(raw: unknown, numQueries: number): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const trimmed = String(item ?? "").trim();
    if (trimmed.length === 0) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed.slice(0, MAX_SUBQUERY_CHARS));
  }
  return out.slice(0, numQueries);
}

/**
 * English-only multilingual query expansion (Stage 1).
 *
 * The LLM (single Groq call, same key/rate-limiter path as every other LLM
 * call) performs three steps in one prompt:
 *   1. Detect the language of the user's query (ISO 639-1).
 *   2. Translate the query to English if it is not already English — this
 *      English form is the canonical search query AND the semantic-cache key.
 *   3. Generate `numQueries - 1` English paraphrases of that canonical query.
 *
 * Returns `{ language, queries }`. Degrades to `{ language: "en", queries:
 * [query] }` when the LLM response is unusable so retrieval still runs on the
 * original text (BGE-M3's multilingual embeddings keep dense retrieval
 * viable even for a non-English query).
 */
export async function generateSubQueries(
  query: string,
  numQueries: number = 3,
): Promise<QueryExpansion> {
  const perLanguage = Math.max(0, numQueries - 1);
  const prompt =
    `You are a multilingual search-query assistant for a German university-admissions and visa ` +
    `knowledge base. The knowledge base is stored ENTIRELY in English.\n` +
    `Given the user's query, do three things in one step:\n` +
    `1. Detect the language of the query and report its ISO 639-1 code (e.g. "en", "de", "hi", "tr").\n` +
    `2. Translate the query to English if it is not already English. This English translation is ` +
    `the CANONICAL search query (use the query itself if it is already English).\n` +
    `3. Generate exactly ${perLanguage} English paraphrase${perLanguage === 1 ? "" : "s"} of that ` +
    `canonical query (varied wording, same meaning).\n` +
    `4. Set "needsDeepRerank" to true ONLY when the query names MULTIPLE distinct ` +
    `entities (universities, providers, institutions, legal texts) or requires synthesizing ` +
    `facts across several different documents; otherwise false.\n` +
    `User query: '${query}'\n` +
    `Return ONLY JSON with the exact shape: ` +
    `{"language": "<iso-639-1-code>", "queries": ["<canonical-english>", "<paraphrase-1>", ...], ` +
    `"needsDeepRerank": <true|false>}. ` +
    `The FIRST element of "queries" MUST be the canonical English query. ALL queries MUST be English.`;

  const parsed = await callLLMJson<{
    language?: unknown;
    queries?: unknown;
    needsDeepRerank?: unknown;
  }>(prompt, QUERY_EXPANSION_MAX_TOKENS, QUERY_EXPANSION_TEMPERATURE);
  const language = sanitizeLanguage(parsed?.language);
  const queries = sanitizeQueries(parsed?.queries, numQueries);
  const needsDeepRerank = sanitizeDeepRerank(parsed?.needsDeepRerank);
  if (queries.length === 0) {
    logger.warn("[EXPANSION] failed to parse; falling back to original query");
    return { language: "en", queries: [query] };
  }
  return { language, queries, needsDeepRerank };
}
