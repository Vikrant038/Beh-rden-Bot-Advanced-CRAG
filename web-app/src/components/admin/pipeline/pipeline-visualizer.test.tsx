import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PipelineVisualizer } from "@/components/admin/pipeline/pipeline-visualizer";
import type { AgenticRagResponse } from "@/server/rag/agents/orchestrator";

function fullTrace(overrides: Partial<AgenticRagResponse> = {}): AgenticRagResponse {
  return {
    userQuery: "Is APS mandatory for Indian students?",
    maskedQuery: "Is APS mandatory for Indian students?",
    guardrail: { passed: true, reason: "In-domain", durationMs: 10 },
    finalAnswer: "Yes — the APS certificate is mandatory.",
    researchSteps: [
      {
        iteration: 1,
        thought: "Retrieve documents about APS.",
        action: "tool_vector_search",
        observation: "Found 3 relevant chunks.",
      },
    ],
    analysisMatrix: {
      summary: "APS is mandatory for Indian applicants.",
      structured_table: "| APS | Required |\n| Yes | ✅ |",
      key_insights: ["APS is mandatory."],
      verified_facts: ["Applicable to Indian students."],
    },
    sources: [
      {
        name: "aps-guide.pdf",
        url: "pdf://abc/aps-guide.pdf",
        score: 0.9,
        documentId: "doc-1",
        childText: "Matched child snippet.",
        parentText: "Expanded parent context.",
      },
    ],
    totalLatencyMs: 2400,
    totalCostUsd: 0.000136,
    toolCalls: [
      {
        id: "call-1",
        tool: "faiss_search",
        query: "APS certificate requirements",
        durationMs: 12,
        startTime: 0,
        status: "success" as const,
      },
    ],
    llmCalls: [],
    stages: [{ index: 0, name: "Stage 0B — Domain Guardrail", durationMs: 10, status: "executed" }],
    disambiguation: { isAmbiguous: false, options: [], durationMs: 5 },
    preProcessing: {
      piiMaskingDurationMs: 2,
      cacheLookupDurationMs: 3,
      cacheHit: false,
    },
    postProcessing: {
      cacheWriteDurationMs: 4,
      memoryWriteDurationMs: 1,
      cacheWritten: true,
    },
    retrievalTelemetry: {
      queryExpansionDurationMs: 20,
      denseDurationMs: 13680,
      sparseBm25DurationMs: 673,
      rrfFusionDurationMs: 1,
      rerankDurationMs: 30,
      corpusLoadDurationMs: 2,
      expandedQueries: ["APS certificate mandatory", "APS Zertifikat Pflicht"],
      sparseEngine: "pg_fts",
      bestCrossScore: 0.71,
      cragFallbackTriggered: false,
    },
    agentCosts: [
      {
        agent: "research",
        callCount: 2,
        promptTokens: 900,
        completionTokens: 220,
        totalTokens: 1120,
        latencyMs: 500,
        costUsd: 0.0000626,
      },
      {
        agent: "analyst",
        callCount: 1,
        promptTokens: 900,
        completionTokens: 220,
        totalTokens: 1120,
        latencyMs: 500,
        costUsd: 0.0000626,
      },
      {
        agent: "writer",
        callCount: 1,
        promptTokens: 700,
        completionTokens: 480,
        totalTokens: 1180,
        latencyMs: 300,
        costUsd: 0.0000734,
      },
    ],
    ...overrides,
  };
}

/** StageNodes are closed by default — expand every stage before asserting body content. */
function expandAllStages() {
  const expandButtons = screen.getAllByRole("button", { name: /^Expand / });
  for (const button of expandButtons) {
    fireEvent.click(button);
  }
}

