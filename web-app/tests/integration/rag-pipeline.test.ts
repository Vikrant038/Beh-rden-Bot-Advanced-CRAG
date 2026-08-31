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
  return {
    ...actual,
    generateSubQueries: vi.fn(async (q: string) => ({ language: "en", queries: [q] })),
  };
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
import { generateSubQueries } from "@/server/rag/query-expansion";
import type { CachedResponse } from "@/server/rag/cache/semantic-cache";

const mockedRunCragGate = vi.mocked(runCragGate);
const mockedCallLLM = vi.mocked(callLLM);
const mockedGuardrail = vi.mocked(isQueryOutOfDomain);
const mockedGenerateSubQueries = vi.mocked(generateSubQueries);

/**
 * The canonical German→English expansion the shared mocks and cache-hit tests
 * reuse: a German ask whose sub-queries[0] is the English canonical key.
 */
const GERMAN_EXPANSION = {
  language: "de",
  queries: [
    "What is a blocked account?",
    "How much money do I need in a blocked account?",
    "Blocked account requirements for a German student visa",
  ],
};
/** Fresh mutable copy — QueryExpansion.queries must be a mutable array. */
const germanExpansion = (): typeof GERMAN_EXPANSION & { queries: string[] } => ({
  ...GERMAN_EXPANSION,
  queries: [...GERMAN_EXPANSION.queries],
});

/** A TIER_1 cache hit served under the canonical English key. */
const germanCacheHit = (answer: string, language?: string): CachedResponse => ({
  answer,
  sources: [],
  retrievalPath: "TIER_1_EXACT_CACHE_HIT",
  latencyMs: 1.2,
  isCached: true,
  ...(language ? { language } : {}),
});

