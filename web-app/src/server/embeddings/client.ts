import { env } from "@/server/env";
import { createLogger } from "@/server/lib/logger";
import { QUERY_EMBEDDING_PREFIX } from "@/server/rag/types";
import { LLMProviderError } from "@/server/llm/errors";
import { observeGeneration } from "@/server/tracing";

const logger = createLogger("embeddings");

export interface EmbeddingClient {
  embedTexts(texts: string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}

/**
 * Max inputs cached per embed batch. Query-side batches are tiny (1-8 texts),
 * but ingest-side batches can be thousands — we never want to cache those
 * (they are single-use and would blow the LRU out).
 */
const EMBED_CACHE_MAX_BATCH = 16;
const EMBED_CACHE_MAX_ENTRIES = 2048;
const EMBED_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Bounded in-memory embedding cache keyed by the exact input text batch.
 *
 * Why: every embed is a round-trip to the embedding endpoint, and on a cold
 * Cloudflare Worker the model load alone is 10-20s. The pipeline re-embeds
 * the same texts repeatedly — the query vector, the expanded sub-queries, and
 * repeated admin tester prompts all produce identical inputs — so caching the
 * normalized vectors turns those calls into instant Map hits instead of
 * re-paying a cold start. Instance-scoped so tests that stub `fetch` on a
 * fresh client are never contaminated by prior cases.
 *
 * Exported (as a type) so the expiry/sweep behavior is unit-testable with a
 * small cap; production uses the module-level defaults.
 */
export class EmbeddingBatchCache {
  private readonly cache = new Map<string, { vectors: number[][]; expiresAt: number }>();

  constructor(private readonly maxEntries: number = EMBED_CACHE_MAX_ENTRIES) {}

  /** Test/diagnostic hook: number of live entries. */
  get size(): number {
    return this.cache.size;
  }

  get(texts: string[]): number[][] | undefined {
    if (texts.length === 0 || texts.length > EMBED_CACHE_MAX_BATCH) {
      return undefined;
    }
    const key = texts.join("\u0000");
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.vectors;
  }

  set(texts: string[], vectors: number[][]): void {
    if (texts.length === 0 || texts.length > EMBED_CACHE_MAX_BATCH) {
      return;
    }
    // Opportunistically reclaim expired entries on writes so the cache never
    // pins dead vectors when unique texts keep flowing (get() also prunes the
    // key it touched, but that alone leaves untouched expired entries behind).
    if (this.cache.size >= this.maxEntries) {
      const now = Date.now();
      for (const [key, entry] of this.cache) {
        if (entry.expiresAt < now) {
          this.cache.delete(key);
        }
      }
    }
    if (this.cache.size >= this.maxEntries) {
      // Still at cap after the sweep — drop the oldest entry (Map preserves
      // insertion order) to make room.
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(texts.join("\u0000"), {
      vectors,
      expiresAt: Date.now() + EMBED_CACHE_TTL_MS,
    });
  }
}

/**
 * Embedding client backed by the Hugging Face Inference API
 * (feature-extraction pipeline). 1024-dim BGE-M3 embeddings (multilingual —
 * matches the corpus space; see the Cloudflare embeddings worker).
 */
export class HfEmbeddingClient implements EmbeddingClient {
  private readonly cache = new EmbeddingBatchCache();

  constructor(
    private readonly model: string = env.EMBEDDING_MODEL,
    private readonly inferenceUrl: string = env.HF_INFERENCE_URL,
    private readonly apiToken: string = env.EMBED_TOKEN ?? env.HF_TOKEN ?? "",
  ) {}

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    if (!this.apiToken) {
      throw new LLMProviderError("EMBED_TOKEN/HF_TOKEN not configured; cannot embed");
    }

    const cached = this.cache.get(texts);
    if (cached) {
      logger.debug({ count: texts.length }, "[EMBED] cache hit for batch");
      return cached;
    }

    const generation = observeGeneration("embed", {
      model: this.model,
      metadata: { input: texts },
    });

    const url = `${this.inferenceUrl}/pipeline/feature-extraction/${encodeURIComponent(this.model)}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
        // `wait_for_model` makes the provider hold the socket open through a
        // cold start, so without a deadline this await is unbounded.
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      logger.warn({ error: String(error) }, "[EMBED] HF API fetch failed");
      generation.endError(error);
      // The HF Inference API default is unreachable from many networks (DNS/
      // geo blocks). When it is in use, point the operator at HF_INFERENCE_URL
      // (the Cloudflare embeddings worker) instead of leaving a dead-end error.
      const defaultEndpoint = this.inferenceUrl.includes("api-inference.huggingface.co");
      const hint = defaultEndpoint
        ? " Set HF_INFERENCE_URL to a reachable BGE-M3 endpoint (e.g. your Cloudflare embeddings worker URL) — see docs/EVALUATION.md."
        : "";
      throw new LLMProviderError(
        `Hugging Face API is unreachable (Network/DNS error). Please check your connection to ${this.inferenceUrl}.${hint}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text();
      // Include the exact URL: a 404 HTML page usually means HF_INFERENCE_URL
      // points at a Hugging Face endpoint instead of the Cloudflare embeddings
      // worker (the worker answers plain-text 401 for a bad EMBED_TOKEN and
      // JSON for success — never an HTML page).
      logger.warn({ status: response.status, url }, `[EMBED] HF error: ${detail}`);
      generation.endError(
        new Error(`Embedding API error ${response.status} from ${url}: ${detail}`),
      );
      throw new LLMProviderError(`Embedding API error ${response.status} from ${url}: ${detail}`);
    }

