import { vi, describe, it, expect, beforeEach } from "vitest";
import { runCragGate } from "@/server/rag/crag-gate";
import type { RetrievedContext } from "@/server/rag/types";

vi.mock("@/server/rag/tools/web-search", async () => {
  const actual = await vi.importActual<typeof import("@/server/rag/tools/web-search")>(
    "@/server/rag/tools/web-search",
  );
  return {
    ...actual,
    webSearch: vi.fn(),
  };
});

import { webSearch } from "@/server/rag/tools/web-search";

const mockedWebSearch = vi.mocked(webSearch);

function makeRetrieval(
  bestCrossScore: number,
): Pick<RetrievedContext, "chunks" | "bestCrossScore" | "needsWebFallback" | "pathUsed"> {
  return {
    chunks: [
      {
        id: "1",
        sourceName: "Official Doc",
        sourceUrl: "https://example.com/doc",
        text: "Blocked account requirements for student visa.",
        crossScore: bestCrossScore,
      },
    ],
    bestCrossScore,
    needsWebFallback: false,
    pathUsed: "HYBRID_RRF_CROSS_ENCODER",
  };
}

describe("CRAGGate", () => {
  beforeEach(() => {
    mockedWebSearch.mockReset();
  });

  it("should PASS when score >= 0.50", async () => {
    const result = await runCragGate(makeRetrieval(0.85), "blocked account");
    expect(result.needsWebFallback).toBe(false);
    expect(result.pathUsed).toBe("HYBRID_RRF_CROSS_ENCODER");
    expect(mockedWebSearch).not.toHaveBeenCalled();
    expect(result.contextText).toContain("Blocked account requirements");
  });

  it("should FAIL and trigger web search when < 0.50", async () => {
    mockedWebSearch.mockResolvedValue([
      { title: "DAAD", url: "https://daad.de", snippet: "Official portal" },
    ]);
    const result = await runCragGate(makeRetrieval(0.3), "blocked account");
    expect(result.needsWebFallback).toBe(true);
    expect(result.pathUsed).toBe("CRAG_CONFIDENCE_GATE_WEB_FALLBACK");
    expect(mockedWebSearch).toHaveBeenCalledWith("blocked account", 3);
    expect(result.contextText).toContain("[WEB]");
  });

  it("should synthesize answer from web results on fallback", async () => {
    mockedWebSearch.mockResolvedValue([
      { title: "Official", url: "https://example.com", snippet: "Snippet text" },
    ]);
    const result = await runCragGate(makeRetrieval(0.1), "aps certificate");
    expect(result.contextText).toContain("[WEB]: Official");
    expect(result.contextText).toContain("Snippet text");
    expect(result.webResults).toHaveLength(1);
  });
});
