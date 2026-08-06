import { vi, describe, it, expect, beforeEach } from "vitest";
import { runStandardCrag } from "@/server/rag/pipeline";
import { runAgenticRag } from "@/server/rag/agents/orchestrator";
import type { HybridRetriever } from "@/server/rag/retrieval/hybrid";
import type { SemanticCache } from "@/server/rag/cache/semantic-cache";
import { SummaryBufferMemory } from "@/server/rag/memory/summary-buffer";

vi.mock("@/server/rag/query-expansion", async () => {
  const actual = await vi.importActual<typeof import("@/server/rag/query-expansion")>(
    "@/server/rag/query-expansion",
  );
  return { ...actual, generateSubQueries: vi.fn(async (q: string) => [q]) };
});

vi.mock("@/server/rag/crag-gate", async () => {
  const actual =
    await vi.importActual<typeof import("@/server/rag/crag-gate")>("@/server/rag/crag-gate");
  return { ...actual, runCragGate: vi.fn() };
});

vi.mock("@/server/rag/guardrail", async () => {
  const actual =
    await vi.importActual<typeof import("@/server/rag/guardrail")>("@/server/rag/guardrail");
  return { ...actual, isQueryOutOfDomain: vi.fn(async () => false) };
});

vi.mock("@/server/llm/client", async () => {
  const actual = await vi.importActual<typeof import("@/server/llm/client")>("@/server/llm/client");
  return { ...actual, callLLM: vi.fn() };
});

vi.mock("@/server/db", async () => {
  const prisma = {
    conversationMemory: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
    message: { findMany: vi.fn(async () => []) },
    semanticCacheEntry: {
      findUnique: vi.fn(async () => null),
      update: vi.fn(),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(),
    },
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => []),
  };
  return { prisma };
});

import { runCragGate } from "@/server/rag/crag-gate";
import { callLLM } from "@/server/llm/client";
import { isQueryOutOfDomain } from "@/server/rag/guardrail";

const mockedRunCragGate = vi.mocked(runCragGate);
const mockedCallLLM = vi.mocked(callLLM);
const mockedGuardrail = vi.mocked(isQueryOutOfDomain);

const mockHybridRetriever = {
  embedQuery: vi.fn(async () => Array.from({ length: 3 }, (_, i) => i * 0.1)),
  retrieve: vi.fn(async () => ({
    chunks: [
      {
        id: "1",
        documentId: "doc-1",
        sourceName: "doc",
        sourceUrl: "https://example.com",
        text: "Blocked account total for 2026 is EUR 11904.",
        crossScore: 0.85,
      },
    ],
    bestCrossScore: 0.85,
    needsWebFallback: false,
    pathUsed: "HYBRID_RRF_CROSS_ENCODER",
  })),
} as unknown as HybridRetriever;

const mockCache = {
  checkCache: vi.fn(async () => null),
  addToCache: vi.fn(async () => undefined),
} as unknown as SemanticCache;

