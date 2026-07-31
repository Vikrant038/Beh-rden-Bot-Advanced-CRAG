import { BM25Okapi, buildBm25, defaultTokenizer } from "@/server/rag/retrieval/bm25";
import type { Chunk } from "@/server/rag/types";

function makeChunk(id: string, text: string, sourceName = "doc"): Chunk {
  return { id, sourceName, sourceUrl: `https://example.com/${sourceName}`, text };
}

describe("BM25Okapi", () => {
  it("should score keyword overlap correctly", () => {
    const bm25 = new BM25Okapi([
      ["blocked", "account", "germany"],
      ["university", "admission"],
    ]);
    const scores = bm25.getScores(["blocked"]);
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[1]).toBe(0);
  });

  it("should handle IDF for rare vs common terms", () => {
    const corpus = [
      ["visa", "visa", "visa"],
      ["aps", "visa"],
      ["blocked", "account"],
    ];
    const bm25 = new BM25Okapi(corpus);
    const rare = bm25.getScore(["blocked"], 2);
    const common = bm25.getScore(["visa"], 2);
    expect(rare).toBeGreaterThan(common);
  });

  it("should not crash on empty corpus or empty query", () => {
    const empty = new BM25Okapi([]);
    expect(empty.getScores([])).toEqual([]);

    const one = new BM25Okapi([["hello"]]);
    expect(one.getScores([])).toEqual([0]);
    expect(one.search([], 5)).toEqual([]);
  });

  it("should handle German compound-word tokens", () => {
    const tokens = defaultTokenizer("Sperrkonto-Bescheinigung für die Zulassung");
    expect(tokens).toContain("sperrkonto-bescheinigung");
    expect(tokens).toContain("für");
  });

  it("should tokenize and drop punctuation", () => {
    expect(defaultTokenizer("Blocked account, Germany!")).toEqual([
      "blocked",
      "account",
      "germany",
    ]);
  });
});

describe("buildBm25", () => {
  it("should return chunks with bm25Score in ranked order", () => {
    const chunks: Chunk[] = [
      makeChunk("1", "blocked account for german student visa"),
      makeChunk("2", "university admission requirements in germany"),
      makeChunk("3", "cooking recipes for pasta"),
    ];
    const engine = buildBm25(chunks);
    const results = engine.search("blocked account visa", 2);
    expect(results[0].id).toBe("1");
    expect(results).toHaveLength(1);
    expect(results[0].bm25Score).toBeGreaterThan(0);
  });

  it("should return empty for out-of-corpus query", () => {
    const engine = buildBm25([makeChunk("1", "blocked account")]);
    expect(engine.search("zebra zebra", 5)).toEqual([]);
  });
});
