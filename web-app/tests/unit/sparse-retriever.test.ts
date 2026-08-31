import { describe, it, expect, vi, beforeEach } from "vitest";
import { SparseRetriever } from "@/server/rag/retrieval/sparse";
import { buildBm25, type Bm25Search } from "@/server/rag/retrieval/bm25";
import { vectorQueries } from "@/server/db/vector-queries";
import type { Chunk } from "@/server/rag/types";
import { makeChunk } from "../helpers/chunk";

vi.mock("@/server/db/vector-queries", () => ({
  vectorQueries: {
    sparseSearch: vi.fn(),
  },
}));

vi.mock("@/server/rag/retrieval/bm25", () => ({
  buildBm25: vi.fn(),
}));

const mockedSparseSearch = vi.mocked(vectorQueries.sparseSearch);
const mockedBuildBm25 = vi.mocked(buildBm25);

const corpus: Chunk[] = [
  makeChunk("1", "blocked account germany"),
  makeChunk("2", "university admission berlin"),
];

describe("SparseRetriever", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to Postgres FTS when available and reports pg_fts", async () => {
    const ftsChunks = [makeChunk("1", "blocked account germany")];
    mockedSparseSearch.mockResolvedValue(ftsChunks);

    const retriever = new SparseRetriever({} as never, { loadChunks: vi.fn() });
    const outcome = await retriever.search("blocked account", 5);

    expect(vectorQueries.sparseSearch).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      chunks: ftsChunks,
      engine: "pg_fts",
      corpusLoadDurationMs: 0,
    });
  });

  it("falls back to in-process BM25 when Postgres FTS throws", async () => {
    mockedSparseSearch.mockRejectedValue(new Error("relation does not exist"));
    mockedBuildBm25.mockReturnValue({ search: (query) => chunkBm25Search(query) });

    const loadChunks = vi.fn().mockResolvedValue(corpus);
    const retriever = new SparseRetriever({} as never, { loadChunks });
    const outcome = await retriever.search("blocked account", 5);

    expect(loadChunks).toHaveBeenCalledTimes(1);
    expect(outcome.engine).toBe("bm25_inproc");
    expect(outcome.chunks.length).toBeGreaterThan(0);
    // The matched chunk should be the one with term overlap.
    expect(outcome.chunks[0].id).toBe("1");
  });

  it("builds the BM25 index once across repeated queries on the same corpus", async () => {
    mockedSparseSearch.mockRejectedValue(new Error("down"));
    const freshCorpus = [makeChunk("1", "blocked account germany")];
    const fakeBm25: Bm25Search = { search: (query) => chunkBm25Search(query) };
    mockedBuildBm25.mockReturnValue(fakeBm25);

    const retriever = new SparseRetriever({} as never, {
      loadChunks: vi.fn().mockResolvedValue(freshCorpus),
    });

    await retriever.search("blocked", 5);
    await retriever.search("university", 5);

    // Same corpus array reference → WeakMap cache hit → index built once.
    expect(mockedBuildBm25).toHaveBeenCalledTimes(1);
  });
});

/** Minimal in-test BM25 that scores by simple term overlap. */
function chunkBm25Search(query: string): Chunk[] {
  const tokens = new Set(query.toLowerCase().split(/\s+/));
  return corpus
    .map((chunk) => ({
      chunk,
      score:
        tokens.size > 0
          ? chunk.text.split(/\s+/).filter((t) => tokens.has(t.toLowerCase())).length
          : 0,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({ ...entry.chunk, bm25Score: entry.score }));
}
