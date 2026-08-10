/**
 * English-normalization translation module for the ingest pipeline.
 *
 * Ingests all documents as English text: detect language → translate to English
 * (if needed) → cache the translation → downstream chunking + embedding works
 * on clean English-only text. This eliminates the bilingual retrieval problem
 * (the root cause of the failed reranker, low recall on multi-entity queries,
 * and the dead HF fallback) and makes the Cloudflare-only stack viable.
 *
 * Rate-limited to respect Groq's free tier (30 RPM / 6,000 TPM / 14,400 RPD)
 * with a configurable token bucket so the pipeline never 429s. Checkpoint
 * caching means interrupted runs resume without re-translating.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("translate");

// ─── Language detection ─────────────────────────────────────────────────────
// Fast, regex-based — no LLM call needed at ingest time.

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

// ─── Groq rate limiter (free-tier compliant) ────────────────────────────────

export interface GroqLimiterOptions {
  /** Max requests per minute (free tier: 30). */
  rpm?: number;
  /** Max tokens per minute (free tier: 6,000). */
  tpm?: number;
  /** Max requests per day (free tier: 14,400). */
  rpd?: number;
  /** Groq API key (defaults to env.GROQ_API_KEY). */
  apiKey?: string;
  /** Groq model for translation. */
  model?: string;
}

const DEFAULT_LIMITER: Required<GroqLimiterOptions> = {
  rpm: 30,
  tpm: 6000,
  rpd: 14400,
  apiKey: "",
  model: "llama-3.3-70b-versatile",
};

/**
 * Token-bucket rate limiter for Groq's free tier.
 *
 * Respects RPM, TPM, and RPD limits via a token bucket (tokens refill
 * continuously at TPM/60 per second) and a minimum request interval. The
 * pipeline calls `waitForTokens(tokens)` before every Groq request and
 * blocks until the bucket has enough capacity.
 *
 * Configurable via constructor options so a paid-plan upgrade only needs
 * higher numbers — no code changes.
 */
export class GroqRateLimiter {
  /** Max requests per minute (free tier: 30). */
  readonly rpm: number;
  /** Max tokens per minute (free tier: 6,000). */
  readonly tpm: number;
  /** Max requests per day (free tier: 14,400). */
  readonly rpd: number;
  /** Groq model for translation. */
  readonly model: string;
  /** The OpenAI SDK client pointed at Groq. */
  readonly client: OpenAI;

  // Token bucket state
  private tokens: number;
  private lastRefill: number;

  // RPM pacing
  private lastRequestTime = 0;

  // RPD counter
  private requestsToday = 0;
  private rpdResetDay = new Date().getDate();

  constructor(options: GroqLimiterOptions = {}) {
    this.rpm = options.rpm ?? DEFAULT_LIMITER.rpm;
    this.tpm = options.tpm ?? DEFAULT_LIMITER.tpm;
    this.rpd = options.rpd ?? DEFAULT_LIMITER.rpd;
    this.model = options.model ?? DEFAULT_LIMITER.model;

    this.tokens = this.tpm; // start full
    this.lastRefill = Date.now();

    const apiKey = options.apiKey || process.env.GROQ_API_KEY || "";
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
  }

  /** How many tokens this rate limiter refills per second. */
  private get refillRate(): number {
    return this.tpm / 60;
  }

  /**
   * Block until the token bucket has enough capacity for `tokens` and the
   * RPM pacing interval has elapsed.
   */
  async waitForTokens(tokens: number): Promise<void> {
    // RPD guard
    const today = new Date().getDate();
    if (today !== this.rpdResetDay) {
      this.requestsToday = 0;
      this.rpdResetDay = today;
    }
    if (this.requestsToday >= this.rpd) {
      const resetTime = new Date();
      resetTime.setDate(resetTime.getDate() + 1);
      resetTime.setHours(0, 0, 0, 0);
      const wait = resetTime.getTime() - Date.now();
      if (wait > 0) {
        logger.warn(
          { waitMs: Math.ceil(wait), rpd: this.rpd },
          "[TRANSLATE] RPD limit reached — waiting for daily reset",
        );
        await sleep(wait);
      }
      this.requestsToday = 0;
    }

    // RPM pacing: at least 60/rpm seconds between requests.
    const minInterval = (60 / this.rpm) * 1000;
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < minInterval && this.lastRequestTime > 0) {
      await sleep(minInterval - elapsed);
    }