describe("PipelineVisualizer", () => {
  it("renders stage titles, totals, and telemetry for a full trace", () => {
    render(<PipelineVisualizer trace={fullTrace()} />);
    expect(screen.getByText("Pipeline trace")).toBeInTheDocument();
    expect(screen.getByText("2400ms total")).toBeInTheDocument();
    expandAllStages();
    expect(screen.getByText(/13680ms/)).toBeInTheDocument();
    expect(screen.getByText(/673ms/)).toBeInTheDocument();
    expect(screen.getByText("APS certificate mandatory")).toBeInTheDocument();
    // Analyst + Writer cost badges render (research-agent costs are not shown).
    expect(screen.getByText("Analyst")).toBeInTheDocument();
    expect(screen.getByText("Writer")).toBeInTheDocument();
    expect(screen.getAllByText("1 call")).toHaveLength(2);
  });

  it("renders HIT cache badge and skips post-processing when cached", () => {
    render(
      <PipelineVisualizer
        trace={fullTrace({
          researchSteps: [
            { iteration: 0, thought: "x", action: "Semantic Cache Hit", observation: "y" },
          ],
          sources: [],
        })}
      />,
    );
    expandAllStages();
    expect(screen.getByText("HIT")).toBeInTheDocument();
    expect(screen.getByText("cache hit")).toBeInTheDocument();
    expect(screen.getByText("WRITTEN")).toBeInTheDocument();
  });

  it("renders MISS cache badge when the trace is not a cache hit", () => {
    render(<PipelineVisualizer trace={fullTrace()} />);
    expandAllStages();
    expect(screen.getByText("MISS")).toBeInTheDocument();
  });

  it("short-circuits downstream stages when the guardrail blocks", () => {
    render(
      <PipelineVisualizer
        trace={fullTrace({
          guardrail: { passed: false, reason: "Out of domain", durationMs: 8 },
          sources: [],
          researchSteps: [],
        })}
      />,
    );
    expect(screen.getByText("out of domain")).toBeInTheDocument();
    expandAllStages();
    expect(screen.getByText(/BLOCKED/)).toBeInTheDocument();
    expect(screen.getByText(/Pipeline short-circuited/)).toBeInTheDocument();
  });

  it("falls back to the total latency when per-stage timings are missing", () => {
    render(
      <PipelineVisualizer
        trace={fullTrace({
          stages: [],
          preProcessing: undefined,
          postProcessing: undefined,
          disambiguation: undefined,
          retrievalTelemetry: undefined,
        })}
      />,
    );
    expandAllStages();
    expect(screen.getByText(/Retrieval telemetry not available/)).toBeInTheDocument();
  });

  it("renders CRAG fallback as a warning score", () => {
    render(
      <PipelineVisualizer
        trace={fullTrace({
          retrievalTelemetry: {
            queryExpansionDurationMs: 20,
            denseDurationMs: 100,
            sparseBm25DurationMs: 50,
            rrfFusionDurationMs: 1,
            rerankDurationMs: 30,
            corpusLoadDurationMs: 2,
            expandedQueries: ["q"],
            sparseEngine: "pg_fts",
            bestCrossScore: 0.31,
            cragFallbackTriggered: true,
          },
          sources: [],
          researchSteps: [],
        })}
      />,
    );
    expandAllStages();
    expect(screen.getByText(/FAIL \(CRAG Fallback\)/)).toBeInTheDocument();
  });

  it("renders the no-sources web-fallback notice", () => {
    render(<PipelineVisualizer trace={fullTrace({ sources: [], researchSteps: [] })} />);
    expandAllStages();
    expect(screen.getByText(/No local chunks passed the CRAG threshold/)).toBeInTheDocument();
  });

  it("handles missing structured table, insights, and facts gracefully", () => {
    render(
      <PipelineVisualizer
        trace={fullTrace({
          analysisMatrix: {
            summary: "No table.",
            structured_table: "",
            key_insights: [],
            verified_facts: [],
          },
          agentCosts: [],
        })}
      />,
    );
    expandAllStages();
    expect(screen.getByText("No table.")).toBeInTheDocument();
    expect(screen.queryByText("Key insights")).not.toBeInTheDocument();
    expect(screen.queryByText("Verified facts")).not.toBeInTheDocument();
  });
});
