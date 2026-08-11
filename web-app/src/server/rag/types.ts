import type { ChatMetadata } from "@/lib/chat/types";
export interface Chunk {
  id: string;
  documentId?: string;
  sourceName: string;
  sourceUrl: string;
  text: string;
  /** Matched child snippet — populated after parent expansion (visualizer / trace). */
  childText?: string;
  /** Parent chunk row id (True Parent-Child Chunking). */
  parentId?: string;
  similarityScore?: number;
  bm25Score?: number;
  rrfScore?: number;
  crossScore?: number;
}

export interface Source {
  name: string;
  url: string;
  score: number;
  documentId?: string;
  /** Matched child snippet (~200 ch) — rendered by the pipeline visualizer. */
  childText?: string;
  /** Expanded parent context (~2000 ch) — rendered by the pipeline visualizer. */
  parentText?: string;
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

export const EMBEDDING_DIM = 1024;
export const DEFAULT_MIN_SIMILARITY = 0.2;
export const RRF_K = 60;
export const DENSE_TOP_K = 15;
export const SPARSE_TOP_K = 15;
export const RERANK_TOP_K = 5;
/**
 * Wide-retrieval variants for multi-entity / synthesis questions
 * (expansion.needsDeepRerank). Dense + sparse fetch 2× candidates and the
 * rerank + parent window grows from 5 → 12, so a question spanning 4-6
 * entities can't have its recall truncated by the narrow 5-chunk window.
 */
export const DENSE_TOP_K_WIDE = 30;
export const SPARSE_TOP_K_WIDE = 30;
export const RERANK_TOP_K_WIDE = 12;
export const CRAG_THRESHOLD = 0.5;
export const CACHE_SIMILARITY_THRESHOLD = 0.97;
export const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const BLOCKED_ACCOUNT_MONTHLY_EUR = 992;
export const BLOCKED_ACCOUNT_MONTHS = 12;
export const INR_PER_EUR = 90;
export const QUERY_EMBEDDING_PREFIX = "Represent this sentence for searching relevant passages: ";

/** Detailed telemetry for the hybrid retrieval stage (Stage 1B/1C/1D). */
export interface RetrievalTelemetry {
  queryExpansionDurationMs: number;
  expandedQueries: string[];
  denseDurationMs: number;
  sparseBm25DurationMs: number;
  rrfFusionDurationMs: number;
  rerankDurationMs: number;
  bestCrossScore: number;
  cragFallbackTriggered: boolean;
  /** Time to transfer the corpus from Postgres — 0 on the FTS path. */
  corpusLoadDurationMs: number;
  /** Sparse engine used: Postgres FTS (default) or in-process BM25 fallback. */
  sparseEngine: "pg_fts" | "bm25_inproc";
  /**
   * True when wide retrieval ran (multi-entity/synthesis question): dense +
   * sparse fetched 2× candidates and the rerank/parent window grew.
   */
  wideRetrieval?: boolean;
}

/** Telemetry for an individual tool call during Research Agent execution. */
export interface ToolCallTelemetry {
  id: string;
  tool: string;
  query?: string;
  startTime: number;
  durationMs: number;
  status: "success" | "failed";
}

/** Hidden micro-steps that run before Stage 0 (PII masking + cache lookup). */
export interface PreProcessingTelemetry {
  /** Wall-clock ms spent redacting PII from the raw query. */
  piiMaskingDurationMs: number;
  /** Wall-clock ms spent checking the semantic cache (incl. query embedding). */
  cacheLookupDurationMs: number;
  /** True when the semantic cache returned a hit (short-circuit). */
  cacheHit: boolean;
}

/** Hidden micro-steps that run after Stage 3 (cache write + memory write). */
export interface PostProcessingTelemetry {
  /** Wall-clock ms spent writing the answer into the semantic cache. */
  cacheWriteDurationMs: number;
  /** Wall-clock ms spent appending the turn to conversation memory. */
  memoryWriteDurationMs: number;
  /** True when a cache entry was actually written (false on bypassCache). */
  cacheWritten: boolean;
}

/** Aggregated token + cost usage for a single agent across its LLM calls. */
export interface AgentCostTelemetry {
  agent: "research" | "analyst" | "writer";
  callCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  costUsd: number;
}
/** Hybrid retrieval result (mirrors HybridRetriever.retrieve return type). */
export interface HybridRetrievalResult {
  chunks: Chunk[];
  bestCrossScore: number;
  needsWebFallback: boolean;
  pathUsed: string;
}

/** HybridRetrievalResult extended with granular telemetry. */
export interface HybridRetrievalResultWithTelemetry extends HybridRetrievalResult {
  telemetry: RetrievalTelemetry;
}

/**
 * Pipeline event types for granular SSE streaming.
 * Matches ChatStreamEvent on the client (lib/chat/types.ts).
 */
export type PipelineEvent =
  | { type: "stage_start"; stage: string; label: string; timestamp: number }
  | {
      type: "stage_end";
      stage: string;
      label: string;
      timestamp: number;
      durationMs: number;
      details?: Record<string, unknown>;
    }
  | { type: "disambiguation"; options: string[]; timestamp: number }
  | { type: "guardrail"; passed: boolean; reason?: string; timestamp: number }
  | { type: "retrieval_telemetry"; telemetry: RetrievalTelemetry; timestamp: number }
  | { type: "tool_call"; telemetry: ToolCallTelemetry; timestamp: number }
  // Live writer output: one delta as it arrives from the provider. Chat relays
  // these straight to the SSE client; the glass-box tester ignores them (the
  // finished answer is on the result object).
  | { type: "token"; content: string; timestamp: number }
  | { type: "agent_start"; agent: "research" | "analyst" | "writer"; timestamp: number }
  | {
      type: "agent_end";
      agent: "research" | "analyst" | "writer";
      timestamp: number;
      durationMs: number;
      details?: Record<string, unknown>;
    }
  | {
      type: "done";
      messageId: string;
      sources: Source[];
      metadata: ChatMetadata;
      timestamp: number;
    }
  | { type: "error"; message: string; timestamp: number };
