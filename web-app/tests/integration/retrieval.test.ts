import { vi, describe, it, expect, beforeEach } from "vitest";
import { HybridRetriever } from "@/server/rag/retrieval/hybrid";
import type { EmbeddingClient } from "@/server/embeddings/client";
import type { Reranker } from "@/server/rag/retrieval/reranker";
import type { Chunk } from "@/server/rag/types";
import { QUERY_EMBEDDING_PREFIX } from "@/server/rag/types";

vi.mock("@/server/db", async () => {
  const prisma = {
    $queryRaw: vi.fn(),
    documentChunk: {
      findMany: vi.fn(),
    },
  };
  return { prisma };
});

vi.mock("@/server/rag/retrieval/dense", async () => {
  const actual = await vi.importActual<typeof import("@/server/rag/retrieval/dense")>(
    "@/server/rag/retrieval/dense",
  );
  return {
    ...actual,
    denseRetrieve: vi.fn(),
  };
});

vi.mock("@/server/rag/retrieval/bm25", async () => {
  const actual = await vi.importActual<typeof import("@/server/rag/retrieval/bm25")>(
    "@/server/rag/retrieval/bm25",
  );
  return {
    ...actual,
    buildBm25: vi.fn(actual.buildBm25),
  };
});

import { prisma } from "@/server/db";
import { denseRetrieve } from "@/server/rag/retrieval/dense";
import { buildBm25 } from "@/server/rag/retrieval/bm25";

const mockedQueryRaw = vi.mocked(prisma.$queryRaw);
const mockedFindMany = vi.mocked(prisma.documentChunk.findMany);
const mockedDenseRetrieve = vi.mocked(denseRetrieve);
const mockedBuildBm25 = vi.mocked(buildBm25);

const mockEmbeddingClient: EmbeddingClient = {
  embedQuery: vi.fn(async (query: string) => {
    return Array.from({ length: 3 }, (_, i) => query.length + i * 0.1);
  }),
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
};

const mockReranker: Reranker = {
  rerank: vi.fn(async (_query: string, chunks: Chunk[], topK = 5) =>
    chunks.map((chunk, index) => ({ ...chunk, crossScore: 1 / (index + 1) })).slice(0, topK),
  ),
};

const corpus: Chunk[] = [
  {
    id: "1",
    documentId: "doc-a",
    sourceName: "doc-a",
    sourceUrl: "https://a.example",
    text: "Blocked account for German student visa is 11904 EUR per year.",
  },
  {
    id: "2",
    documentId: "doc-b",
    sourceName: "doc-b",
    sourceUrl: "https://b.example",
    text: "APS certificate required for Indian students.",
  },
  {
    id: "3",
    documentId: "doc-c",
    sourceName: "doc-c",
    sourceUrl: "https://c.example",
    text: "University admission requirements in Germany.",
  },
];

