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
 * caching means interrupted runs resume without re-translating. Multiple API
 * keys (from DIFFERENT Groq organizations — free-tier limits are per-org, so
 * same-account keys share one bucket) can be supplied via `GROQ_API_KEYS`
 * (comma-separated) and are spread across by `GroqRateLimiterPool` for
 * parallel workers.
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
  /**
   * Max tokens per day (0 = unlimited). Groq free-tier models have hard daily
   * token caps (e.g. llama-3.3-70b: 100,000/day, llama-4-scout: 500,000/day);
   * without this the pipeline 429-loops until the model is paused. When set,
   * the limiter waits for the midnight reset once the daily budget is spent.
   */
  tpd?: number;
  /** Groq API key (defaults to env.GROQ_API_KEY). */
  apiKey?: string;
  /** Groq model for translation. */
  model?: string;
}

const DEFAULT_LIMITER: Required<GroqLimiterOptions> = {
  rpm: 30,
  tpm: 6000,
  rpd: 14400,
  tpd: 0,
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
  /** Max tokens per day (0 = unlimited; see GroqLimiterOptions.tpd). */
  readonly tpd: number;
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

  // TPD counter (daily token budget, e.g. 100K for llama-3.3-70b free tier)
  private tokensToday = 0;
  private tpdResetDay = new Date().getDate();

  constructor(options: GroqLimiterOptions = {}) {
    this.rpm = options.rpm ?? DEFAULT_LIMITER.rpm;
    this.tpm = options.tpm ?? DEFAULT_LIMITER.tpm;
    this.rpd = options.rpd ?? DEFAULT_LIMITER.rpd;
    this.tpd = options.tpd ?? DEFAULT_LIMITER.tpd;
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

  /** Number of API keys in this limiter (1 — the pool reports its key count). */
  get size(): number {
    return 1;
  }

  /**
   * Current token-bucket capacity (refilled to TPM). Lets the pool pick the
   * least-loaded key without mutating the bucket.
   */
  get availableTokens(): number {
    this.refillBucket();
    return this.tokens;
  }

  /**
   * Block until the token bucket has enough capacity for `tokens`, the RPM
   * pacing interval has elapsed, and (when configured) the daily token budget
   * (TPD) still has room. Returns this limiter so the pool and single-key
   * callers share one interface.
   */
  async waitForTokens(tokens: number): Promise<GroqRateLimiter> {
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

    // TPD guard: wait for the midnight reset when the daily token budget is
    // exhausted (avoids 429-looping against models with a hard daily cap).
    if (this.tpd > 0) {
      if (today !== this.tpdResetDay) {
        this.tokensToday = 0;
        this.tpdResetDay = today;
      }
      if (this.tokensToday + tokens > this.tpd) {
        const resetTime = new Date();
        resetTime.setDate(resetTime.getDate() + 1);
        resetTime.setHours(0, 0, 0, 0);
        const wait = resetTime.getTime() - Date.now();
        if (wait > 0) {
          logger.warn(
            { waitMs: Math.ceil(wait), tpd: this.tpd, used: this.tokensToday },
            "[TRANSLATE] TPD limit reached — waiting for daily reset",
          );
          await sleep(wait);
        }
        this.tokensToday = 0;
      }
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
    if (this.tpd > 0) {
      this.tokensToday += tokens;
    }
    return this;
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

/**
 * Multi-key rate limiter: spreads translation requests across several Groq
 * API keys so each key's free-tier bucket is consumed independently.
 *
 * ⚠️ Only helps when the keys belong to DIFFERENT Groq organizations. Groq's
 * free-tier limits (30 RPM / 6,000 TPM / 14,400 RPD) are per organization, so
 * multiple keys on one account share a single bucket and gain nothing.
 */
export class GroqRateLimiterPool {
  readonly limiters: GroqRateLimiter[];

  constructor(keys: string[], options: { model?: string; tpd?: number } = {}) {
    const resolved = keys.map((k) => k.trim()).filter((k) => k.length > 0);
    if (resolved.length === 0) {
      throw new Error("GroqRateLimiterPool requires at least one API key");
    }
    this.limiters = resolved.map((apiKey) => new GroqRateLimiter({ apiKey, ...options }));
  }

  /** Number of API keys in the pool. */
  get size(): number {
    return this.limiters.length;
  }

  /** Model used by every key (they all translate with the same model). */
  get model(): string {
    return this.limiters[0]?.model ?? "";
  }

  /** Per-key requests/minute (all keys share the same config). */
  get rpm(): number {
    return this.limiters[0]?.rpm ?? 0;
  }

  /** Per-key tokens/minute (all keys share the same config). */
  get tpm(): number {
    return this.limiters[0]?.tpm ?? 0;
  }

  /** Per-key requests/day (all keys share the same config). */
  get rpd(): number {
    return this.limiters[0]?.rpd ?? 0;
  }

  /** Per-key tokens/day (0 = unlimited; all keys share the same config). */
  get tpd(): number {
    return this.limiters[0]?.tpd ?? 0;
  }

  /**
   * Reserves `tokens` on the least-loaded key (most available bucket tokens)
   * and returns that key's limiter. Blocks until one key has capacity, so
   * parallel workers never 429 the account.
   */
  async waitForTokens(tokens: number): Promise<GroqRateLimiter> {
    const chosen = this.pickBest();
    await chosen.waitForTokens(tokens);
    return chosen;
  }

  /** Picks the key with the most available tokens (ties → first). */
  private pickBest(): GroqRateLimiter {
    let best = this.limiters[0]!;
    let bestTokens = -1;
    for (const limiter of this.limiters) {
      const available = limiter.availableTokens;
      if (available > bestTokens) {
        best = limiter;
        bestTokens = available;
      }
    }
    return best;
  }
}

/** A single-key limiter or a multi-key pool — both expose `waitForTokens()`. */
export type TranslationRateLimiter = GroqRateLimiter | GroqRateLimiterPool;

/**
 * Builds the translation rate limiter: a multi-key pool when several keys are
 * configured, otherwise a single limiter. Keys come from `GROQ_API_KEYS`
 * (comma-separated, from DIFFERENT Groq accounts — see GroqRateLimiterPool)
 * with `GROQ_API_KEY` as the fallback. The translation model comes from
 * `GROQ_TRANSLATE_MODEL` (default llama-3.3-70b-versatile) and its daily
 * token cap from `GROQ_TPD` (0 = unknown/unlimited).
 */
export function createTranslationRateLimiter(
  options: { keys?: string[]; model?: string; tpd?: number } = {},
): TranslationRateLimiter {
  const explicit = options.keys && options.keys.length > 0;
  const raw = explicit ? (options.keys as string[]) : (process.env.GROQ_API_KEYS ?? "").split(",");
  const keys = raw.map((k) => k.trim()).filter((k) => k.length > 0);
  const model = options.model ?? (process.env.GROQ_TRANSLATE_MODEL?.trim() || undefined);
  const tpd = options.tpd ?? (process.env.GROQ_TPD ? Number(process.env.GROQ_TPD) : undefined);
  const limiterOptions = { model, tpd };
  if (keys.length === 0) {
    const fallback = process.env.GROQ_API_KEY?.trim();
    if (!fallback) {
      throw new Error(
        "No Groq API key configured — set GROQ_API_KEYS (comma-separated) or GROQ_API_KEY",
      );
    }
    return new GroqRateLimiter({ apiKey: fallback, ...limiterOptions });
  }
  if (keys.length === 1) {
    return new GroqRateLimiter({ apiKey: keys[0], ...limiterOptions });
  }
  return new GroqRateLimiterPool(keys, limiterOptions);
}

// ─── Translation checkpoint cache ───────────────────────────────────────────

/**
 * In-flight translation promises keyed by segment hash. With parallel workers
 * (multi-key pool + concurrency > 1), two workers can pick up the same segment
 * before the checkpoint cache is written — this dedupes those concurrent
 * calls so a segment is never translated twice (and never double-charged).
 */
const inflightSegments = new Map<string, Promise<string>>();

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
 * the Groq free tier. Checkpoint-cached for resumability, and safe under
 * parallel workers (concurrent duplicate segments are deduped in-flight).
 *
 * @param text - The extracted document text (cleaned, not chunked).
 * @param rateLimiter - A GroqRateLimiter or GroqRateLimiterPool.
 * @returns TranslationResult with the English text + metadata.
 */
export async function translateToEnglish(
  text: string,
  rateLimiter: TranslationRateLimiter,
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

    // Parallel-worker dedupe: another worker may already be translating this
    // exact segment. Wait on the shared promise instead of re-translating.
    const inFlight = inflightSegments.get(hash);
    if (inFlight) {
      const translated = await inFlight;
      translatedSegments.push(translated);
      continue;
    }

    const translation = (async (): Promise<string> => {
      const limiter = await rateLimiter.waitForTokens(requestTokens);
      const response = await limiter.client.chat.completions.create({
        model: limiter.model,
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

      cacheStore(hash, translated, limiter.model, language);
      totalTokens += requestTokens;
      logger.info(
        "[TRANSLATE] segment %d/%d done (%d tokens used)",
        i + 1,
        segments.length,
        requestTokens,
      );
      return translated;
    })();

    inflightSegments.set(hash, translation);
    try {
      const translated = await translation;
      translatedSegments.push(translated);
    } catch (error) {
      logger.warn(
        { error: String(error), segment: i + 1 },
        "[TRANSLATE] segment failed — will retry on next run",
      );
      // Return what we have so far so the pipeline can be resumed.
      // If this is the first segment and it fails, translations will be empty
      // and the caller should treat this as a non-fatal error.
      throw error;
    } finally {
      inflightSegments.delete(hash);
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
