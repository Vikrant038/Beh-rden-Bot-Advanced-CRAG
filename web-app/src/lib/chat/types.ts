export type ChatMode = "standard" | "agentic";

/**
 * @shared-source Single source of truth for chat payload limits, imported by
 * both the client (`chat-input.tsx`) and the server Zod schemas
 * (`api/chat/stream/route.ts`, `routers/chat.ts`). Keeping the value here
 * prevents the client from accepting input the server will reject with a 422.
 */
export { MAX_QUERY_LENGTH, MAX_PARTIAL_CONTENT_LENGTH } from "@/config/app";

export interface ChatSource {
  name: string;
  url: string;
  score: number;
  documentId?: string;
}

export interface ChatMetadata {
  retrievalPath?: string;
  latencyMs?: number;
  isGrounded?: boolean;
  isCached?: boolean;
  mode?: ChatMode;
  blocked?: boolean;
  requiresDisambiguation?: boolean;
  disambiguationOptions?: string[];
}

export interface ChatMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM" | "DISAMBIGUATION";
  content: string;
  sources?: ChatSource[];
  metadata?: ChatMetadata | null;
  createdAt: string;
  /** The viewing user's saved feedback rating (null/absent = unset). */
  feedback?: "up" | "down" | null;
}

/**
 * Server-side chat stages for status events.
 * Legacy stages kept for backward compatibility with existing status events.
 */
export type ChatStage =
  "guardrail" | "retrieving" | "agent_research" | "agent_analyst" | "agent_writer";

/**
 * Extended pipeline stages with granular sub-stages for the in-chat status bar.
 * Kept in sync with server PipelineEvent stages.
 */
export const PIPELINE_STAGES = [
  "idle",
  "guardrail",
  "disambiguation",
  "query_expansion",
  "retrieving",
  "dense_retrieval",
  "bm25_retrieval",
  "rrf_fusion",
  "rerank",
  "crag_gate",
  "research",
  "tool_calls",
  "analyst",
  "writer",
  "done",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/**
 * Maps a server stage id onto the PipelineStage the status bar renders.
 * Stage ids shared by both spellings (guardrail, retrieving, disambiguation,
 * query_expansion, …) pass through unchanged; legacy agent_* ids alias onto
 * the newer research/analyst/writer stages. Unknown ids fall back to "idle".
 */
export function mapChatStageToPipeline(stage: string): PipelineStage {
  if ((PIPELINE_STAGES as readonly string[]).includes(stage)) {
    return stage as PipelineStage;
  }
  switch (stage) {
    case "agent_research":
      return "research";
    case "agent_analyst":
      return "analyst";
    case "agent_writer":
      return "writer";
    default:
      return "idle";
  }
}

export function isChatMode(value: string): value is ChatMode {
  return value === "standard" || value === "agentic";
}

/** Detailed telemetry for the hybrid retrieval stage. */
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

/**
 * Extended ChatStreamEvent with granular telemetry events.
 * The client handles both legacy status events and new detailed events.
 */
export type ChatStreamEvent =
  | { type: "status"; stage: ChatStage }
  | { type: "token"; content: string }
  | { type: "disambiguation"; options: string[] }
  | { type: "done"; messageId: string; sources: ChatSource[]; metadata: ChatMetadata }
  | { type: "error"; message: string }
  | { type: "stage_start"; stage: string; label: string; timestamp: number }
  | {
      type: "stage_end";
      stage: string;
      label: string;
      timestamp: number;
      durationMs: number;
      details?: Record<string, unknown>;
    }
  | { type: "retrieval_telemetry"; telemetry: RetrievalTelemetry; timestamp: number }
  | { type: "tool_call"; telemetry: ToolCallTelemetry; timestamp: number }
  | { type: "agent_start"; agent: "research" | "analyst" | "writer"; timestamp: number }
  | {
      type: "agent_end";
      agent: "research" | "analyst" | "writer";
      timestamp: number;
      durationMs: number;
      details?: Record<string, unknown>;
    };

export interface ConversationSummary {
  id: string;
  title: string | null;
  mode: "STANDARD" | "AGENTIC";
  createdAt: string;
  updatedAt: string;
  preview: string;
  messageCount: number;
}