describe("HybridRetriever (pgvector + BM25 + RRF)", () => {
  let retriever: HybridRetriever;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFindMany.mockResolvedValue(
      corpus.map((chunk) => ({
        id: Number(chunk.id),
        documentId: chunk.documentId,
        sourceName: chunk.sourceName,
        sourceUrl: chunk.sourceUrl,
        text: chunk.text,
      })) as never,
    );
    // The Postgres FTS sparse path (vectorQueries.sparseSearch) is what the
    // hybrid retriever calls now; it reads rows shaped for ts_rank.
    mockedQueryRaw.mockResolvedValue([
      {
        id: 1,
        parentId: null,
        documentId: "doc-a",
        sourceName: "doc-a",
        sourceUrl: "https://a.example",
        text: corpus[0].text,
        rank: 0.9,
      },
    ] as never);
    mockedDenseRetrieve.mockResolvedValue([corpus[0]]);

    retriever = new HybridRetriever({
      embeddingClient: mockEmbeddingClient,
      reranker: mockReranker,
      corpusProvider: {
        loadChunks: vi.fn(async () => corpus),
      },
    });
  });

  it("should return top-k chunks for an in-domain query", async () => {
    const result = await retriever.retrieve("blocked account visa", ["blocked account visa"]);
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0].crossScore).toBeGreaterThan(0);
  });

  it("should apply RRF fusion across dense + sparse", async () => {
    const result = await retriever.retrieve("blocked account", ["blocked account"]);
    const ranked = result.chunks;
    expect(ranked.length).toBeGreaterThan(0);
  });

  it("should expose embedQuery for cache lookups", async () => {
    const vector = await retriever.embedQuery("test query");
    expect(Array.isArray(vector)).toBe(true);
  });

  it("embeds all sub-queries in one batched request (not per-query calls)", async () => {
    await retriever.retrieve("blocked account visa", ["blocked account visa", "Sperrkonto Visum"]);

    expect(mockEmbeddingClient.embedTexts).toHaveBeenCalledTimes(1);
    expect(mockEmbeddingClient.embedTexts).toHaveBeenCalledWith([
      `${QUERY_EMBEDDING_PREFIX}blocked account visa`,
      `${QUERY_EMBEDDING_PREFIX}Sperrkonto Visum`,
    ]);
    expect(mockEmbeddingClient.embedQuery).not.toHaveBeenCalled();
    expect(mockedDenseRetrieve).toHaveBeenCalledTimes(2);
  });

  it("runs sparse search in Postgres (FTS) without loading the full corpus", async () => {
    const result = await retriever.retrieve("blocked account visa", ["blocked account visa"]);
    // FTS path: corpus provider never loaded, telemetry says pg_fts, no corpus cost.
    expect(mockedQueryRaw).toHaveBeenCalled();
    expect(result.telemetry.sparseEngine).toBe("pg_fts");
    expect(result.telemetry.corpusLoadDurationMs).toBe(0);
  });

  it("falls back to in-process BM25 when Postgres FTS errors", async () => {
    mockedQueryRaw.mockRejectedValueOnce(new Error("relation does not exist"));
    const result = await retriever.retrieve("blocked account visa", ["blocked account visa"]);
    expect(result.telemetry.sparseEngine).toBe("bm25_inproc");
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it("reuses the memoized BM25 index across repeated fallback calls", async () => {
    mockedQueryRaw.mockRejectedValue(new Error("relation does not exist"));
    // A fresh array reference guarantees a cold WeakMap cache for this test.
    const freshCorpus = corpus.map((chunk) => ({ ...chunk }));
    const corpusProvider = { loadChunks: vi.fn(async () => freshCorpus) };
    const localRetriever = new HybridRetriever({
      embeddingClient: mockEmbeddingClient,
      reranker: mockReranker,
      corpusProvider,
    });

    await localRetriever.retrieve("blocked account visa", ["blocked account visa"]);
    await localRetriever.retrieve("APS certificate", ["APS certificate"]);

    // The WeakMap is keyed on the corpus reference, so the second fallback
    // call reuses the built index instead of rebuilding it.
    expect(mockedBuildBm25).toHaveBeenCalledTimes(1);
  });

  it("wide mode fetches 2x dense/sparse candidates and widens the rerank window", async () => {
    mockedDenseRetrieve.mockResolvedValue([corpus[0]]);
    mockedQueryRaw.mockResolvedValue([
      {
        id: 1,
        parentId: null,
        documentId: "doc-a",
        sourceName: "doc-a",
        sourceUrl: "https://a.example",
        text: corpus[0].text,
        rank: 0.9,
      },
    ] as never);

    await retriever.retrieve("Compare TU Berlin vs LMU vs FU Berlin", ["Compare TU Berlin"], 0, {
      wide: true,
    });

    // Dense top-K widened 15 → 30.
    expect(mockedDenseRetrieve).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ topK: 30, minSimilarity: expect.any(Number) }),
    );
    // Rerank window widened 5 → 12 (mock reranker honors topK).
    expect(mockReranker.rerank).toHaveBeenCalledWith(
      "Compare TU Berlin vs LMU vs FU Berlin",
      expect.any(Array),
      12,
    );
    // Telemetry records that wide retrieval ran.
    const result = await retriever.retrieve(
      "Compare TU Berlin vs LMU vs FU Berlin",
      ["Compare TU Berlin"],
      0,
      {
        wide: true,
      },
    );
    expect(result.telemetry.wideRetrieval).toBe(true);
  });

  it("default retrieval keeps the narrow 15/15/5 window and omits the wide telemetry flag", async () => {
    mockedDenseRetrieve.mockResolvedValue([corpus[0]]);
    mockedQueryRaw.mockResolvedValue([
      {
        id: 1,
        parentId: null,
        documentId: "doc-a",
        sourceName: "doc-a",
        sourceUrl: "https://a.example",
        text: corpus[0].text,
        rank: 0.9,
      },
    ] as never);

    const result = await retriever.retrieve("blocked account visa", ["blocked account visa"]);
    expect(mockedDenseRetrieve).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ topK: 15 }),
    );
    expect(mockReranker.rerank).toHaveBeenCalledWith("blocked account visa", expect.any(Array), 5);
    expect(result.telemetry.wideRetrieval).toBeUndefined();
  });

  it("triggers the CRAG web-fallback verdict when nothing survives reranking", async () => {
    const emptyReranker: Reranker = {
      rerank: vi.fn(async () => []),
    };
    const localRetriever = new HybridRetriever({
      embeddingClient: mockEmbeddingClient,
      reranker: emptyReranker,
      corpusProvider: { loadChunks: vi.fn(async () => corpus) },
    });

    const result = await localRetriever.retrieve("blocked account visa", ["blocked account visa"]);
    // No reranked chunk => crossScore falls back to 0 => gate fails => web search.
    expect(result.bestCrossScore).toBe(0);
    expect(result.needsWebFallback).toBe(true);
    expect(result.pathUsed).toBe("CRAG_CONFIDENCE_GATE_WEB_FALLBACK");
    expect(result.telemetry.cragFallbackTriggered).toBe(true);
  });
});
