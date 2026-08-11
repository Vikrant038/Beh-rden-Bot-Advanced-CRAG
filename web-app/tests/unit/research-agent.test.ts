import { vi, describe, it, expect, beforeEach } from "vitest";
import { agentResearchReact } from "@/server/rag/agents/research";
import type { HybridRetriever } from "@/server/rag/retrieval/hybrid";
import type { Chunk, PipelineEvent } from "@/server/rag/types";

vi.mock("@/server/rag/query-expansion", () => ({
  generateSubQueries: vi.fn(async (_query: string) => ({
    language: "en",
    queries: ["subquery-0", "subquery-1", "subquery-2"],
  })),
}));

vi.mock("@/server/rag/tools/web-search", () => ({
  webSearch: vi.fn(),
}));

vi.mock("@/server/rag/tools/visa-calculator", () => ({
  calculateVisaRequirements: vi.fn(() => ({
    summary: "Blocked account: EUR 11,904 (2026)",
  })),
}));

import { webSearch } from "@/server/rag/tools/web-search";
import { calculateVisaRequirements } from "@/server/rag/tools/visa-calculator";
import { generateSubQueries } from "@/server/rag/query-expansion";

const mockedWebSearch = vi.mocked(webSearch);
const mockedCalculator = vi.mocked(calculateVisaRequirements);
const mockedGenerateSubQueries = vi.mocked(generateSubQueries);

function makeChunk(overrides: Partial<Chunk> = {}): Chunk {
  return {
    id: "chunk-1",
    documentId: "doc-1",
    sourceName: "src",
    sourceUrl: "https://example.com",
    text: "German visa text about the Aufenthaltsgesetz.",
    ...overrides,
  };
}

function makeRetriever(overrides: Partial<HybridRetriever> = {}): HybridRetriever {
  return {
    embedQuery: vi.fn(),
    retrieve: vi.fn(async () => ({
      chunks: [],
      bestCrossScore: 0,
      needsWebFallback: true,
      pathUsed: "CRAG_CONFIDENCE_GATE_WEB_FALLBACK",
      telemetry: {
        queryExpansionDurationMs: 1,
        expandedQueries: [],
        denseDurationMs: 1,
        sparseBm25DurationMs: 1,
        rrfFusionDurationMs: 1,
        rerankDurationMs: 1,
        bestCrossScore: 0,
        cragFallbackTriggered: true,
        corpusLoadDurationMs: 0,
        sparseEngine: "pg_fts",
      },
    })),
    ...overrides,
  } as unknown as HybridRetriever;
}