    const data = (await response.json()) as number[][] | number[][][];
    const vectors = Array.isArray(data) && Array.isArray(data[0]) ? (data as number[][]) : null;

    if (!vectors || vectors.length !== texts.length) {
      logger.warn("[EMBED] HF returned malformed response");
      generation.endError(new Error("Embedding API returned malformed response"));
      throw new LLMProviderError("Embedding API returned malformed response");
    }

    const normalized = vectors.map((vector) => normalize(vector));
    this.cache.set(texts, normalized);
    generation.end({ count: normalized.length, dim: normalized[0]?.length ?? 0 });
    return normalized;
  }

  async embedQuery(query: string): Promise<number[]> {
    const prefixed = `${QUERY_EMBEDDING_PREFIX}${query.trim()}`;
    const vectors = await this.embedTexts([prefixed]);
    return vectors[0];
  }
}

/**
 * Default embed client selected by `EMBEDDING_PROVIDER`:
 *   - "gemini" → GeminiEmbeddingClient. ONLY correct if the corpus was
 *     embedded with a Gemini model (vectors live in Gemini's space).
 *   - "hf"     → HfEmbeddingClient pointed at HF_INFERENCE_URL (the
 *     Cloudflare embeddings worker). Default — the corpus is embedded with
 *     BAAI/bge-m3 (1024-dim), and queries MUST land in the same space.
 * The client must be the SAME on both the ingest side and the query side, or
 * cosine retrieval compares vectors from different spaces.
 */
export function createDefaultEmbeddingClient(): EmbeddingClient {
  return env.EMBEDDING_PROVIDER === "gemini"
    ? new GeminiEmbeddingClient()
    : new HfEmbeddingClient();
}

/** Gemini batchEmbedContents accepts at most this many inputs per request. */
export const GEMINI_BATCH_LIMIT = 100;

/**
 * Embedding client backed by the Google Gemini API (text-embedding-004).
 * Returns 768-dimensional vectors by default.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

export class GeminiEmbeddingClient implements EmbeddingClient {
  private readonly ai: GoogleGenerativeAI;

  constructor(
    private readonly apiKey: string = env.GEMINI_API_KEY ?? "",
    private readonly model: string = "text-embedding-004", // using legacy name as default fallback for older tests, but overriding in code if not set
  ) {
    this.ai = new GoogleGenerativeAI(this.apiKey);
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    if (!this.apiKey) {
      throw new LLMProviderError("GEMINI_API_KEY not configured; cannot embed");
    }

    const actualModel = this.model === "text-embedding-004" ? "gemini-embedding-2" : this.model;

    const generation = observeGeneration("embed", {
      model: actualModel,
      metadata: { input: texts },
    });

    try {
      const model = this.ai.getGenerativeModel({ model: actualModel });
      const vectors: number[][] = [];

      // Gemini caps batchEmbedContents at GEMINI_BATCH_LIMIT inputs per request.
      // Large documents (e.g. the Residence Act → ~4,000 child chunks) must be
      // split or the API rejects the whole call.
      for (let offset = 0; offset < texts.length; offset += GEMINI_BATCH_LIMIT) {
        const batch = texts.slice(offset, offset + GEMINI_BATCH_LIMIT);
        // outputDimensionality is not part of the SDK's current public request
        // type, so define the request shape locally.
        const requests: Array<{
          content: { role: string; parts: Array<{ text: string }> };
          outputDimensionality: number;
        }> = batch.map((text) => ({
          content: { role: "user", parts: [{ text }] },
          outputDimensionality: 768,
        }));

        const response = await this.retryOnRateLimit(() => model.batchEmbedContents({ requests }));
        if (!response || !response.embeddings) {
          throw new Error("Invalid response from Gemini API");
        }
        vectors.push(...response.embeddings.map((e) => e.values));
      }

      const normalized = vectors.map((vector) => normalize(vector));

      generation.end({ count: normalized.length, dim: normalized[0]?.length ?? 0 });
      return normalized;
    } catch (error) {
      logger.warn({ error: String(error) }, "[EMBED] Gemini API fetch failed");
      generation.endError(error);
      throw new LLMProviderError(
        `Gemini Embedding API error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async embedQuery(query: string): Promise<number[]> {
    const prefixed = `${QUERY_EMBEDDING_PREFIX}${query.trim()}`;
    const vectors = await this.embedTexts([prefixed]);
    return vectors[0];
  }

  /**
   * Retries a Gemini batch call on transient rate-limit / server errors with
   * exponential backoff. Embedding calls are idempotent, so re-sending a batch
   * after a 429/5xx is safe. Free-tier RPM limits make this necessary for
   * large corpus runs (a single serial sync can sit at the 100 req/min edge).
   */
  private async retryOnRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const detail = String(error);
        const retryable =
          /(429|RESOURCE_EXHAUSTED|rate.?limit)/i.test(detail) ||
          /(5\d\d|503|UNAVAILABLE|DEADLINE_EXCEEDED)/i.test(detail);
        if (!retryable || attempt === maxAttempts) {
          throw error;
        }
        const backoffMs = 500 * 2 ** (attempt - 1);
        logger.warn({ attempt, backoffMs }, "[EMBED] Gemini rate-limited; backing off");
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
    throw lastError;
  }
}

function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}
