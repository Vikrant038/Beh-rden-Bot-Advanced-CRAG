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
 * Embedding client backed by the Google Gemini API (text-embedding-004).
 * Returns 768-dimensional vectors by default.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

export class GeminiEmbeddingClient implements EmbeddingClient {
  private readonly ai: GoogleGenerativeAI;

  constructor(
    private readonly apiKey: string = env.GEMINI_API_KEY ?? "",
    private readonly model: string = "text-embedding-004" // using legacy name as default fallback for older tests, but overriding in code if not set
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
      // batchEmbedContents requires an array of requests; outputDimensionality is
      // not part of the SDK's current public request type, so define it locally.
      const requests: Array<{
        content: { role: string; parts: Array<{ text: string }> };
        outputDimensionality: number;
      }> = texts.map((text) => ({
        content: { role: "user", parts: [{ text }] },
        outputDimensionality: 768,
      }));

      const response = await model.batchEmbedContents({
        requests,
      });

      if (!response || !response.embeddings) {
        throw new Error("Invalid response from Gemini API");
      }

      const vectors = response.embeddings.map((e) => e.values);
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
}

function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}
