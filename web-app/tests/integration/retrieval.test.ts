import { vi, describe, it, expect, beforeEach } from "vitest";
import { HybridRetriever } from "@/server/rag/retrieval/hybrid";
import type { EmbeddingClient } from "@/server/embeddings/client";
import type { Reranker } from "@/server/rag/retrieval/reranker";
import type { Chunk } from "@/server/rag/types";

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

import { prisma } from "@/server/db";
import { denseRetrieve } from "@/server/rag/retrieval/dense";

const mockedQueryRaw = vi.mocked(prisma.$queryRaw);
const mockedFindMany = vi.mocked(prisma.documentChunk.findMany);
const mockedDenseRetrieve = vi.mocked(denseRetrieve);

const mockEmbeddingClient: EmbeddingClient = {
  embedQuery: vi.fn(async (query: string) => {
    return Array.from({ length: 3 }, (_, i) => query.length + i * 0.1);
  }),
  embedTexts: vi.fn(async () => []),
};

const mockReranker: Reranker = {
  rerank: vi.fn(async (_query: string, chunks: Chunk[], topK = 5) =>
    chunks.map((chunk, index) => ({ ...chunk, crossScore: 1 / (index + 1) })).slice(0, topK),
  ),
};

const corpus: Chunk[] = [
  {
    id: "1",
    sourceName: "doc-a",
    sourceUrl: "https://a.example",
    text: "Blocked account for German student visa is 11904 EUR per year.",
  },
  {
    id: "2",
    sourceName: "doc-b",
    sourceUrl: "https://b.example",
    text: "APS certificate required for Indian students.",
  },
  {
    id: "3",
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
        sourceName: chunk.sourceName,
        sourceUrl: chunk.sourceUrl,
        text: chunk.text,
      })) as never,
    );
    mockedQueryRaw.mockResolvedValue([
      {
        id: 1,
        sourceName: "doc-a",
        sourceUrl: "https://a.example",
        text: corpus[0].text,
        sim: 0.95,
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
});
