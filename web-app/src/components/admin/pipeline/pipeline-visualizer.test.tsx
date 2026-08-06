import "@testing-library/jest-dom/vitest";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PipelineVisualizer } from "@/components/admin/pipeline/pipeline-visualizer";
import type { AgenticRagResponse } from "@/server/rag/agents/orchestrator";

/** Expands the collapsible body of the stage whose heading matches `title`. */
function expandStage(title: string | RegExp): HTMLElement {
  const heading = screen.getByRole("heading", { name: title });
  const stage = heading.closest("li");
  if (!stage) {
    throw new Error(`No <li> ancestor for stage ${title}`);
  }
  fireEvent.click(within(stage).getByRole("button", { name: /Expand/ }));
  return stage;
}

function fullTrace(): AgenticRagResponse {
  return {
    userQuery: "What documents are required for a German student visa?",
    maskedQuery: "What documents are required for a German student visa?",
    guardrail: { passed: true, reason: "In-domain", durationMs: 110 },
    finalAnswer: "You need a valid passport and proof of funds.",
    researchSteps: [
      {
        iteration: 1,
        thought: "Primary query received.",
        action: "tool_vector_search",
        observation: "Retrieved 3 relevant chunks from local database.",
        durationMs: 88,
      },
    ],
    analysisMatrix: {
      summary: "Required documents include passport, proof of funds.",
      structured_table: "| Document | Required |\n| Passport | Yes |",
      key_insights: ["Proof of funds is mandatory."],
      verified_facts: ["Blocked account is accepted."],
    },
    sources: [
      {
        name: "visa-guide.pdf",
        url: "pdf://abc/visa-guide.pdf",
        score: 0.82,
        documentId: "doc-1",
        childText: "Matched child snippet.",
        parentText: "Expanded parent context.",
      },
    ],
    disambiguation: { durationMs: 30, isAmbiguous: false, options: [] },
    retrievalTelemetry: {
      queryExpansionDurationMs: 20,
      expandedQueries: ["German student visa documents", "Requirements student visa Germany"],
      denseDurationMs: 40,
      sparseBm25DurationMs: 25,
      rrfFusionDurationMs: 5,
      rerankDurationMs: 15,
      bestCrossScore: 0.85,
      cragFallbackTriggered: false,
      corpusLoadDurationMs: 0,
      sparseEngine: "pg_fts",
    },
    toolCalls: [
      {
        id: "call-1",
        tool: "hybrid_retrieval",
        query: "What documents are required for a German student visa?",
        startTime: 100,
        durationMs: 88,
        status: "success",
      },
    ],
    totalLatencyMs: 2400,
    stages: [
      { index: 0, name: "Query disambiguation & guardrail", durationMs: 400, status: "executed" },
      { index: 1, name: "Research agent (ReAct)", durationMs: 1200, status: "executed" },
      { index: 2, name: "Analyst (comparison matrix)", durationMs: 500, status: "executed" },
      { index: 3, name: "Writer (markdown synthesis)", durationMs: 300, status: "executed" },
    ],
    llmCalls: [
      {
        stage: "Stage 2 — Analyst (comparison matrix)",
        provider: "groq",
        model: "llama-3.1-8b-instant",
        latencyMs: 500,
        promptTokens: 900,
        completionTokens: 220,
        totalTokens: 1120,
        costUsd: 0.0000626,
      },
      {
        stage: "Stage 3 — Writer (markdown synthesis)",
        provider: "groq",
        model: "llama-3.1-8b-instant",
        latencyMs: 300,
        promptTokens: 700,
        completionTokens: 480,
        totalTokens: 1180,
        costUsd: 0.0000734,
      },
    ],
    totalCostUsd: 0.000136,
    agentCosts: [
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
    preProcessing: {
      piiMaskingDurationMs: 4,
      cacheLookupDurationMs: 12,
      cacheHit: false,
    },
    postProcessing: {
      cacheWriteDurationMs: 18,
      memoryWriteDurationMs: 6,
      cacheWritten: true,
    },
  };
}

describe("PipelineVisualizer", () => {
  it("renders pre-processing block with PII masking and cache lookup times", () => {
    render(<PipelineVisualizer trace={fullTrace()} />);
    // Pre-Processing stage exists; body is closed by default.
    expect(
      screen.getByRole("heading", { name: /Pre-Processing — PII Masking & Cache Lookup/ }),
    ).toBeInTheDocument();
    const stage = expandStage(/Pre-Processing — PII Masking & Cache Lookup/);
    expect(within(stage).getByText("PII redaction:")).toBeInTheDocument();
    expect(within(stage).getByText("MISS")).toBeInTheDocument();
    expect(within(stage).getByText("4ms")).toBeInTheDocument();
    expect(within(stage).getByText("12ms")).toBeInTheDocument();
  });

  it("splits Stage 0 into disambiguation and guardrail blocks", () => {
    render(<PipelineVisualizer trace={fullTrace()} />);
    expect(
      screen.getByRole("heading", { name: /Stage 0A — Query Disambiguation/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /Stage 0B — Domain Guardrail/ }),
    ).toBeInTheDocument();
    // Guardrail status is inside the collapsed body — expand to reveal it.
    const stage = expandStage(/Stage 0B — Domain Guardrail/);
    expect(within(stage).getByText("Guardrail: PASSED")).toBeInTheDocument();
  });

  it("renders expanded queries and sparse engine badge in retrieval", () => {
    render(<PipelineVisualizer trace={fullTrace()} />);
    const stage = expandStage(/Stage 1A\/B\/C\/D — Query Expansion & Hybrid Retrieval/);
    expect(within(stage).getByText("German student visa documents")).toBeInTheDocument();
    expect(within(stage).getByText("Requirements student visa Germany")).toBeInTheDocument();
    expect(within(stage).getByText("Sparse engine: pg_fts")).toBeInTheDocument();
    expect(within(stage).getByText("Dense Search (pgvector)")).toBeInTheDocument();
    expect(within(stage).getByText("40ms")).toBeInTheDocument();
    expect(within(stage).getByText("25ms")).toBeInTheDocument();
  });

  it("renders per-agent cost badges on analyst and writer stages", () => {
    render(<PipelineVisualizer trace={fullTrace()} />);
    const analyst = expandStage(/Stage 2 — Analyst \(comparison matrix\)/);
    expect(within(analyst).getByText("Analyst")).toBeInTheDocument();
    expect(within(analyst).getByText("900 in · 220 out")).toBeInTheDocument();
    const writer = expandStage(/Stage 3 — Writer \(markdown synthesis\)/);
    expect(within(writer).getByText("Writer")).toBeInTheDocument();
    expect(within(writer).getByText("700 in · 480 out")).toBeInTheDocument();
  });

  it("renders the post-processing block with cache write status", () => {
    render(<PipelineVisualizer trace={fullTrace()} />);
    const stage = expandStage(/Post-Processing — Cache Write & Memory/);
    expect(within(stage).getByText("WRITTEN")).toBeInTheDocument();
    expect(within(stage).getByText("Semantic cache write:")).toBeInTheDocument();
    expect(within(stage).getByText("18ms")).toBeInTheDocument();
  });

  it("renders the react step duration badge inside the research stage", () => {
    render(<PipelineVisualizer trace={fullTrace()} />);
    const stage = expandStage(/Stage 1E — Research Agent & Tool Calls/);
    // Tool-call list and ReactStep both surface the 88ms tool execution time.
    expect(within(stage).getAllByText("88ms").length).toBeGreaterThan(0);
  });

  it("marks stages skipped when the guardrail blocks", () => {
    render(
      <PipelineVisualizer
        trace={{
          ...fullTrace(),
          guardrail: { passed: false, reason: "Out of domain", durationMs: 60 },
          finalAnswer: "**Out of Domain Detected:** ...",
          sources: [],
        }}
      />,
    );
    const stage = expandStage(/Stage 0B — Domain Guardrail/);
    expect(within(stage).getByText("Guardrail: BLOCKED")).toBeInTheDocument();
    expect(screen.getByText("out of domain", { exact: true })).toBeInTheDocument();
    const retrieval = expandStage(/Stage 1A\/B\/C\/D — Query Expansion & Hybrid Retrieval/);
    expect(
      within(retrieval).getByText("Pipeline short-circuited — downstream agents never ran."),
    ).toBeInTheDocument();
  });
});