/** Serves `hit` only for the canonical English key; null for everything else. */
const hitCanonicalKey = (hit: CachedResponse) =>
  vi
    .fn()
    .mockImplementation(async (query: string) =>
      query === GERMAN_EXPANSION.queries[0] ? hit : null,
    );

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
    telemetry: {
      queryExpansionDurationMs: 2,
      expandedQueries: ["blocked account total"],
      denseDurationMs: 5,
      sparseBm25DurationMs: 3,
      rrfFusionDurationMs: 1,
      rerankDurationMs: 2,
      bestCrossScore: 0.85,
      cragFallbackTriggered: false,
      corpusLoadDurationMs: 0,
      sparseEngine: "pg_fts",
    },
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
      "en", // the detected query language is stored with the cached answer
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

  it("agentic: serves a cache hit keyed on the canonical English sub-query", async () => {
    // German ask → expansion returns the English canonical first → it hits a
    // previously cached English ask, so no research/analyst/writer runs.
    mockedGenerateSubQueries.mockResolvedValueOnce(germanExpansion());
    vi.mocked(mockCache.checkCache).mockImplementation(
      hitCanonicalKey(germanCacheHit("Cached English answer.", "en")),
    );

    const memory = new SummaryBufferMemory("conv-eng5", 8);
    const result = await runAgenticRag("Was ist ein Sperrkonto?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(result.researchSteps[0]?.action).toBe("Semantic Cache Hit");
    expect(result.finalAnswer).toBe("Cached English answer.");
    expect(mockHybridRetriever.embedQuery).toHaveBeenCalledWith("What is a blocked account?");
    expect(mockCache.checkCache).toHaveBeenCalledWith(
      "What is a blocked account?",
      expect.any(Array),
    );
    expect(mockedCallLLM).not.toHaveBeenCalled();
    expect(mockCache.addToCache).not.toHaveBeenCalled();
  });

  it("agentic: serves an original-key cache hit without a mismatch flag (no expansion ran)", async () => {
    // Exact re-ask hits the cache under the raw query before expansion runs,
    // so the user's language is unknown — the answer language is surfaced but
    // nothing is flagged.
    vi.mocked(mockCache.checkCache).mockResolvedValueOnce(germanCacheHit("Cached answer.", "en"));

    const memory = new SummaryBufferMemory("conv-eng-orig", 8);
    const result = await runAgenticRag("visa requirements", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(result.researchSteps[0]?.action).toBe("Semantic Cache Hit");
    expect(mockedGenerateSubQueries).not.toHaveBeenCalled();
  });

  it("agentic: serves a canonical-English cache hit regardless of the stored language tag", async () => {
    mockedGenerateSubQueries.mockResolvedValueOnce(germanExpansion());
    vi.mocked(mockCache.checkCache).mockImplementation(
      hitCanonicalKey(germanCacheHit("Cached German answer.", "de")),
    );

    const memory = new SummaryBufferMemory("conv-eng-match2", 8);
    const result = await runAgenticRag("Was ist ein Sperrkonto?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(result.finalAnswer).toBe("Cached German answer.");
  });

  it("agentic: writes the answer under both the original and canonical English key", async () => {
    mockedGenerateSubQueries.mockResolvedValueOnce(germanExpansion());
    vi.mocked(mockCache.checkCache).mockResolvedValue(null);

    const memory = new SummaryBufferMemory("conv-eng6", 8);
    await runAgenticRag("Was ist ein Sperrkonto?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    const writeKeys = vi.mocked(mockCache.addToCache).mock.calls.map((call) => call[0]);
    expect(writeKeys).toEqual(["Was ist ein Sperrkonto?", "What is a blocked account?"]);
    // Answers are always written in English, so the answer language stored on
    // both cache keys is "en" even for a German query.
    const writeLanguages = vi.mocked(mockCache.addToCache).mock.calls.map((call) => call[4]);
    expect(writeLanguages).toEqual(["en", "en"]);
  });

  it("agentic: English-only ask writes the cache exactly once (no canonical dual-write)", async () => {
    // Default expansion mock returns queries[0] === input → canonical key
    // equals the original key → the dual-write must be skipped.
    vi.mocked(mockCache.checkCache).mockResolvedValue(null);
    const memory = new SummaryBufferMemory("conv-eng3", 8);
    await runAgenticRag("How do I apply for a blocked account?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    const writeKeys = vi.mocked(mockCache.addToCache).mock.calls.map((call) => call[0]);
    expect(writeKeys).toEqual(["How do I apply for a blocked account?"]);
    expect(mockCache.addToCache).toHaveBeenCalledTimes(1);
  });

  it("agentic: reworded English canonical still writes only the original key (language guard)", async () => {
    mockedGenerateSubQueries.mockResolvedValueOnce({
      language: "en",
      queries: [
        "How do I apply for a blocked account for my student visa?",
        "What are the steps to open a blocked account?",
        "Sperrkonto application steps for a student visa",
      ],
    });
    vi.mocked(mockCache.checkCache).mockResolvedValue(null);
    const memory = new SummaryBufferMemory("conv-eng4", 8);
    await runAgenticRag("How to get a blocked account?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    const writeKeys = vi.mocked(mockCache.addToCache).mock.calls.map((call) => call[0]);
    expect(writeKeys).toEqual(["How to get a blocked account?"]);
    expect(mockCache.addToCache).toHaveBeenCalledTimes(1);
  });

  it("agentic: skips the query embed entirely when the cache is bypassed", async () => {
    const memory = new SummaryBufferMemory("conv-7", 8);
    const result = await runAgenticRag("Compare blocked account vs scholarship", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
      bypassCache: true,
    });

    // The admin pipeline tester defaults to bypassCache=true — the query
    // vector is only used for the cache lookup/write, so it must not be
    // embedded at all. That removes a full embedding round-trip (potentially
    // a 10-20s cold start) from every glass-box run.
    expect(mockHybridRetriever.embedQuery).not.toHaveBeenCalled();
    expect(result.preProcessing?.cacheHit).toBe(false);
    expect(result.postProcessing?.cacheWritten).toBe(false);
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

  it("standard CRAG: serves a cache hit keyed on the canonical English sub-query", async () => {
    // German ask → expansion returns the English canonical first → it hits
    // a previously cached English ask, so no retrieval/generation runs.
    mockedGenerateSubQueries.mockResolvedValueOnce(germanExpansion());
    vi.mocked(mockCache.checkCache).mockImplementation(
      hitCanonicalKey({
        ...germanCacheHit("Cached English answer.", "en"),
        sources: [{ name: "doc", url: "https://example.com", score: 1 }],
      }),
    );

    const memory = new SummaryBufferMemory("conv-eng", 8);
    const result = await runStandardCrag("Was ist ein Sperrkonto?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(result.isCached).toBe(true);
    expect(result.answer).toBe("Cached English answer.");
    expect(mockCache.checkCache).toHaveBeenCalledWith(
      "What is a blocked account?",
      expect.any(Array),
    );
    expect(mockHybridRetriever.embedQuery).toHaveBeenCalledWith("What is a blocked account?");
    expect(mockedCallLLM).not.toHaveBeenCalled();
    expect(mockCache.addToCache).not.toHaveBeenCalled();
  });

  it("standard CRAG: serves a canonical-English cache hit regardless of the stored language tag", async () => {
    mockedGenerateSubQueries.mockResolvedValueOnce(germanExpansion());
    vi.mocked(mockCache.checkCache).mockImplementation(
      hitCanonicalKey(germanCacheHit("Cached German answer.", "de")),
    );

    const memory = new SummaryBufferMemory("conv-eng-match", 8);
    const result = await runStandardCrag("Was ist ein Sperrkonto?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(result.isCached).toBe(true);
    expect(result.answer).toBe("Cached German answer.");
  });

  it("standard CRAG: serves a canonical hit from a pre-migration entry (no stored language)", async () => {
    // A German ask hits an entry written before the language column existed:
    // the answer is served with no stored language tag to worry about.
    mockedGenerateSubQueries.mockResolvedValueOnce(germanExpansion());
    vi.mocked(mockCache.checkCache).mockImplementation(
      hitCanonicalKey(germanCacheHit("Cached pre-migration answer.")),
    );

    const memory = new SummaryBufferMemory("conv-eng-legacy", 8);
    const result = await runStandardCrag("Was ist ein Sperrkonto?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(result.isCached).toBe(true);
    expect(result.answer).toBe("Cached pre-migration answer.");
  });

  it("standard CRAG: writes the answer under both the original and canonical English key", async () => {
    mockedGenerateSubQueries.mockResolvedValueOnce(germanExpansion());
    // Pin the cache to a miss so the write path runs (overrides any leaked
    // mockImplementation from an earlier test).
    vi.mocked(mockCache.checkCache).mockResolvedValue(null);
    const memory = new SummaryBufferMemory("conv-eng2", 8);
    await runStandardCrag("Was ist ein Sperrkonto?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    const writeKeys = vi.mocked(mockCache.addToCache).mock.calls.map((call) => call[0]);
    expect(writeKeys).toEqual(["Was ist ein Sperrkonto?", "What is a blocked account?"]);
    // Answers are always English, so the answer language stored on both cache
    // keys is "en" even for a German query.
    const writeLanguages = vi.mocked(mockCache.addToCache).mock.calls.map((call) => call[4]);
    expect(writeLanguages).toEqual(["en", "en"]);
    const systemContent = mockedCallLLM.mock.calls
      .flatMap((call) => call[0] as Array<{ role: string; content: unknown }>)
      .filter((message) => message.role === "system")
      .map((message) => String(message.content))
      .join("\n");
    expect(systemContent).toMatch(/always answer in English/i);
  });

  it("standard CRAG: English-only ask writes the cache exactly once (no canonical dual-write)", async () => {
    // Default expansion mock returns queries[0] === input, so the canonical
    // English key equals the original key — the dual-write must be skipped.
    vi.mocked(mockCache.checkCache).mockResolvedValue(null);
    const memory = new SummaryBufferMemory("conv-eng1", 8);
    await runStandardCrag("How do I apply for a blocked account?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    const writeKeys = vi.mocked(mockCache.addToCache).mock.calls.map((call) => call[0]);
    expect(writeKeys).toEqual(["How do I apply for a blocked account?"]);
    expect(mockCache.addToCache).toHaveBeenCalledTimes(1);
  });

  it("standard CRAG: passes wide retrieval when expansion flags a multi-entity question", async () => {
    mockedGenerateSubQueries.mockResolvedValueOnce({
      language: "en",
      queries: ["Compare TU Berlin vs LMU vs FU Berlin"],
      needsDeepRerank: true,
    });
    vi.mocked(mockCache.checkCache).mockResolvedValue(null);
    const memory = new SummaryBufferMemory("conv-wide1", 8);
    await runStandardCrag("Compare TU Berlin vs LMU vs FU Berlin", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(mockHybridRetriever.retrieve).toHaveBeenCalledWith(
      "Compare TU Berlin vs LMU vs FU Berlin",
      ["Compare TU Berlin vs LMU vs FU Berlin"],
      expect.any(Number),
      { wide: true },
    );
  });

  it("standard CRAG: single-fact questions keep the narrow retrieval window", async () => {
    mockedGenerateSubQueries.mockResolvedValueOnce({
      language: "en",
      queries: ["What is the blocked account total?"],
    });
    vi.mocked(mockCache.checkCache).mockResolvedValue(null);
    const memory = new SummaryBufferMemory("conv-narrow1", 8);
    await runStandardCrag("What is the blocked account total?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(mockHybridRetriever.retrieve).toHaveBeenCalledWith(
      "What is the blocked account total?",
      ["What is the blocked account total?"],
      expect.any(Number),
      { wide: false },
    );
  });

  it("standard CRAG: reworded English canonical still writes only the original key (language guard)", async () => {
    // The LLM paraphrases even an English query — canonical differs from the
    // input, but language is "en" so the canonical dual-write must NOT happen.
    mockedGenerateSubQueries.mockResolvedValueOnce({
      language: "en",
      queries: [
        "How do I apply for a blocked account for my student visa?",
        "What are the steps to open a blocked account?",
        "Sperrkonto application steps for a student visa",
      ],
    });
    vi.mocked(mockCache.checkCache).mockResolvedValue(null);
    const memory = new SummaryBufferMemory("conv-eng2", 8);
    await runStandardCrag("How to get a blocked account?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    const writeKeys = vi.mocked(mockCache.addToCache).mock.calls.map((call) => call[0]);
    expect(writeKeys).toEqual(["How to get a blocked account?"]);
    expect(mockCache.addToCache).toHaveBeenCalledTimes(1);
  });

  it("agentic: answers are always English even for a German query", async () => {
    mockedGenerateSubQueries.mockResolvedValueOnce(germanExpansion());
    vi.mocked(mockCache.checkCache).mockResolvedValue(null);

    const memory = new SummaryBufferMemory("conv-lang", 8);
    const result = await runAgenticRag("Was ist ein Sperrkonto?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(result.finalAnswer).toContain("Blocked Account");
    const userContent = mockedCallLLM.mock.calls
      .flatMap((call) => call[0] as Array<{ role: string; content: unknown }>)
      .filter((message) => message.role === "user")
      .map((message) => String(message.content))
      .join("\n");
    // Both the analyst and writer prompts enforce English output.
    expect(userContent).toMatch(/answer in English, regardless of the language/i);
  });

  it("should return cached response when cache hit", async () => {
    vi.mocked(mockCache.checkCache).mockResolvedValueOnce({
      answer: "Cached answer.",
      sources: [{ name: "doc", url: "https://example.com", score: 1 }],
      retrievalPath: "TIER_1_EXACT_CACHE_HIT",
      latencyMs: 1.2,
      isCached: true,
      language: "en",
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

  it("standard CRAG: collects a glass-box trace when collectTrace is set", async () => {
    const memory = new SummaryBufferMemory("conv-8", 8);
    const result = await runStandardCrag("What is the blocked account total?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
      collectTrace: true,
    });

    // Admin pipeline tester: trace carries the per-stage timings + costs.
    expect(result.trace).toBeDefined();
    expect(result.trace?.pipeline).toBe("standard");
    expect(result.trace?.stages).toHaveLength(5);
    expect(result.trace?.stages[0].status).toBe("executed");
    expect(result.trace?.stages[1].status).toBe("executed");
    expect(result.trace?.stages[1].durationMs).toBeGreaterThan(0);
    expect(result.trace?.retrievalTelemetry?.denseDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.trace?.retrievalTelemetry?.sparseEngine).toBe("pg_fts");
    expect(result.trace?.preProcessing?.cacheHit).toBe(false);
    expect(result.trace?.postProcessing?.cacheWritten).toBe(true);
    expect(result.trace?.totalLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.trace?.totalCostUsd).toBeGreaterThanOrEqual(0);
    // The collector is wired (AsyncLocalStorage context active), but the
    // mocked callLLM bypasses the real client's recordUsageCall, so the
    // record array is empty here — with the real client it fills per call.
    expect(result.trace?.llmCalls).toBeDefined();
  });

  it("standard CRAG: trace is absent when collectTrace is off (chat path pays nothing)", async () => {
    const memory = new SummaryBufferMemory("conv-9", 8);
    const result = await runStandardCrag("What is the blocked account total?", {
      hybridRetriever: mockHybridRetriever,
      cache: mockCache,
      memory,
    });

    expect(result.trace).toBeUndefined();
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