describe("agentResearchReact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedWebSearch.mockResolvedValue([
      { title: "Web result", url: "https://web.example", snippet: "A snippet" },
    ]);
  });

  it("runs hybrid retrieval and collects chunk context + sources", async () => {
    const retrieve = vi.fn(async () => ({
      chunks: [
        makeChunk({
          id: "c1",
          sourceName: "Doc A",
          sourceUrl: "https://a",
          text: "text-a",
          crossScore: 0.8,
        }),
      ],
      bestCrossScore: 0.8,
      needsWebFallback: false,
      pathUsed: "HYBRID_RRF_CROSS_ENCODER",
      telemetry: {
        queryExpansionDurationMs: 1,
        expandedQueries: ["q"],
        denseDurationMs: 1,
        sparseBm25DurationMs: 1,
        rrfFusionDurationMs: 1,
        rerankDurationMs: 1,
        bestCrossScore: 0.8,
        cragFallbackTriggered: false,
        corpusLoadDurationMs: 0,
        sparseEngine: "pg_fts" as const,
      },
    }));
    const retriever = makeRetriever({ retrieve });

    const result = await agentResearchReact("APS certificate", retriever);

    expect(retrieve).toHaveBeenCalled();
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      name: "Doc A",
      url: "https://a",
      score: 0.8,
      documentId: "doc-1",
      childText: undefined,
      parentText: "text-a",
    });
    expect(result.combinedContext).toContain("text-a");
    expect(result.researchSteps[0]).toMatchObject({ iteration: 1, action: "tool_vector_search" });
    expect(result.toolCalls[0]).toMatchObject({ tool: "hybrid_retrieval", status: "success" });
    expect(mockedWebSearch).not.toHaveBeenCalled();
  });

  it("falls back to web search when no local chunks pass the threshold", async () => {
    const retriever = makeRetriever();
    const result = await agentResearchReact("obscure question", retriever);

    expect(mockedWebSearch).toHaveBeenCalledWith("obscure question", 3);
    expect(result.researchSteps[0]).toMatchObject({ action: "tool_web_search" });
    expect(result.combinedContext).toContain("[WEB]:");
    expect(result.sources[0]).toMatchObject({
      name: "Web result",
      url: "https://web.example",
      score: 0.7,
    });
    expect(result.toolCalls).toContainEqual(
      expect.objectContaining({ tool: "web_search", status: "success" }),
    );
  });

  it("prepends conversation memory when sessionMemory is provided", async () => {
    const retriever = makeRetriever();
    const result = await agentResearchReact("query", retriever, "User: asking about visa");
    expect(result.combinedContext).toContain("[CONVERSATION HISTORY]:");
    expect(result.combinedContext).toContain("User: asking about visa");
  });

  it("runs a secondary retrieval pass for comparative queries", async () => {
    const retrieve = vi.fn(async () => ({
      chunks: [makeChunk({ id: "c1", text: "text-a" })],
      bestCrossScore: 0.8,
      needsWebFallback: false,
      pathUsed: "HYBRID_RRF_CROSS_ENCODER",
      telemetry: {
        queryExpansionDurationMs: 1,
        expandedQueries: [],
        denseDurationMs: 1,
        sparseBm25DurationMs: 1,
        rrfFusionDurationMs: 1,
        rerankDurationMs: 1,
        bestCrossScore: 0.8,
        cragFallbackTriggered: false,
        corpusLoadDurationMs: 0,
        sparseEngine: "pg_fts" as const,
      },
    }));
    const retriever = makeRetriever({ retrieve });

    const result = await agentResearchReact("A vs B comparison", retriever);

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(result.researchSteps).toContainEqual(
      expect.objectContaining({ iteration: 2, action: "tool_vector_search(sub_query)" }),
    );
    expect(result.toolCalls).toContainEqual(
      expect.objectContaining({
        tool: "hybrid_retrieval",
        query: "A vs B comparison requirements breakdown",
      }),
    );
  });

  it("invokes the visa calculator for financial queries", async () => {
    const retriever = makeRetriever();
    const result = await agentResearchReact("what is the blocked account cost", retriever);

    expect(mockedCalculator).toHaveBeenCalled();
    expect(result.combinedContext).toContain("[CRITICAL CALCULATED FINANCIAL SUMMARY]:");
    expect(result.researchSteps).toContainEqual(
      expect.objectContaining({ action: "tool_visa_calculator" }),
    );
    expect(result.toolCalls).toContainEqual(
      expect.objectContaining({ tool: "visa_calculator", status: "success" }),
    );
  });

  it("uses the precomputed expansion when provided (no re-expansion)", async () => {
    const retrieve = vi.fn(async () => ({
      chunks: [],
      bestCrossScore: 0,
      needsWebFallback: true,
      pathUsed: "CRAG_CONFIDENCE_GATE_WEB_FALLBACK",
      telemetry: {
        queryExpansionDurationMs: 1,
        expandedQueries: [],
        denseDurationMs: 1,
        sparseBm25DurationMs: 1,
        rrfFusionDurationMs: 1,
        rerankDurationMs: 1,
        bestCrossScore: 0,
        cragFallbackTriggered: true,
        corpusLoadDurationMs: 0,
        sparseEngine: "pg_fts" as const,
      },
    }));
    const retriever = makeRetriever({ retrieve });

    await agentResearchReact("Was ist ein Sperrkonto?", retriever, "", undefined, {
      language: "de",
      queries: ["What is a blocked account?", "Blocked account deposit amount", "Sperrkonto rules"],
    });

    expect(mockedGenerateSubQueries).not.toHaveBeenCalled();
    // The rerank query is the CANONICAL ENGLISH form (queries[0]), not the raw
    // German user query — the cross-encoder is English-only.
    expect(retrieve).toHaveBeenCalledWith(
      "What is a blocked account?",
      ["What is a blocked account?", "Blocked account deposit amount", "Sperrkonto rules"],
      expect.any(Number),
      { wide: false },
    );
  });

  it("widens retrieval when the expansion flags a multi-entity/synthesis question", async () => {
    const retrieve = vi.fn(async () => ({
      chunks: [],
      bestCrossScore: 0,
      needsWebFallback: true,
      pathUsed: "CRAG_CONFIDENCE_GATE_WEB_FALLBACK",
      telemetry: {
        queryExpansionDurationMs: 1,
        expandedQueries: [],
        denseDurationMs: 1,
        sparseBm25DurationMs: 1,
        rrfFusionDurationMs: 1,
        rerankDurationMs: 1,
        bestCrossScore: 0,
        cragFallbackTriggered: true,
        corpusLoadDurationMs: 0,
        sparseEngine: "pg_fts" as const,
      },
    }));
    const retriever = makeRetriever({ retrieve });

    await agentResearchReact("Compare TU Berlin vs LMU vs FU Berlin", retriever, "", undefined, {
      language: "en",
      queries: ["Compare TU Berlin vs LMU vs FU Berlin"],
      needsDeepRerank: true,
    });

    expect(retrieve).toHaveBeenCalledWith(
      "Compare TU Berlin vs LMU vs FU Berlin",
      ["Compare TU Berlin vs LMU vs FU Berlin"],
      expect.any(Number),
      { wide: true },
    );
    // Comparative trigger also widens the secondary pass.
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(retrieve).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.any(Array),
      expect.any(Number),
      { wide: true },
    );
  });

  it("emits stage_start/stage_end pipeline events around query expansion and retrieval", async () => {
    const events: PipelineEvent[] = [];
    const retriever = makeRetriever();
    await agentResearchReact("query", retriever, "", (event) => events.push(event));

    const starts = events.filter((event) => event.type === "stage_start");
    expect(starts.map((event) => (event as { stage: string }).stage)).toEqual([
      "query_expansion",
      "dense_retrieval",
    ]);
    const ends = events.filter((event) => event.type === "stage_end");
    expect(ends).toHaveLength(2);
  });
});
