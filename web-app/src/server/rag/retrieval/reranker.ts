import { env } from "@/server/env";
import type { Chunk } from "@/server/rag/types";
import { RERANK_TOP_K } from "@/server/rag/types";
import { createLogger } from "@/server/lib/logger";
import { LLMProviderError } from "@/server/llm/errors";

const logger = createLogger("reranker");

export interface Reranker {
  rerank(query: string, chunks: Chunk[], topK?: number): Promise<Chunk[]>;
}

interface RerankResponse {
  scores?: number[];
  [key: string]: unknown;
}

/**
 * Cross-encoder re-ranker via the HuggingFace Inference API
 * (BAAI/bge-reranker-base). Ported from `src/advanced_retrieval.py:rerank_cross_encoder`,
 * including the sigmoid post-processing of raw scores.
 */
export class HfReranker implements Reranker {
  constructor(
    private readonly model: string = env.RERANKER_MODEL ?? "BAAI/bge-reranker-base",
    private readonly inferenceUrl: string = env.HF_INFERENCE_URL,
    private readonly apiToken: string = env.HF_TOKEN ?? "",
  ) {}

  async rerank(query: string, chunks: Chunk[], topK: number = RERANK_TOP_K): Promise<Chunk[]> {
    if (chunks.length === 0) {
      return [];
    }
    if (!this.apiToken) {
      logger.warn("[RERANK] No HF_TOKEN; returning original ranking");
      return fallbackRerank(query, chunks, topK);
    }

    const pairs = chunks.map((chunk) => [query, chunk.text] as [string, string]);

    try {
      const url = `${this.inferenceUrl}/pipeline/text-classification/${encodeURIComponent(this.model)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: pairs,
          options: { wait_for_model: true },
        }),
      });

      if (!response.ok) {
        throw new LLMProviderError(`Reranker API error ${response.status}`);
      }

      const data = (await response.json()) as unknown;
      const scores = extractScores(data, chunks.length);

      const reranked = chunks.map((chunk, index) => ({
        ...chunk,
        crossScore: sigmoid(scores[index]),
      }));
      reranked.sort((a, b) => (b.crossScore ?? 0) - (a.crossScore ?? 0));
      return reranked.slice(0, topK);
    } catch (error) {
      logger.warn(
        { error: String(error) },
        "[RERANK] Cross-encoder failed; returning original ranking",
      );
      return fallbackRerank(query, chunks, topK);
    }
  }
}

function extractScores(data: unknown, expectedLength: number): number[] {
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];

    if (typeof first === "number") {
      return (data as number[]).slice(0, expectedLength);
    }

    if (Array.isArray(first) && typeof first[0] === "number") {
      return (first as number[]).slice(0, expectedLength);
    }

    if (Array.isArray(first) && first[0] && typeof first[0] === "object") {
      const scored = (first as Array<{ score?: number }>)[0];
      if (scored && typeof scored.score === "number") {
        return (data as Array<Array<{ score?: number }>>).map((entry) => entry[0]?.score ?? 0);
      }
    }
  }

  if (data && typeof data === "object" && Array.isArray((data as RerankResponse).scores)) {
    return ((data as RerankResponse).scores ?? []).slice(0, expectedLength);
  }

  throw new LLMProviderError("Reranker returned malformed response");
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function fallbackRerank(query: string, chunks: Chunk[], topK: number): Chunk[] {
  return chunks.slice(0, topK).map((chunk) => ({
    ...chunk,
    crossScore: chunk.crossScore ?? chunk.rrfScore ?? chunk.similarityScore ?? 0.75,
  }));
}
