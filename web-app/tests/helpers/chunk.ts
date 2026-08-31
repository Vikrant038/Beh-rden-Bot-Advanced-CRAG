import type { Chunk } from "@/server/rag/types";

/**
 * Shared Chunk fixture. The flexible-args form covers the two shapes the
 * suites use: `makeChunk("id", "text", "src")` positionally, or
 * `makeChunk({ text: "…" })` with partial overrides.
 */
export function makeChunk(
  idOrOverrides: string | Partial<Chunk>,
  text?: string,
  sourceName = "doc",
): Chunk {
  if (typeof idOrOverrides === "string") {
    return {
      id: idOrOverrides,
      sourceName,
      sourceUrl: `https://example.com/${sourceName}`,
      text: text ?? `text-${idOrOverrides}`,
    };
  }
  return {
    id: "chunk-1",
    documentId: "doc-1",
    sourceName: "src",
    sourceUrl: "https://example.com",
    text: "German visa text about the Aufenthaltsgesetz.",
    ...idOrOverrides,
  };
}
