import { vi, describe, it, expect, beforeEach } from "vitest";
import { HfReranker } from "@/server/rag/retrieval/reranker";
import type { Chunk } from "@/server/rag/types";

function makeChunk(id: string, text: string): Chunk {
  return { id, sourceName: "doc", sourceUrl: "https://example.com", text };
}

const mockFetch = vi.fn();

describe("HfReranker", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  it("should return empty for no chunks", async () => {
    const reranker = new HfReranker("model", "https://hf.example", "token");
    expect(await reranker.rerank("query", [])).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should reorder chunks by cross score descending and sigmoid-transform", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [[2.0, -2.0, 0.0]],
    });
    const reranker = new HfReranker("model", "https://hf.example", "token");
    const chunks = [
      makeChunk("a", "alpha content"),
      makeChunk("b", "beta content"),
      makeChunk("c", "gamma content"),
    ];
    const reranked = await reranker.rerank("query", chunks, 5);

    expect(reranked).toHaveLength(3);
    expect(reranked[0].id).toBe("a");
    expect(reranked[1].id).toBe("c");
    expect(reranked[2].id).toBe("b");

    // sigmoid(2.0) > sigmoid(0.0) > sigmoid(-2.0)
    expect(reranked[0].crossScore).toBeGreaterThan(reranked[1].crossScore ?? 0);
    expect(reranked[1].crossScore).toBeGreaterThan(reranked[2].crossScore ?? 0);
    expect(reranked[0].crossScore).toBeGreaterThan(0.5);
  });

  it("should respect topK limit", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [[3.0, 2.0, 1.0, 0.0]],
    });
    const reranker = new HfReranker("model", "https://hf.example", "token");
    const chunks = [
      makeChunk("a", "a"),
      makeChunk("b", "b"),
      makeChunk("c", "c"),
      makeChunk("d", "d"),
    ];
    const reranked = await reranker.rerank("query", chunks, 2);
    expect(reranked).toHaveLength(2);
  });

  it("should fall back to original ranking when API fails", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const reranker = new HfReranker("model", "https://hf.example", "token");
    const chunks = [makeChunk("a", "a"), makeChunk("b", "b")];
    const reranked = await reranker.rerank("query", chunks, 5);
    expect(reranked).toHaveLength(2);
    expect(reranked[0].id).toBe("a");
  });

  it("should fall back to original ranking when no token configured", async () => {
    const reranker = new HfReranker("model", "https://hf.example", "");
    const chunks = [makeChunk("a", "a")];
    const reranked = await reranker.rerank("query", chunks, 5);
    expect(reranked[0].id).toBe("a");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should parse nested object score shape", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        [{ score: 3.0, label: "LABEL_1" }],
        [{ score: 1.0, label: "LABEL_0" }],
        [{ score: 2.0, label: "LABEL_1" }],
      ],
    });
    const reranker = new HfReranker("model", "https://hf.example", "token");
    const chunks = [makeChunk("a", "a"), makeChunk("b", "b"), makeChunk("c", "c")];
    const reranked = await reranker.rerank("query", chunks, 5);
    expect(reranked[0].id).toBe("a");
    expect(reranked[2].id).toBe("b");
  });

  it("should parse scores array on response object", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ scores: [0.5, 2.5, 1.5] }),
    });
    const reranker = new HfReranker("model", "https://hf.example", "token");
    const chunks = [makeChunk("a", "a"), makeChunk("b", "b"), makeChunk("c", "c")];
    const reranked = await reranker.rerank("query", chunks, 5);
    expect(reranked[0].id).toBe("b");
  });

  it("should fall back when response is malformed", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: true }),
    });
    const reranker = new HfReranker("model", "https://hf.example", "token");
    const chunks = [makeChunk("a", "a"), makeChunk("b", "b")];
    const reranked = await reranker.rerank("query", chunks, 5);
    expect(reranked[0].id).toBe("a");
  });

  it("should fall back when topK undefined uses default", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [[1.0, 0.5, 0.2, 0.1]],
    });
    const reranker = new HfReranker("model", "https://hf.example", "token");
    const chunks = Array.from({ length: 8 }, (_, i) => makeChunk(String(i), `text ${i}`));
    const reranked = await reranker.rerank("query", chunks);
    expect(reranked).toHaveLength(5);
  });
});
