import { describe, it, expect } from "vitest";
import {
  isChatMode,
  mapChatStageToPipeline,
  MAX_QUERY_LENGTH,
  MAX_PARTIAL_CONTENT_LENGTH,
  type ChatStreamEvent,
  type RetrievalTelemetry,
  type ToolCallTelemetry,
} from "@/lib/chat/types";

describe("mapChatStageToPipeline", () => {
  it("maps every legacy stage to its pipeline stage", () => {
    expect(mapChatStageToPipeline("retrieving")).toBe("retrieving");
    expect(mapChatStageToPipeline("agent_research")).toBe("research");
    expect(mapChatStageToPipeline("agent_analyst")).toBe("analyst");
    expect(mapChatStageToPipeline("agent_writer")).toBe("writer");
    expect(mapChatStageToPipeline("guardrail")).toBe("guardrail");
    expect(mapChatStageToPipeline("disambiguation")).toBe("disambiguation");
    expect(mapChatStageToPipeline("query_expansion")).toBe("query_expansion");
    expect(mapChatStageToPipeline("dense_retrieval")).toBe("dense_retrieval");
    expect(mapChatStageToPipeline("bm25_retrieval")).toBe("bm25_retrieval");
    expect(mapChatStageToPipeline("rrf_fusion")).toBe("rrf_fusion");
    expect(mapChatStageToPipeline("rerank")).toBe("rerank");
    expect(mapChatStageToPipeline("crag_gate")).toBe("crag_gate");
    expect(mapChatStageToPipeline("tool_calls")).toBe("tool_calls");
  });

  it("falls back to idle for unknown stages", () => {
    expect(mapChatStageToPipeline("")).toBe("idle");
    expect(mapChatStageToPipeline("some_future_stage")).toBe("idle");
    expect(mapChatStageToPipeline("WRITER")).toBe("idle");
  });
});

describe("isChatMode", () => {
  it("accepts the two valid modes", () => {
    expect(isChatMode("standard")).toBe(true);
    expect(isChatMode("agentic")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(isChatMode("")).toBe(false);
    expect(isChatMode("STANDARD")).toBe(false);
    expect(isChatMode("research")).toBe(false);
  });
});

describe("payload limits", () => {
  it("exposes the shared client/server constants", () => {
    expect(MAX_QUERY_LENGTH).toBeGreaterThan(0);
    expect(MAX_PARTIAL_CONTENT_LENGTH).toBeGreaterThan(MAX_QUERY_LENGTH);
  });
});

describe("telemetry event shapes", () => {
  it("narrows RetrievalTelemetry to both sparse engine values", () => {
    const pgFts: RetrievalTelemetry = {
      queryExpansionDurationMs: 1,
      expandedQueries: [],
      denseDurationMs: 2,
      sparseBm25DurationMs: 3,
      rrfFusionDurationMs: 4,
      rerankDurationMs: 5,
      bestCrossScore: 0.9,
      cragFallbackTriggered: false,
      corpusLoadDurationMs: 0,
      sparseEngine: "pg_fts",
    };
    const inProc: RetrievalTelemetry = { ...pgFts, sparseEngine: "bm25_inproc" };
    expect(pgFts.sparseEngine).toBe("pg_fts");
    expect(inProc.sparseEngine).toBe("bm25_inproc");
  });

  it("narrows ToolCallTelemetry to both status values", () => {
    const ok: ToolCallTelemetry = {
      id: "t1",
      tool: "hybrid_retrieval",
      startTime: 1,
      durationMs: 2,
      status: "success",
    };
    const failed: ToolCallTelemetry = { ...ok, status: "failed" };
    expect(ok.status).toBe("success");
    expect(failed.status).toBe("failed");
  });

  it("supports every ChatStreamEvent discriminant at the type level", () => {
    const events: ChatStreamEvent[] = [
      { type: "status", stage: "retrieving" },
      { type: "token", content: "x" },
      { type: "disambiguation", options: ["A"] },
      { type: "done", messageId: "m", sources: [], metadata: {} },
      { type: "error", message: "e" },
      { type: "stage_start", stage: "s", label: "l", timestamp: 1 },
      { type: "stage_end", stage: "s", label: "l", timestamp: 1, durationMs: 2 },
      { type: "retrieval_telemetry", telemetry: {} as RetrievalTelemetry, timestamp: 1 },
      { type: "tool_call", telemetry: {} as ToolCallTelemetry, timestamp: 1 },
      { type: "agent_start", agent: "research", timestamp: 1 },
      { type: "agent_end", agent: "writer", timestamp: 1, durationMs: 2 },
    ];
    expect(events).toHaveLength(11);
    expect(events.map((event) => event.type).sort()).toEqual(
      [
        "agent_end",
        "agent_start",
        "disambiguation",
        "done",
        "error",
        "retrieval_telemetry",
        "stage_end",
        "stage_start",
        "status",
        "token",
        "tool_call",
      ].sort(),
    );
  });
});
