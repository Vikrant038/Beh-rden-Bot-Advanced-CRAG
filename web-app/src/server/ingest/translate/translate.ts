/**
 * Translation orchestration for the ingest pipeline.
 * Translates non-English documents to English using Groq with rate limiting,
 * checkpoint caching, and multi-model fallback.
 */

import { createHash } from "node:crypto";
import { createLogger } from "@/server/lib/logger";
import type { TranslationRateLimiter } from "./rate-limit";
import { GroqRateLimiterPool } from "./rate-limit";
import { cacheLookup, cacheStore, getOrCreateInflight } from "./cache";
import { isHardModelError, isTpdExhaustion } from "./errors";
import { detectLanguageLlm, estimateTokens } from "./detect";

const logger = createLogger("translate");

/**
 * Minimum output-token budget for a translated segment. Small inputs get a
 * tiny 2×-estimate cap (e.g. 37 tokens → 86) which gpt-oss-120b truncates to
 * an empty response (finish=length). This floor keeps short segments viable.
 */
const MIN_TRANSLATION_OUTPUT_TOKENS = 200;

const TRANSLATION_SYSTEM_PROMPT =
  "You are a professional translator specializing in German administrative, legal, and immigration documents. " +
  "Translate the following German text to English. " +
  "Keep technical terms (e.g. Aufenthaltserlaubnis, Sperrkonto, Anmeldung) accurate and include the original term in parentheses on first use. " +
  "Preserve all formatting, numbers, amounts, dates, URLs, and email addresses exactly as written. " +
  "Do not add any commentary, explanation, or notes — output only the translation.";

/**
 * Result of a translation operation.
 */
export interface TranslationResult {
  /** ISO 639-1 code of the original text's language (LLM-detected). */
  language: string;
  /** The English-normalized text. */
  englishText: string;
  /** Whether translation was actually performed (vs. already English). */
  translated: boolean;
  /** Total tokens used for translation (0 if already English). */
  tokensUsed: number;
}

/**
 * Translates a text to English if it's not already English. Rate-limited to
 * Groq free tier. Uses checkpoint cache to resume interrupted translations.
 *
 * @param text - The text to translate
 * @param rateLimiter - Rate limiter instance (single or pool)
 * @param detect - Language detection function (default: LLM-based)
 * @returns TranslationResult with the (possibly translated) text and metadata
 */
export async function translateToEnglish(
  text: string,
  rateLimiter: TranslationRateLimiter,
  detect: (text: string, limiter: TranslationRateLimiter) => Promise<string> = detectLanguageLlm,
): Promise<TranslationResult> {
  // LLM-based detection is the decision-maker; the regex is only the fallback
  // inside detectLanguageLlm when the call fails. One cheap call per document.
  const language = await detect(text, rateLimiter);

  if (language === "en") {
    return { language, englishText: text, translated: false, tokensUsed: 0 };
  }

  // Split the text into segments of ~3,000 tokens each for translation.
  // Each segment is translated independently and cached.
  const segments = splitIntoChunks(text, 9000); // ~9,000 chars ≈ 3,000 tokens
  const translatedSegments: string[] = [];
  let totalTokens = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const hash = createHash("sha256").update(segment).digest("hex");

    // Check cache first
    const cached = cacheLookup(hash);
    if (cached) {
      logger.info({ hash, language }, "[TRANSLATE] cache hit");
      translatedSegments.push(cached);
      continue;
    }

    // Translation with retry logic. Wrapped in getOrCreateInflight so that
    // with parallel workers (or the pool's multi-model fallbacks) two workers
    // translating the same segment concurrently deduplicate the LLM call.
    const translation = await getOrCreateInflight(hash, async () => {
      const maxAttempts =
        rateLimiter instanceof GroqRateLimiterPool ? rateLimiter.modelsList.length : 1;
      // Reserve input + output together so the TPD guard accounts the full
      // request. A translation's output is roughly source-sized, but give
      // short segments a floor — gpt-oss-120b returns empty (finish=length)
      // when max_tokens is too tight for a low-input segment.
      const inputTokens = estimateTokens(segment);
      const outputTokens = Math.max(inputTokens, MIN_TRANSLATION_OUTPUT_TOKENS);
      const requestTokens = inputTokens + outputTokens;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const limiter = await rateLimiter.waitForTokens(requestTokens);
        try {
          const response = await limiter.client.chat.completions.create({
            model: limiter.model,
            messages: [
              { role: "system", content: TRANSLATION_SYSTEM_PROMPT },
              { role: "user", content: segment },
            ],
            // One input-length cap is plenty for a translation (output ≈ source
            // length). Keeps Groq's reservation accounting (input + max_tokens)
            // under the pool's estimate so the TPD guard doesn't leak.
            max_tokens: outputTokens,
            temperature: 0.1,
          });

          const translated = response.choices[0]?.message?.content?.trim() ?? "";
          if (!translated) {
            throw new Error("Empty translation response");
          }

          cacheStore(hash, translated, limiter.model, language);
          totalTokens += requestTokens;
          logger.info(
            "[TRANSLATE] segment %d/%d done (%d tokens used)",
            i + 1,
            segments.length,
            requestTokens,
          );
          return translated;
        } catch (error) {
          if (isHardModelError(error) && rateLimiter instanceof GroqRateLimiterPool) {
            logger.warn(
              { model: limiter.model, error: String(error) },
              "[TRANSLATE] hard model error — blacklisting and retrying next model",
            );
            rateLimiter.blacklistModel(limiter.model);
            continue;
          }
          if (isTpdExhaustion(error) && rateLimiter instanceof GroqRateLimiterPool) {
            // The API says this model's daily budget is gone — the in-process
            // estimate missed it (it resets per run). Mark it spent and retry
            // the segment on the next model instead of falling back to German.
            rateLimiter.exhaustModelToday(limiter.model);
            continue;
          }
          // Transient (per-minute throttle, 5xx, network) — surface so the
          // caller can fall back to original text.
          throw error;
        }
      }
      throw new Error("All translation models failed for this segment");
    });

    try {
      const translated = await translation;
      translatedSegments.push(translated);
    } catch (error) {
      // Re-throwing lets the pipeline resume from the last checkpoint on the
      // next run; the warn here records which segment failed.
      logger.warn(
        { error: String(error), segment: i + 1 },
        "[TRANSLATE] segment failed — will retry on next run",
      );
      throw error;
    }
  }

  return {
    language,
    englishText: translatedSegments.join("\n\n"),
    translated: true,
    tokensUsed: totalTokens,
  };
}

/**
 * Splits text into chunks of roughly `maxChars` characters, breaking at
 * sentence boundaries (newlines, periods, question marks).
 */
export function splitIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    // Find the best break point: newline, period, question mark
    let breakPoint = maxChars;
    const slice = remaining.slice(0, maxChars);

    // Prefer breaking at newline
    const newlineIdx = slice.lastIndexOf("\n");
    if (newlineIdx > maxChars * 0.3) {
      breakPoint = newlineIdx + 1;
    } else {
      // Then at sentence end
      const periodIdx = slice.lastIndexOf(". ");
      const questionIdx = slice.lastIndexOf("? ");
      const exclaimIdx = slice.lastIndexOf("! ");
      const sentenceIdx = Math.max(periodIdx, questionIdx, exclaimIdx);
      if (sentenceIdx > maxChars * 0.3) {
        breakPoint = sentenceIdx + 2; // Include the space
      }
    }

    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint);
  }

  return chunks;
}
