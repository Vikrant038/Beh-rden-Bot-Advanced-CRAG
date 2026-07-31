import { vi, describe, it, expect, beforeEach } from "vitest";
import { webSearch, formatWebResultsForPrompt } from "@/server/rag/tools/web-search";

vi.mock("duck-duck-scrape", async () => {
  const actual = await vi.importActual<typeof import("duck-duck-scrape")>("duck-duck-scrape");
  return {
    ...actual,
    search: vi.fn(),
  };
});

import { search } from "duck-duck-scrape";

const mockedSearch = vi.mocked(search);

describe("WebSearchTool", () => {
  beforeEach(() => {
    mockedSearch.mockReset();
  });

  it("should return sanitized results", async () => {
    mockedSearch.mockResolvedValue({
      noResults: false,
      vqd: "abc",
      results: [
        {
          title: "DAAD — Study in Germany",
          url: "https://www.daad.de/en/",
          description: "Official info on studying in Germany.",
          rawDescription: "raw",
          hostname: "daad.de",
          icon: "icon",
        },
      ],
    } as never);

    const results = await webSearch("study in germany", 3);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      title: "DAAD — Study in Germany",
      url: "https://www.daad.de/en/",
      snippet: "Official info on studying in Germany.",
    });
  });

  it("should fall back to DAAD portal when search fails", async () => {
    mockedSearch.mockRejectedValue(new Error("rate limited"));
    const results = await webSearch("student visa", 3);
    expect(results[0].url).toContain("daad.de");
  });

  it("should fall back to DAAD portal when search returns no results", async () => {
    mockedSearch.mockResolvedValue({ noResults: true, vqd: "", results: [] } as never);
    const results = await webSearch("random query", 3);
    expect(results[0].url).toContain("daad.de");
  });

  it("should clamp maxResults to valid range", async () => {
    mockedSearch.mockResolvedValue({ noResults: true, vqd: "", results: [] } as never);
    await webSearch("query", 100);
    expect(mockedSearch.mock.calls[0][1]).toBeDefined();
  });
});

describe("formatWebResultsForPrompt", () => {
  it("should format results with [WEB] prefix and URL", () => {
    const output = formatWebResultsForPrompt([
      { title: "T", url: "https://u.example", snippet: "S" },
    ]);
    expect(output).toContain("[WEB]: T");
    expect(output).toContain("S");
    expect(output).toContain("https://u.example");
  });

  it("should return empty string for no results", () => {
    expect(formatWebResultsForPrompt([])).toBe("");
  });
});