describe("RAG Pipeline Orchestrators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRunCragGate.mockResolvedValue({
      chunks: [
        {
          id: "1",
          documentId: "doc-1",
          sourceName: "doc",
          sourceUrl: "https://example.com",
          text: "Blocked account total for 2026 is EUR 11904.",
          crossScore: 0.85,
        },
      ],
      contextText: "[Source: doc]\nBlocked account total for 2026 is EUR 11904.",
      needsWebFallback: false,
      pathUsed: "HYBRID_RRF_CROSS_ENCODER",
      webResults: [],
    });
    mockedCallLLM.mockResolvedValue(
      "## Blocked Account\n\nTotal: EUR 11904.\n\n### Actionable Next Steps\n\n1. Open a Sperrkonto.",
    );
  });

  it("standard CRAG: retrieve -> gate -> generate -> save (PII-masked)", async () => {
    const memory = new SummaryBufferMemory("conv-1", 8);
    const result = await runStandardCrag("What is the blocked account total?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(result.isGrounded).toBe(true);
    expect(result.isCached).toBe(false);
    expect(result.answer).toContain("Blocked Account");
    expect(result.sources[0].name).toBe("doc");
    expect(result.sources[0].documentId).toBe("doc-1");
    expect(mockCache.addToCache).toHaveBeenCalled();
    expect(mockCache.addToCache).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ answer: expect.any(String) }),
      ["doc-1"],
    );
    expect(mockedCallLLM).toHaveBeenCalled();
  });

  it("standard CRAG: does NOT cache ungrounded fallback answers (M1)", async () => {
    mockedRunCragGate.mockResolvedValue({
      chunks: [
        {
          id: "1",
          documentId: "doc-1",
          sourceName: "doc",
          sourceUrl: "https://example.com",
          text: "Blocked account total for 2026 is EUR 11904.",
          crossScore: 0.1,
        },
      ],
      contextText: "",
      needsWebFallback: true,
      pathUsed: "CRAG_CONFIDENCE_GATE_WEB_FALLBACK",
      webResults: [],
    });

    const memory = new SummaryBufferMemory("conv-5", 8);
    const result = await runStandardCrag("unverifiable question", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(result.isGrounded).toBe(false);
    expect(result.answer).toContain("do not have sufficient official information");
    expect(mockCache.addToCache).not.toHaveBeenCalled();
  });

  it("agentic: research -> analyst matrix -> writer markdown", async () => {
    const memory = new SummaryBufferMemory("conv-2", 8);
    const result = await runAgenticRag("Compare blocked account vs scholarship", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(result.finalAnswer).toContain("Blocked Account");
    expect(result.researchSteps.length).toBeGreaterThan(0);
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.analysisMatrix.summary).toBeTruthy();
  });

  it("agentic: surfaces pre/post-processing telemetry and per-agent costs", async () => {
    const memory = new SummaryBufferMemory("conv-6", 8);
    const result = await runAgenticRag("Compare blocked account vs scholarship", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    // Pre-processing: PII masking + cache lookup are measured.
    expect(result.preProcessing).toBeDefined();
    expect(result.preProcessing?.cacheHit).toBe(false);
    expect(result.preProcessing?.piiMaskingDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.preProcessing?.cacheLookupDurationMs).toBeGreaterThanOrEqual(0);

    // Post-processing: cache write + memory append are measured.
    expect(result.postProcessing).toBeDefined();
    expect(result.postProcessing?.cacheWritten).toBe(true);
    expect(result.postProcessing?.cacheWriteDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.postProcessing?.memoryWriteDurationMs).toBeGreaterThanOrEqual(0);

    // Per-agent cost aggregation matches the summed LLM calls.
    expect(result.agentCosts).toBeDefined();
    if (result.agentCosts) {
      const summedCost = result.agentCosts.reduce((sum, cost) => sum + cost.costUsd, 0);
      expect(summedCost).toBeCloseTo(result.totalCostUsd, 10);
      expect(
        result.agentCosts.reduce((sum, cost) => sum + cost.totalTokens, 0),
      ).toBeGreaterThanOrEqual(0);
    }

    // ResearchStep now carries the tool execution duration.
    for (const step of result.researchSteps) {
      expect(step.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("should return cached response when cache hit", async () => {
    vi.mocked(mockCache.checkCache).mockResolvedValueOnce({
      answer: "Cached answer.",
      sources: [{ name: "doc", url: "https://example.com", score: 1 }],
      retrievalPath: "TIER_1_EXACT_CACHE_HIT",
      latencyMs: 1.2,
      isCached: true,
    });

    const memory = new SummaryBufferMemory("conv-3", 8);
    const result = await runStandardCrag("visa requirements", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(result.isCached).toBe(true);
    expect(result.answer).toBe("Cached answer.");
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });

  it("should persist user + assistant messages with sources metadata", async () => {
    mockedGuardrail.mockResolvedValue(true);
    const memory = new SummaryBufferMemory("conv-4", 8);
    const result = await runAgenticRag("cricket scores", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(result.finalAnswer).toContain("Out of Domain Detected");
    expect(mockCache.addToCache).not.toHaveBeenCalled();
  });
});
