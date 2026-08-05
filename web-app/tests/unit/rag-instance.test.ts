import { vi, describe, it, expect, beforeEach } from "vitest";

type GlobalWithCounter = typeof globalThis & { __corpusInstances?: number };

vi.mock("@/server/rag/retrieval/corpus", () => ({
  PrismaCorpusProvider: class {
    constructor() {
      const g = globalThis as GlobalWithCounter;
      g.__corpusInstances = (g.__corpusInstances ?? 0) + 1;
    }
  },
}));
vi.mock("@/server/rag/retrieval/hybrid", () => ({
  HybridRetriever: class {
    corpusProvider: unknown;
    constructor(opts: { corpusProvider: unknown }) {
      this.corpusProvider = opts.corpusProvider;
    }
  },
}));
vi.mock("@/server/rag/retrieval/reranker", () => ({
  HfReranker: class {},
}));
vi.mock("@/server/embeddings/client", () => {
  class MockEmbeddingClient {}
  return {
    GeminiEmbeddingClient: MockEmbeddingClient,
    createDefaultEmbeddingClient: () => new MockEmbeddingClient(),
  };
});

import { getCorpusProvider, getHybridRetriever } from "@/server/rag/instance";
import type { HybridRetriever as HybridRetrieverType } from "@/server/rag/retrieval/hybrid";

describe("rag instance singletons", () => {
  beforeEach(() => {
    (globalThis as GlobalWithCounter).__corpusInstances = 0;
  });

  it("getCorpusProvider returns the same instance across calls", () => {
    const first = getCorpusProvider();
    const second = getCorpusProvider();
    expect(first).toBe(second);
  });

  it("getHybridRetriever builds and caches a retriever", () => {
    const first = getHybridRetriever() as HybridRetrieverType & { corpusProvider: unknown };
    const second = getHybridRetriever();
    expect(first).toBe(second);
    // The retriever reuses the same corpus provider singleton.
    expect(getCorpusProvider()).toBe(first.corpusProvider);
  });
});
