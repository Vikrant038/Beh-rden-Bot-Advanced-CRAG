import type { Chunk } from "@/server/rag/types";

const DEFAULT_K1 = 1.5;
const DEFAULT_B = 0.75;
// rank_bm25 defaults epsilon to 0.25 (assigns a baseline score to every
// non-matching doc). We default to 0 so sparse precision stays clean —
// docs with no query-term overlap score exactly 0 and are filtered out.
const DEFAULT_EPSILON = 0;

export function defaultTokenizer(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Okapi BM25 sparse ranker, ported from `rank_bm25.BM25Okapi`
 * (used by `src/advanced_retrieval.py`). Stateless index built over a
 * chunk corpus; the index is memoized per corpus instance by the hybrid
 * retriever (WeakMap keyed on the cached corpus array), so it is built once
 * per corpus lifetime rather than per request. Term-frequency maps are
 * pre-computed at construction time for O(query_length) per-document scoring;
 * the average-IDF baseline is memoized too (see `averageIdfCache`).
 */
export class BM25Okapi {
  private readonly docFrequencies = new Map<string, number>();
  private readonly docLengths: number[] = [];
  private readonly avgDocLength: number;
  private readonly idfCache = new Map<string, number>();
  private readonly termFrequencies: Map<string, number>[];
  private averageIdfCache: number | null = null;

  constructor(
    private readonly documents: string[][],
    private readonly k1: number = DEFAULT_K1,
    private readonly b: number = DEFAULT_B,
    private readonly epsilon: number = DEFAULT_EPSILON,
  ) {
    this.docLengths = documents.map((doc) => doc.length);
    const totalLength = this.docLengths.reduce((sum, len) => sum + len, 0);
    this.avgDocLength = documents.length > 0 ? totalLength / documents.length : 0;

    for (const doc of documents) {
      const seen = new Set<string>();
      for (const term of doc) {
        if (!seen.has(term)) {
          seen.add(term);
          this.docFrequencies.set(term, (this.docFrequencies.get(term) ?? 0) + 1);
        }
      }
    }

    // Pre-compute per-document term-frequency maps so getScore is O(query_length)
    // instead of O(query_length × doc_length).
    this.termFrequencies = documents.map((doc) => {
      const tf = new Map<string, number>();
      for (const token of doc) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
      }
      return tf;
    });
  }

  private getIdf(term: string): number {
    const cached = this.idfCache.get(term);
    if (cached !== undefined) {
      return cached;
    }
    const n = this.documents.length;
    const df = this.docFrequencies.get(term) ?? 0;
    const idf = n === 0 ? 0 : Math.log(1 + (n - df + 0.5) / (df + 0.5));
    this.idfCache.set(term, idf);
    return idf;
  }

  /**
   * Mean IDF across the vocabulary, computed once on first use. Scoring a
   * corpus calls this once per document, so computing it inline made scoring
   * O(documents × vocabulary) — 23.9k docs × 26k terms × 5 sub-queries was
   * ~3.1B iterations (147s of a 388s trace).
   */
  private getAverageIdf(): number {
    if (this.averageIdfCache !== null) {
      return this.averageIdfCache;
    }
    if (this.docFrequencies.size === 0) {
      this.averageIdfCache = 0;
      return 0;
    }
    let sum = 0;
    for (const term of this.docFrequencies.keys()) {
      sum += this.getIdf(term);
    }
    this.averageIdfCache = sum / this.docFrequencies.size;
    return this.averageIdfCache;
  }

  getScore(query: string[], docIndex: number): number {
    if (docIndex < 0 || docIndex >= this.documents.length) {
      return 0;
    }
    const docLength = this.docLengths[docIndex];
    const tfMap = this.termFrequencies[docIndex];

    let score = 0;
    for (const term of query) {
      const termFrequency = tfMap.get(term) ?? 0;
      if (termFrequency === 0) {
        continue;
      }
      const idf = this.getIdf(term);
      const denominator =
        this.k1 * (1 - this.b + (this.b * docLength) / (this.avgDocLength || 1)) + termFrequency;
      score += idf * ((termFrequency * (this.k1 + 1)) / denominator);
    }

    if (score === 0 && query.length > 0) {
      score = this.epsilon * this.getAverageIdf();
    }
    return score;
  }

  getScores(query: string[]): number[] {
    return this.documents.map((_, index) => this.getScore(query, index));
  }

  /**
   * Returns ranked chunk indices with score > 0, highest first (top_k limit).
   */
  search(query: string[], topK: number): Array<{ index: number; score: number }> {
    const scores = this.getScores(query);
    return scores
      .map((score, index) => ({ index, score }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

export interface Bm25Search {
  search(query: string, topK: number): Chunk[];
}

export function buildBm25(
  chunks: Chunk[],
  tokenizer: (text: string) => string[] = defaultTokenizer,
): Bm25Search {
  const corpus = chunks.map((chunk) => tokenizer(chunk.text));
  const bm25 = new BM25Okapi(corpus);
  return {
    search(query: string, topK: number): Chunk[] {
      const queryTokens = tokenizer(query);
      if (queryTokens.length === 0) {
        return [];
      }
      return bm25
        .search(queryTokens, topK)
        .map(({ index, score }) => ({ ...chunks[index], bm25Score: score }));
    },
  };
}
