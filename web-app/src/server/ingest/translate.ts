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

  /** Model chain in fallback order (a single model for this limiter). */
  get modelsList(): string[] {
    return [this.model];
  }

  /** Total daily token budget across the chain (this limiter's tpd). */
  get totalTpd(): number {
    return this.tpd;
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
   * Synchronously reserves `tokens` when the TPM bucket has capacity and the
   * RPM pacing interval has elapsed. Returns false (reserving nothing) when
   * the bucket is momentarily drained or it is too soon since the last
   * request — the caller can then wait for a refill or move to another
   * (key, model) combination. Used by GroqRateLimiterPool to pick a ready
   * combo without blocking.
   */
  tryReserve(tokens: number): boolean {
    const now = Date.now();
    const today = new Date().getDate();
    if (today !== this.rpdResetDay) {
      this.requestsToday = 0;
      this.rpdResetDay = today;
    }
    if (today !== this.tpdResetDay) {
      this.tokensToday = 0;
      this.tpdResetDay = today;
    }
    this.refillBucket();
    const minInterval = (60 / this.rpm) * 1000;
    if (this.lastRequestTime > 0 && now - this.lastRequestTime < minInterval) {
      return false;
    }
    if (this.tokens < tokens) {
      return false;
    }
    this.tokens -= tokens;
    this.lastRequestTime = now;
    this.requestsToday++;
    if (this.tpd > 0) {
      this.tokensToday += tokens;
    }
    return true;
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

// ─── Model config (limits per Groq free-tier model) ─────────────────────────

/** Per-model free-tier limits (RPM / RPD / TPM / TPD) as shown in the Groq console. */
export interface GroqModelConfig {
  model: string;
  rpm: number;
  rpd: number;
  tpm: number;
  tpd: number;
}

const MODEL_LIMITS: Record<string, Omit<GroqModelConfig, "model">> = {
  "llama-3.1-8b-instant": { rpm: 30, rpd: 14400, tpm: 6000, tpd: 500000 },
  "llama-3.3-70b-versatile": { rpm: 30, rpd: 1000, tpm: 12000, tpd: 100000 },
  "meta-llama/llama-4-scout-17b-16e-instruct": { rpm: 30, rpd: 1000, tpm: 30000, tpd: 500000 },
  "qwen/qwen3-32b": { rpm: 60, rpd: 1000, tpm: 6000, tpd: 500000 },
  "openai/gpt-oss-20b": { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
  "openai/gpt-oss-120b": { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
  "moonshotai/kimi-k2-instruct": { rpm: 60, rpd: 1000, tpm: 10000, tpd: 300000 },
};

/**
 * Default translation chain — quality-first. When a model's daily TPD budget
 * is spent, the pool falls back to the next model, so the combined daily
 * budget (≈2.3M tokens) can finish the whole corpus in about a day.
 */
const DEFAULT_MODEL_CHAIN = [
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "qwen/qwen3-32b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "moonshotai/kimi-k2-instruct",
  "llama-3.1-8b-instant",
];

/** Resolves model ids to full configs; unknown ids get conservative defaults. */
export function resolveModelConfigs(modelIds: string[]): GroqModelConfig[] {
  const ids = modelIds.map((m) => m.trim()).filter(Boolean);
  if (ids.length === 0) {
    return resolveModelConfigs(DEFAULT_MODEL_CHAIN);
  }
  return ids.map((id) => {
    const limits = MODEL_LIMITS[id];
    return limits
      ? { model: id, ...limits }
      : { model: id, rpm: 30, rpd: 1000, tpm: 6000, tpd: 500000 };
  });
}

function msUntilMidnight(): number {
  const now = new Date();
  const reset = new Date(now);
  reset.setDate(now.getDate() + 1);
  reset.setHours(0, 0, 0, 0);
  return Math.max(1_000, reset.getTime() - now.getTime());
}

/**
 * Multi-key × multi-model rate limiter.
 *
 * Maintains a grid of limiters — one per (key, model) pair — each with its
 * own TPM bucket and RPM pacing. The **daily token budget (TPD) is shared per
 * model across all keys**, which matches Groq's reality: free-tier limits are
 * per organization, so several keys on one account share the model's daily
 * bucket. When a model's TPD is exhausted on every key, `waitForTokens` falls
 * back to the next model in the chain; when every model is exhausted it waits
 * for the midnight reset and resumes.
 */
export class GroqRateLimiterPool {
  readonly keys: string[];
  readonly models: GroqModelConfig[];
  /** Grid of limiters: `grid[keyIndex][modelIndex]` (TPD lives in the pool). */
  private readonly grid: GroqRateLimiter[][];
  /** Per-model daily token usage shared across all keys. */
  private readonly tokensToday: number[];
  private readonly tpdResetDays: number[];
  /** Models blacklisted this run after a hard error (404/403/401). */
  private readonly deadModels: Set<string>;

  constructor(keys: string[], models: GroqModelConfig[] = []) {
    const resolvedKeys = keys.map((k) => k.trim()).filter((k) => k.length > 0);
    if (resolvedKeys.length === 0) {
      throw new Error("GroqRateLimiterPool requires at least one API key");
    }
    this.keys = resolvedKeys;
    this.models = models.length > 0 ? models : resolveModelConfigs(DEFAULT_MODEL_CHAIN);
    // tpd=0 on the grid limiters: the pool owns the daily budget (shared per
    // model across keys), so individual limiters never midnight-block.
    this.grid = this.keys.map((apiKey) =>
      this.models.map(
        (m) =>
          new GroqRateLimiter({
            apiKey,
            model: m.model,
            rpm: m.rpm,
            tpm: m.tpm,
            rpd: m.rpd,
            tpd: 0,
          }),
      ),
    );
    this.tokensToday = this.models.map(() => 0);
    this.tpdResetDays = this.models.map(() => new Date().getDate());
    this.deadModels = new Set<string>();
  }

  /** Number of API keys in the pool. */
  get size(): number {
    return this.keys.length;
  }

  /** First (preferred) model id. */
  get model(): string {
    return this.models[0]?.model ?? "";
  }

  /** All model ids in fallback order. */
  get modelsList(): string[] {
    return this.models.map((m) => m.model);
  }

  /** Total daily token budget across the whole chain (per org). */
  get totalTpd(): number {
    return this.models.reduce((sum, m) => sum + m.tpd, 0);
  }

  /** Preferred model's requests/minute. */
  get rpm(): number {
    return this.models[0]?.rpm ?? 0;
  }

  /** Preferred model's tokens/minute. */
  get tpm(): number {
    return this.models[0]?.tpm ?? 0;
  }

  /** Preferred model's requests/day. */
  get rpd(): number {
    return this.models[0]?.rpd ?? 0;
  }

  /** Preferred model's tokens/day. */
  get tpd(): number {
    return this.models[0]?.tpd ?? 0;
  }

  /** One limiter per key for the given model index (used by tests). */
  keyLimiters(modelIndex: number): GroqRateLimiter[] {
    return this.grid.map((row) => row[modelIndex]!);
  }

  /** Model ids still usable this run (not blacklisted after a hard error). */
  get liveModels(): string[] {
    return this.models.map((m) => m.model).filter((id) => !this.deadModels.has(id));
  }

  /**
   * Removes a model from the rotation after a hard, non-transient failure
   * (404 model-not-found / 403 / 401). The caller retries the segment on the
   * next available model instead of wasting every future segment on a dead
   * model — this is what let a single unavailable model stall the whole chain
   * (llama-4-scout 404s while 70b's daily budget is spent → everything falls
   * back to original text and the corpus never migrates).
   */
  blacklistModel(modelId: string): void {
    if (!this.models.some((m) => m.model === modelId)) {
      return;
    }
    this.deadModels.add(modelId);
    logger.warn(
      { model: modelId, remaining: this.liveModels },
      "[TRANSLATE] model blacklisted (unusable on this account) — skipping for this run",
    );
  }

  /**
   * Marks a model's daily budget as fully spent after the API reports a TPD
   * 429. The in-process estimate resets to zero on every run while Groq's
   * counter is server-side and persists, so the estimate can hand out a model
   * that is actually exhausted (exactly what stalled run 3: every segment got
   * a 70b limiter that 429'd and fell back to German). Marking it exhausted
   * makes the next waitForTokens call skip it and advance the chain.
   */
  exhaustModelToday(modelId: string): void {
    const mi = this.models.findIndex((m) => m.model === modelId);
    if (mi === -1) {
      return;
    }
    const tpd = this.models[mi]!.tpd;
    if (tpd > 0) {
      this.tokensToday[mi] = tpd;
      logger.warn({ model: modelId }, "[TRANSLATE] model daily budget marked exhausted (API 429)");
    }
  }

  /**
   * Reserves `tokens` on the best available (key, model): the preferred model
   * that still has daily budget, on its least-loaded key. When a model's TPD
   * is spent on all keys it falls back to the next model; when every model is
   * spent it waits for the midnight reset. Returns the limiter the caller
   * should use for its API call (its `.client` and `.model` are set).
   */
  async waitForTokens(tokens: number): Promise<GroqRateLimiter> {
    for (let mi = 0; mi < this.models.length; mi++) {
      if (this.deadModels.has(this.models[mi]!.model)) {
        continue; // blacklisted (404/403/401) — never usable this run
      }
      if (!this.hasModelBudget(mi, tokens)) {
        logger.warn(
          { model: this.models[mi]!.model, used: this.tokensToday[mi] },
          "[TRANSLATE] model daily budget exhausted on all keys — falling back",
        );
        continue;
      }
      // Least-loaded key first for this model.
      const order = this.keyOrder(mi);
      for (const ki of order) {
        const limiter = this.grid[ki]![mi]!;
        if (limiter.tryReserve(tokens)) {
          this.consumeModelBudget(mi, tokens);
          return limiter;
        }
      }
      // Every key's TPM bucket is momentarily drained but the model still has
      // daily budget — wait for the fastest refill instead of switching models.
      const limiter = this.grid[order[0]!]![mi]!;
      await limiter.waitForTokens(tokens);
      this.consumeModelBudget(mi, tokens);
      return limiter;
    }

    if (this.liveModels.length === 0) {
      throw new Error(
        `All translation models are unavailable on this account: ${this.modelsList.join(", ")}`,
      );
    }
    logger.warn(
      { models: this.liveModels, waitMs: msUntilMidnight() },
      "[TRANSLATE] all model daily budgets exhausted — waiting for midnight reset",
    );
    await sleep(msUntilMidnight());
    return this.waitForTokens(tokens);
  }

  /** True when the model's shared daily budget still fits `tokens`. */
  private hasModelBudget(modelIndex: number, tokens: number): boolean {
    const today = new Date().getDate();
    if (today !== this.tpdResetDays[modelIndex]) {
      this.tokensToday[modelIndex] = 0;
      this.tpdResetDays[modelIndex] = today;
    }
    const tpd = this.models[modelIndex]!.tpd;
    return tpd === 0 || this.tokensToday[modelIndex]! + tokens <= tpd;
  }

  private consumeModelBudget(modelIndex: number, tokens: number): void {
    this.tokensToday[modelIndex] = (this.tokensToday[modelIndex] ?? 0) + tokens;
  }

  /** Key indices for a model, least-loaded (most bucket tokens) first. */
  private keyOrder(modelIndex: number): number[] {
    return this.keys
      .map((_, ki) => ki)
      .sort((a, b) => {
        const availA = this.grid[a]![modelIndex]!.availableTokens;
        const availB = this.grid[b]![modelIndex]!.availableTokens;
        return availB - availA;
      });
  }
}

/** A single-key limiter or a multi-key pool — both expose `waitForTokens()`. */
export type TranslationRateLimiter = GroqRateLimiter | GroqRateLimiterPool;

/**
 * Builds the translation rate limiter.
 *
 * Keys: `GROQ_API_KEYS` (comma-separated, 1–N; 3 keys → a 3-key pool, 2 → 2,
 * 1 → a single limiter) with `GROQ_API_KEY` as the fallback.
 *
 * Models: `GROQ_TRANSLATE_MODELS` (comma-separated chain, quality-first by
 * default) overrides; `GROQ_TRANSLATE_MODEL` selects a single model;
 * `GROQ_TPD` overrides the daily token cap of every model in the chain.
 */
export function createTranslationRateLimiter(
  options: {
    keys?: string[];
    models?: string[];
    model?: string;
    tpd?: number;
  } = {},
): TranslationRateLimiter {
  const explicit = options.keys && options.keys.length > 0;
  const raw = explicit ? (options.keys as string[]) : (process.env.GROQ_API_KEYS ?? "").split(",");
  const keys = raw.map((k) => k.trim()).filter((k) => k.length > 0);

  const envChain = (process.env.GROQ_TRANSLATE_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const envSingle = process.env.GROQ_TRANSLATE_MODEL?.trim();
  // Explicit options win over env; GROQ_TRANSLATE_MODELS (chain) wins over
  // GROQ_TRANSLATE_MODEL (single); the default quality-first chain is last.
  const chainIds =
    options.models && options.models.length > 0
      ? options.models
      : options.model
        ? [options.model]
        : envChain.length > 0
          ? envChain
          : envSingle
            ? [envSingle]
            : [];
  const tpdOverride =
    options.tpd ?? (process.env.GROQ_TPD ? Number(process.env.GROQ_TPD) : undefined);
  let models = resolveModelConfigs(chainIds);
  if (tpdOverride !== undefined) {
    models = models.map((m) => ({ ...m, tpd: tpdOverride }));
  }

  if (keys.length === 0) {
    const fallback = process.env.GROQ_API_KEY?.trim();
    if (!fallback) {
      throw new Error(
        "No Groq API key configured — set GROQ_API_KEYS (comma-separated) or GROQ_API_KEY",
      );
    }
    return new GroqRateLimiter({ apiKey: fallback, ...models[0]! });
  }
  if (keys.length === 1) {
    return new GroqRateLimiter({ apiKey: keys[0]!, ...models[0]! });
  }
  return new GroqRateLimiterPool(keys, models);
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
 * True when an API error means the model will never work on this account
 * (404 model-not-found, 403/401 auth) — as opposed to transient 429/5xx/
 * network errors that a retry on the same model could succeed on.
 */
function isHardModelError(error: unknown): boolean {
  const err = error as { status?: number; message?: string };
  if (typeof err?.status === "number" && [401, 403, 404].includes(err.status)) {
    return true;
  }
  return /does not exist or you do not have access|model.*not (found|available)|no access to it/i.test(
    String(err?.message ?? error),
  );
}

/**
 * True when a 429 means the model's DAILY token budget is spent (vs a
 * per-minute/request throttle that recovers on its own). The pool must treat
 * these as exhaustion: mark the model spent and advance to the next one,
 * rather than falling back to original text for the whole document.
 */
function isTpdExhaustion(error: unknown): boolean {
  return /tokens per day|TPD|daily token limit/i.test(
    String((error as { message?: string })?.message ?? error),
  );
}

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
      // On a hard model error (404/401/403 — model not on the account) the
      // pool blacklists that model and we retry the segment on the next one,
      // so one dead model in the chain no longer stalls the whole migration.
      // Transient errors (429/5xx/network) are surfaced so the doc falls back
      // to original text and the checkpoint cache resumes it next run.
      const maxAttempts =
        rateLimiter instanceof GroqRateLimiterPool ? rateLimiter.modelsList.length : 1;
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
            // under the pool's 2×-input estimate so the TPD guard doesn't leak.
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
