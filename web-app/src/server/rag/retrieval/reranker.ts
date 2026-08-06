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
    private readonly model: string = env.RERANKER_MODEL ?? "BAAI/bge-reranker-v2-m3",
    private readonly inferenceUrl: string = env.RERANKER_URL,
    private readonly apiToken: string = env.RERANKER_TOKEN ?? env.HF_TOKEN ?? "",
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
        // `wait_for_model` makes the provider hold the socket open through a
        // cold start; on timeout the catch below degrades to fallbackRerank.
        signal: AbortSignal.timeout(15_000),
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
      // Nested numeric arrays: one inner array per input pair ([[0.1], [0.9]]).
      // Take the first score of each row — previously this returned only the
      // first row, so every chunk after index 0 got undefined → NaN crossScore.
      return (data as number[][]).map((row) => row[0] ?? 0).slice(0, expectedLength);
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
  const scored = chunks.slice(0, topK).map((chunk) => ({
    ...chunk,
    // Prefer the dense cosine similarity — a REAL semantic score on a
    // comparable scale — over the RRF rank score. RRF values are 1/(60+rank)
    // (≈0.01–0.05), which is NOT a similarity and is always below the CRAG
    // threshold (0.50), so using it here silently forced web-search fallback
    // for every query whenever the reranker was unavailable.
    crossScore: chunk.crossScore ?? chunk.similarityScore ?? 0.75,
  }));
  // Same contract as the success path: sorted by crossScore descending, so
  // reranked[0].crossScore is a true best-score for the CRAG gate.
  return scored.sort((a, b) => (b.crossScore ?? 0) - (a.crossScore ?? 0));
}