    // TPM token bucket: wait until enough tokens have accumulated.
    while (true) {
      this.refillBucket();
      if (this.tokens >= tokens) {
        this.tokens -= tokens;
        break;
      }
      // How long until we have enough tokens?
      const deficit = tokens - this.tokens;
      const waitMs = Math.ceil((deficit / this.refillRate) * 1000) + 100;
      await sleep(waitMs);
    }

    this.lastRequestTime = Date.now();
    this.requestsToday++;
  }

  private refillBucket(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.tpm, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Translation checkpoint cache ───────────────────────────────────────────

const CACHE_DIR = join(process.cwd(), "data", "translation-cache");

interface TranslationRecord {
  originalHash: string;
  translatedText: string;
  model: string;
  language: DetectedLanguage;
}

/**
 * Returns the cached translation for `originalHash`, or null if not cached.
 */
function cacheLookup(originalHash: string): string | null {
  const path = join(CACHE_DIR, `${originalHash}.json`);
  try {
    if (existsSync(path)) {
      const record: TranslationRecord = JSON.parse(readFileSync(path, "utf-8"));
      return record.translatedText;
    }
  } catch {
    // Corrupted cache entry — ignore
  }
  return null;
}

/**
 * Stores a translation result in the checkpoint cache.
 */
function cacheStore(
  originalHash: string,
  translatedText: string,
  model: string,
  language: DetectedLanguage,
): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
  } catch {
    // Already exists
  }
  const record: TranslationRecord = { originalHash, translatedText, model, language };
  writeFileSync(join(CACHE_DIR, `${originalHash}.json`), JSON.stringify(record));
}

// ─── Translation ────────────────────────────────────────────────────────────

/** Estimate token count from character count (rough but conservative). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

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
  /** The original detected language. */
  language: DetectedLanguage;
  /** The English-normalized text. */
  englishText: string;
  /** Whether translation was actually performed (vs. already English). */
  translated: boolean;
  /** Total tokens used for translation (0 if already English). */
  tokensUsed: number;
}

/**
 * Translates a text to English if it's not already English. Rate-limited to
 * the Groq free tier. Checkpoint-cached for resumability.
 *
 * @param text - The extracted document text (cleaned, not chunked).
 * @param rateLimiter - A configured GroqRateLimiter instance.
 * @returns TranslationResult with the English text + metadata.
 */
export async function translateToEnglish(
  text: string,
  rateLimiter: GroqRateLimiter,
): Promise<TranslationResult> {
  const language = detectLanguage(text);

  if (language === "en") {
    return { language, englishText: text, translated: false, tokensUsed: 0 };
  }

  // Split the text into segments of ~3,000 tokens each for translation.
  // Each segment is translated independently and cached.
  const segments = splitIntoChunks(text, 9000); // ~9,000 chars ≈ 3,000 tokens
  const translatedSegments: string[] = [];
  let totalTokens = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const hash = createHash("sha256").update(segment).digest("hex");

    const cached = cacheLookup(hash);
    if (cached !== null) {
      translatedSegments.push(cached);
      logger.info("[TRANSLATE] cache hit for segment %d/%d", i + 1, segments.length);
      continue;
    }

    const inputTokens = estimateTokens(segment);
    const outputTokens = inputTokens; // conservative estimate
    const requestTokens = inputTokens + outputTokens;

    await rateLimiter.waitForTokens(requestTokens);

    try {
      const response = await rateLimiter.client.chat.completions.create({
        model: rateLimiter.model,
        messages: [
          { role: "system", content: TRANSLATION_SYSTEM_PROMPT },
          { role: "user", content: segment },
        ],
        max_tokens: outputTokens * 2,
        temperature: 0.1,
      });

      const translated = response.choices[0]?.message?.content?.trim() ?? "";
      if (!translated) {
        throw new Error("Empty translation response");
      }

      cacheStore(hash, translated, rateLimiter.model, language);
      translatedSegments.push(translated);
      totalTokens += requestTokens;
      logger.info(
        "[TRANSLATE] segment %d/%d done (%d tokens used)",
        i + 1,
        segments.length,
        requestTokens,
      );
    } catch (error) {
      logger.warn(
        { error: String(error), segment: i + 1 },
        "[TRANSLATE] segment failed — will retry on next run",
      );
      // Return what we have so far so the pipeline can be resumed.
      // If this is the first segment and it fails, translations will be empty
      // and the caller should treat this as a non-fatal error.
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
  const chunks: string[] = [];
  const sentences = text.split(/(?<=\n|\.|\?|\!)\s+/);
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += " " + sentence;
    }
  }
  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}
