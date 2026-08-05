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
 * Embedding client backed by the Hugging Face Inference API
 * (feature-extraction pipeline). 768-dim BGE embeddings.
 * Option B (Transformers.js) can replace this later without changing callers.
 */
export class HfEmbeddingClient implements EmbeddingClient {
  constructor(
    private readonly model: string = env.EMBEDDING_MODEL,
    private readonly inferenceUrl: string = env.HF_INFERENCE_URL,
    private readonly apiToken: string = env.HF_TOKEN ?? "",
  ) {}

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    if (!this.apiToken) {
      throw new LLMProviderError("HF_TOKEN not configured; cannot embed");
    }

    const generation = observeGeneration("embed", {
      model: this.model,
      metadata: { input: texts },
    });

    let response: Response;
    try {
      const url = `${this.inferenceUrl}/pipeline/feature-extraction/${encodeURIComponent(this.model)}`;
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
      });
    } catch (error) {
      logger.warn({ error: String(error) }, "[EMBED] HF API fetch failed");
      generation.endError(error);
      throw new LLMProviderError(
        `Hugging Face API is unreachable (Network/DNS error). Please check your connection to ${this.inferenceUrl}`,
      );
    }

    if (!response.ok) {
      const detail = await response.text();
      logger.warn({ status: response.status }, `[EMBED] HF error: ${detail}`);
      generation.endError(new Error(`Embedding API error ${response.status}: ${detail}`));
      throw new LLMProviderError(`Embedding API error ${response.status}: ${detail}`);
    }

    const data = (await response.json()) as number[][] | number[][][];
    const vectors = Array.isArray(data) && Array.isArray(data[0]) ? (data as number[][]) : null;

    if (!vectors || vectors.length !== texts.length) {
      logger.warn("[EMBED] HF returned malformed response");
      generation.endError(new Error("Embedding API returned malformed response"));
      throw new LLMProviderError("Embedding API returned malformed response");
    }

    const normalized = vectors.map((vector) => normalize(vector));
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
 *     BAAI/bge-base-en-v1.5, and queries MUST land in the same space.
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
