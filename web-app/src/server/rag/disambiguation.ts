import { callLLMJson } from "@/server/llm/json";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("disambiguation");

export interface DisambiguationResult {
  isAmbiguous: boolean;
  options: string[];
}

const VAGUE_MAX_WORDS = 3;

const VAGUE_PRONOUNS = new Set([
  "it",
  "that",
  "this",
  "there",
  "they",
  "them",
  "he",
  "she",
  "i",
  "my",
  "me",
  "we",
  "you",
  "when",
  "what",
  "how",
  "which",
  "then",
]);

/**
 * Stage 0B: vague-query detection + clarifying options.
 * A query is ambiguous when it is very short (≤3 words) or is dominated by
 * pronouns/deictic terms with no concrete entity. On ambiguity we generate
 * exactly 3 clarifying options via the LLM.
 */
export async function disambiguateQuery(query: string): Promise<DisambiguationResult> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { isAmbiguous: true, options: [] };
  }

  const words = trimmed.split(/\s+/);
  const isShort = words.length <= VAGUE_MAX_WORDS;
  const pronounCount = words.filter((word) => VAGUE_PRONOUNS.has(word.toLowerCase())).length;
  const hasConcreteEntity = /[a-z]{4,}/i.test(trimmed);

  if (!isShort && !(pronounCount >= 2 && !hasConcreteEntity)) {
    return { isAmbiguous: false, options: [] };
  }

  const prompt =
    `A user asked a vague question about German immigration, student visas, or university applications.\n` +
    `Original query: "${trimmed}"\n\n` +
    `Generate exactly 3 specific clarifying questions that would resolve the ambiguity. ` +
    `Focus on the most likely interpretations for a German immigration/education assistant.\n` +
    `Return ONLY a JSON array of 3 strings, e.g. ["question 1", "question 2", "question 3"].`;

  const options = await callLLMJson<string[]>(prompt, 200, 0.2);

  if (!Array.isArray(options) || options.length === 0) {
    logger.warn("[DISAMBIG] LLM option generation failed; returning empty options");
    return { isAmbiguous: true, options: [] };
  }

  return { isAmbiguous: true, options: options.slice(0, 3).map(String) };
}
