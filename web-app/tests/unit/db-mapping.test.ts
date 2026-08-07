import { describe, it, expect } from "vitest";
import { parseCachePayload, rowToChunk } from "@/server/db/mapping";

describe("parseCachePayload", () => {
  it("parses a well-formed payload", () => {
    const payload = parseCachePayload({
      answer: "hello",
      sources: [{ name: "doc", url: "https://example.com", score: 0.9 }],
    });
    expect(payload.answer).toBe("hello");
    expect(payload.sources).toHaveLength(1);
  });

  it("degrades non-object / null payloads to empty answer and sources", () => {
    for (const junk of [null, undefined, 42, "text", []]) {
      const payload = parseCachePayload(junk);
      expect(payload.answer).toBe("");
      expect(payload.sources).toEqual([]);
    }
  });

  it("fills defaults for missing answer/sources", () => {
    const payload = parseCachePayload({});
    expect(payload.answer).toBe("");
    expect(payload.sources).toEqual([]);
  });

  it("drops malformed source entries instead of passing them through", () => {
    const payload = parseCachePayload({
      answer: "ok",
      sources: [null, 42, "nope", { name: "doc", url: "https://x", score: 1 }],
    });
    expect(payload.sources).toHaveLength(1);
    expect(payload.sources[0]).toMatchObject({ name: "doc", url: "https://x" });
  });
});

describe("rowToChunk", () => {
  it("maps a raw row to a domain Chunk", () => {
    const chunk = rowToChunk({
      id: 12,
      parentId: 3,
      documentId: "doc-1",
      sourceName: "s",
      sourceUrl: "https://x",
      text: "body",
    });
    expect(chunk).toMatchObject({
      id: "12",
      parentId: "3",
      documentId: "doc-1",
      sourceName: "s",
      sourceUrl: "https://x",
      text: "body",
    });
    expect(chunk.similarityScore).toBeUndefined();
    expect(chunk.bm25Score).toBeUndefined();
  });

  it("maps null parentId/documentId to undefined", () => {
    const chunk = rowToChunk({
      id: "a",
      parentId: null,
      documentId: null,
      sourceName: "s",
      sourceUrl: "https://x",
      text: "body",
    });
    expect(chunk.parentId).toBeUndefined();
    expect(chunk.documentId).toBeUndefined();
  });

  it("carries through similarity and bm25 scores when present", () => {
    const chunk = rowToChunk({
      id: "a",
      parentId: null,
      documentId: null,
      sourceName: "s",
      sourceUrl: "https://x",
      text: "body",
      similarityScore: 0.75,
      bm25Score: 4.2,
    });
    expect(chunk.similarityScore).toBe(0.75);
    expect(chunk.bm25Score).toBe(4.2);
  });
});
