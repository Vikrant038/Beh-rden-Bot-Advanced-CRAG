export type ChatMode = "standard" | "agentic";

/**
 * @shared-source Single source of truth for chat payload limits, imported by
 * both the client (`chat-input.tsx`) and the server Zod schemas
 * (`api/chat/stream/route.ts`, `routers/chat.ts`). Keeping the value here
 * prevents the client from accepting input the server will reject with a 422.
 */
export const MAX_QUERY_LENGTH = 4000;

/** Cap on a stopped/partial assistant response persisted via `chat.savePartial`. */
export const MAX_PARTIAL_CONTENT_LENGTH = 20_000;

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
}

export type PipelineStage =
  "idle" | "guardrail" | "retrieving" | "research" | "analyst" | "writer" | "done";

export function mapChatStageToPipeline(stage: string): PipelineStage {
  switch (stage) {
    case "retrieving":
      return "retrieving";
    case "agent_research":
      return "research";
    case "agent_analyst":
      return "analyst";
    case "agent_writer":
      return "writer";
    case "guardrail":
      return "guardrail";
    default:
      return "idle";
  }
}

export function isChatMode(value: string): value is ChatMode {
  return value === "standard" || value === "agentic";
}

export type ChatStage =
  "guardrail" | "retrieving" | "agent_research" | "agent_analyst" | "agent_writer";

export type ChatStreamEvent =
  | { type: "status"; stage: ChatStage }
  | { type: "token"; content: string }
  | { type: "disambiguation"; options: string[] }
  | { type: "done"; messageId: string; sources: ChatSource[]; metadata: ChatMetadata }
  | { type: "error"; message: string };

export interface ConversationSummary {
  id: string;
  title: string | null;
  mode: "STANDARD" | "AGENTIC";
  createdAt: string;
  updatedAt: string;
  preview: string;
  messageCount: number;
}
