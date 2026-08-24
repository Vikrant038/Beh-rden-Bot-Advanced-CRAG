/**
 * Groq rate limiter (free-tier compliant) for the ingest pipeline.
 * Token-bucket rate limiter with multi-key × multi-model pool support.
 */

import OpenAI from "openai";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("translate");

export interface GroqLimiterOptions {
  /** Requests per minute (RPM). Default 1,000 for GPT OSS 120B. */
  rpm?: number;
  /** Requests per day (RPD). Use 0 when no provider cap is published. */
  rpd?: number;
  /** Tokens per minute (TPM). Default 250,000 for GPT OSS 120B. */
  tpm?: number;
  /** Tokens per day (TPD). Use 0 when no provider cap is published. */
  tpd?: number;
  /** Optional API key override (falls back to GROQ_API_KEY). */
  apiKey?: string;
  /** Model id for translation. Default `openai/gpt-oss-120b`. */
  model?: string;
}

const DEFAULT_LIMITER: Required<GroqLimiterOptions> = {
  rpm: 1000,
  rpd: 0,
  tpm: 250_000,
  tpd: 0,
  apiKey: process.env.GROQ_API_KEY ?? "",
  model: "openai/gpt-oss-120b",
};

/**
 * Token-bucket rate limiter for Groq's free tier.
 * Enforces RPM, RPD, TPM, and TPD limits with automatic reset at minute/day boundaries.
 */
export class GroqRateLimiter {
  /** Max requests per minute. */
  readonly rpm: number;
  /** Max tokens per minute. */
  readonly tpm: number;
  /** Max requests per day (0 = unlimited). */
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

  // TPD counter (0 means the provider has not published a daily cap)
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

  /** Marks a model as blacklisted (no-op for single limiter; pool handles it). */
  blacklistModel(_model: string): void {
    void _model;
  }

  /** Marks a model as exhausted for today (no-op for single limiter; pool handles it). */
  exhaustModelToday(_model: string): void {
    void _model;
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
    // rpd === 0 means "unlimited" (the default for the primary model).
    if (this.rpd > 0 && this.requestsToday >= this.rpd) {
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

/** Per-model free-tier limits (RPM / RPD / TPM / TPD) as shown in the Groq console. */
export interface GroqModelConfig {
  model: string;
  rpm: number;
  rpd: number;
  tpm: number;
  tpd: number;
}

/**
 * Default translation chain — GPT OSS 120B first, followed by non-Llama
 * Groq fallbacks. When a configured daily TPD budget is spent, the pool
 * falls back to the next model.
 */
const DEFAULT_MODEL_CHAIN = [
  "openai/gpt-oss-120b",
  "qwen/qwen3-32b",
  "openai/gpt-oss-20b",
  "moonshotai/kimi-k2-instruct",
];

const MODEL_LIMITS: Record<string, Omit<GroqModelConfig, "model">> = {
  "openai/gpt-oss-120b": { rpm: 1000, rpd: 0, tpm: 250_000, tpd: 0 },
  "qwen/qwen3-32b": { rpm: 60, rpd: 1000, tpm: 6000, tpd: 500_000 },
  "openai/gpt-oss-20b": { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200_000 },
  "moonshotai/kimi-k2-instruct": { rpm: 60, rpd: 1000, tpm: 10_000, tpd: 300_000 },
};

function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

/**
 * Resolves model ids to full configs; unknown ids get conservative defaults.
 */
export function resolveModelConfigs(modelIds: string[]): GroqModelConfig[] {
  return modelIds.map((id) => ({
    model: id,
    ...(MODEL_LIMITS[id] ?? { rpm: 30, rpd: 0, tpm: 6000, tpd: 0 }),
  }));
}
/**
 * Multi-key × multi-model rate limiter.
 * Grid of limiters: grid[keyIndex][modelIndex] with shared daily TPD budget per model.
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
   * (a model can be unavailable on an account, so the pool removes it from
   * rotation and retries the segment on the next configured model).
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
