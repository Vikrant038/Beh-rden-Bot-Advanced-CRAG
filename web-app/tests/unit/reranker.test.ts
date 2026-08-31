import { vi, describe, it, expect, beforeEach } from "vitest";
import { HfReranker } from "@/server/rag/retrieval/reranker";
import { makeChunk } from "../helpers/chunk";

describe("HfReranker", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns [] for an empty chunk list without any API call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const reranker = new HfReranker("BAAI/bge-reranker-base", "https://rerank.api", "token");
    await expect(reranker.rerank("query", [])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the dense similarity score (NOT the RRF rank score) when no token is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const reranker = new HfReranker("BAAI/bge-reranker-base", "https://rerank.api", "");
    const chunks = [
      makeChunk({ id: "a", rrfScore: 0.02, similarityScore: 0.83 }),
      makeChunk({ id: "b", rrfScore: 0.03, similarityScore: 0.71 }),
    ];

    const result = await reranker.rerank("query", chunks, 5);

    // Regression guard: rrfScore is 1/(60+rank) ≈ 0.02 — below the CRAG
    // threshold (0.50). If the fallback used rrfScore, every query would
    // fall back to web search. It must use the real dense similarity.
    expect(result[0].id).toBe("a");
    expect(result[0].crossScore).toBeCloseTo(0.83, 5);
    expect(result[1].crossScore).toBeCloseTo(0.71, 5);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back on a non-OK API response and prefers similarity over rrf score", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 404,
          text: async () => "Not Found",
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const reranker = new HfReranker("BAAI/bge-reranker-base", "https://rerank.api", "token");
    const chunks = [
      makeChunk({ id: "a", rrfScore: 0.01, similarityScore: 0.6 }),
      makeChunk({ id: "b", rrfScore: 0.05, similarityScore: 0.9 }),
    ];

    const result = await reranker.rerank("query", chunks, 5);

    expect(result[0].id).toBe("b");
    expect(result[0].crossScore).toBeCloseTo(0.9, 5);
    expect(result[1].crossScore).toBeCloseTo(0.6, 5);
  });

  it("defaults to 0.75 for chunks with no similarity score when falling back", async () => {
    const reranker = new HfReranker("BAAI/bge-reranker-base", "https://rerank.api", "");
    const chunks = [makeChunk({ id: "kw-only", rrfScore: 0.04 })];
    const result = await reranker.rerank("query", chunks, 5);
    expect(result[0].crossScore).toBeCloseTo(0.75, 5);
  });

  it("calls the text-classification endpoint and sorts by sigmoid cross score", async () => {
    let calledUrl = "";
    const fetchMock = vi.fn(async (input: unknown) => {
      calledUrl = String(input);
      return {
        ok: true,
        status: 200,
        json: async () => [[0.1], [0.9]],
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const reranker = new HfReranker("BAAI/bge-reranker-base", "https://rerank.api", "token");
    const chunks = [makeChunk({ id: "low" }), makeChunk({ id: "high" })];

    const result = await reranker.rerank("query", chunks, 5);

    expect(calledUrl).toBe(
      "https://rerank.api/pipeline/text-classification/BAAI%2Fbge-reranker-base",
    );
    // sigmoid(0.9) ≈ 0.711 > sigmoid(0.1) ≈ 0.525
    expect(result[0].id).toBe("high");
    expect(result[1].id).toBe("low");
    expect(result[0].crossScore ?? 0).toBeGreaterThan(result[1].crossScore ?? 0);
  });

  it("accepts a flat numeric array of scores", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => [0.2, 0.8],
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const reranker = new HfReranker("model", "https://rerank.api", "token");
    const chunks = [makeChunk({ id: "low" }), makeChunk({ id: "high" })];
    const result = await reranker.rerank("query", chunks, 5);
    // sigmoid(0.8) ≈ 0.69 > sigmoid(0.2) ≈ 0.55
    expect(result[0].id).toBe("high");
  });

  it("accepts object entries with a numeric score field", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => [[{ score: 0.1 }, { score: 0.5 }], [{ score: 0.9 }]],
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const reranker = new HfReranker("model", "https://rerank.api", "token");
    const chunks = [makeChunk({ id: "a" }), makeChunk({ id: "b" })];
    const result = await reranker.rerank("query", chunks, 5);
    expect(result[0].id).toBe("b");
  });

  it("accepts a response with a top-level scores array", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ scores: [0.05, 0.95] }),
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const reranker = new HfReranker("model", "https://rerank.api", "token");
    const chunks = [makeChunk({ id: "a" }), makeChunk({ id: "b" })];
    const result = await reranker.rerank("query", chunks, 5);
    expect(result[0].id).toBe("b");
  });

  it("falls back to original ranking when the response is malformed", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ unexpected: true }),
        }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const reranker = new HfReranker("model", "https://rerank.api", "token");
    const chunks = [makeChunk({ id: "a", similarityScore: 0.9 }), makeChunk({ id: "b" })];
    const result = await reranker.rerank("query", chunks, 5);
    expect(result[0].id).toBe("a");
    expect(result[0].crossScore).toBeCloseTo(0.9, 5);
  });

  it("falls back when the API fetch throws (network error)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    const reranker = new HfReranker("model", "https://rerank.api", "token");
    const chunks = [
      makeChunk({ id: "a", similarityScore: 0.9 }),
      makeChunk({ id: "b", similarityScore: 0.5 }),
    ];
    const result = await reranker.rerank("query", chunks, 5);
    expect(result[0].id).toBe("a");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honors topK in the fallback path by slicing the reranked list", async () => {
    const reranker = new HfReranker("model", "https://rerank.api", "");
    const chunks = Array.from({ length: 5 }, (_v, i) =>
      makeChunk({ id: `c${i}`, similarityScore: 1 - i * 0.1 }),
    );
    const result = await reranker.rerank("query", chunks, 3);
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.id)).toEqual(["c0", "c1", "c2"]);
  });

  it("uses an existing crossScore when present over similarityScore in fallback", async () => {
    const reranker = new HfReranker("model", "https://rerank.api", "");
    const chunks = [
      // crossScore (0.92) wins over similarityScore (0.4) for the same chunk.
      makeChunk({ id: "a", crossScore: 0.92, similarityScore: 0.4 }),
      makeChunk({ id: "b", crossScore: 0.5, similarityScore: 0.95 }),
    ];
    const result = await reranker.rerank("query", chunks, 5);
    expect(result[0].id).toBe("a");
    expect(result[0].crossScore).toBeCloseTo(0.92, 5);
  });

  it("falls back when the API returns an empty array (malformed response)", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, status: 200, json: async () => [] }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const reranker = new HfReranker("model", "https://rerank.api", "token");
    const chunks = [makeChunk({ id: "a", similarityScore: 0.9 }), makeChunk({ id: "b" })];
    const result = await reranker.rerank("query", chunks, 5);
    expect(result[0].id).toBe("a");
    expect(result[0].crossScore).toBeCloseTo(0.9, 5);
  });

  it("falls back when score objects lack a numeric score field", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, status: 200, json: async () => [[{ label: "x" }]] }) as Response,
    );
    vi.stubGlobal("fetch", fetchMock);
    const reranker = new HfReranker("model", "https://rerank.api", "token");
    const chunks = [makeChunk({ id: "a", similarityScore: 0.85 })];
    const result = await reranker.rerank("query", chunks, 5);
    expect(result[0].id).toBe("a");
    expect(result[0].crossScore).toBeCloseTo(0.85, 5);
  });
});
