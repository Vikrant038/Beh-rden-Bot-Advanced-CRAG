export interface Chunk {
  id: string;
  sourceName: string;
  sourceUrl: string;
  text: string;
  similarityScore?: number;
  bm25Score?: number;
  rrfScore?: number;
  crossScore?: number;
}

export interface Source {
  name: string;
  url: string;
  score: number;
}

export interface RetrievedContext {
  query: string;
  chunks: Chunk[];
  bestCrossScore: number;
  needsWebFallback: boolean;
  pathUsed: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface VisaCalculation {
  monthlyEur: number;
  months: number;
  totalEur: number;
  totalInr: number;
  summary: string;
}

export const EMBEDDING_DIM = 768;
export const DEFAULT_MIN_SIMILARITY = 0.2;
export const RRF_K = 60;
export const DENSE_TOP_K = 15;
export const SPARSE_TOP_K = 15;
export const RERANK_TOP_K = 5;
export const CRAG_THRESHOLD = 0.5;
export const CACHE_SIMILARITY_THRESHOLD = 0.97;
export const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const BLOCKED_ACCOUNT_MONTHLY_EUR = 992;
export const BLOCKED_ACCOUNT_MONTHS = 12;
export const INR_PER_EUR = 90;
export const QUERY_EMBEDDING_PREFIX = "Represent this sentence for searching relevant passages: ";
