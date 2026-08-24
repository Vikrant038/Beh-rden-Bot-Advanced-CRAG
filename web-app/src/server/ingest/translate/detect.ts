/**
 * Language detection for the ingest pipeline.
 * PRIMARY: LLM-based (detectLanguageLlm) — one small Groq call per document.
 * The regex below survives only as an EMERGENCY FALLBACK when the LLM call
 * fails (and for the corpus-estimate script's sampling), because the regex
 * misses German without umlauts ("Wie kann ich mich anmelden?") and treats
 * every non-German language as "en" — meaning Hindi/Turkish docs would never
 * be translated.
 */

import { createLogger } from "@/server/lib/logger";
import type { TranslationRateLimiter } from "./rate-limit";

const logger = createLogger("translate");

/** Regex for German-specific characters (not shared with other languages). */
const GERMAN_CHARS = /[äöüßÄÖÜ]/;

/** German stopwords that signal a text is likely German. */
const GERMAN_STOPWORDS =
  /\b(der|die|das|und|oder|aber|für|auf|bei|mit|von|aus|nach|zum|zur|des|dem|den|ein|eine|einen|einer|eines|ist|sind|wird|werden|hat|haben|nicht|als|auch|im|am|um|durch|über|unter|vor|zwischen|bitte|danke|sehr|ihre|ihr|ihren|mein|diese|dieser|dieses|diesem|diesen|dies|dem|den|der|die|das)\b/i;

export type DetectedLanguage = "de" | "en" | "other";

/**
 * Detects the language of a text string. Returns "de" for German, "en" for
 * English, "other" for anything else. Fast, no LLM — uses character + stopword
 * patterns.
 */
export function detectLanguage(text: string): DetectedLanguage {
  const sample = text.slice(0, 2000).trim();
  if (!sample) return "en";

  // German characters present → likely German.
  if (GERMAN_CHARS.test(sample)) {
    // Check for German stopwords to confirm (avoid false positives on short
    // text with ä/ö/ü from other languages).
    const germanWordMatches = (sample.match(GERMAN_STOPWORDS) ?? []).length;
    if (germanWordMatches >= 2 || sample.length <= 100) {
      return "de";
    }
  }

  // If no German chars, strongly English. "other" detected → treat as English
  // (the translation prompt will handle it; any non-English gets translated).
  return "en";
}

const LANGUAGE_DETECT_SYSTEM_PROMPT =
  "You are a language detector for a German administrative-document corpus. " +
  "Detect the language of the user's text. If it is English, reply with en. " +
  'Reply ONLY with a JSON object: {"language": "<ISO 639-1 code>"}.';

/** Normalizes an LLM-supplied language code for safe downstream use. */
function sanitizeLanguageCode(raw: unknown): string {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z-]/g, "")
    .slice(0, 8);
  return /^[a-z]{2,3}(-[a-z]{2,3})?$/.test(value) ? value : "en";
}

/**
 * Detects a text's language via the LLM (Groq, through the same rate limiter
 * as translation). Returns an ISO 639-1 code ("en" for English). This is the
 * ingest pipeline's decision-maker: it catches German without umlauts and
 * correctly flags OTHER languages (hi, tr, …) as non-English so they get
 * translated too — both things the regex heuristic got wrong.
 *
 * One small call on the first ~2,000 chars per document. On ANY failure it
 * falls back to the regex heuristic (de → "de", else "en") so a detection
 * hiccup never blocks a document from being processed.
 */
export async function detectLanguageLlm(
  text: string,
  rateLimiter: TranslationRateLimiter,
): Promise<string> {
  const sample = text.slice(0, 2000).trim();
  if (!sample) {
    return "en";
  }
  const limiter = await rateLimiter.waitForTokens(estimateTokens(sample));
  try {
    const completion = await limiter.client.chat.completions.create({
      model: limiter.model,
      messages: [
        { role: "system", content: LANGUAGE_DETECT_SYSTEM_PROMPT },
        { role: "user", content: sample },
      ],
      temperature: 0,
      max_tokens: 10,
      response_format: { type: "json_object" },
    });
    let content = completion.choices[0]?.message?.content ?? "{}";
    // The model occasionally wraps the JSON in markdown fences — strip them so
    // the parse succeeds instead of falling back to the regex heuristic.
    if (content.startsWith("```")) {
      const trimmed = content.trim();
      const firstLine = trimmed.indexOf("\n");
      const lastFence = trimmed.lastIndexOf("```");
      if (firstLine !== -1 && lastFence > firstLine) {
        content = trimmed.slice(firstLine + 1, lastFence).trim();
      }
    }
    const parsed = JSON.parse(content);
    return sanitizeLanguageCode(parsed.language);
  } catch (error) {
    logger.warn(
      { error: String(error) },
      "[TRANSLATE] LLM language detect failed; falling back to regex",
    );
    return detectLanguage(text);
  }
}

/** Estimate token count from character count (rough but conservative). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}
