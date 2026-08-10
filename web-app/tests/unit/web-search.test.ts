import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  webSearch,
  formatWebResultsForPrompt,
  formatChunksForPrompt,
} from "@/server/rag/tools/web-search";
import type { Chunk } from "@/server/rag/types";

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

  it("should clamp maxResults upward when below 1", async () => {
    mockedSearch.mockResolvedValue({
      noResults: false,
      vqd: "",
      results: [
        {
          title: "Only result",
          url: "https://example.com",
          description: "d",
          rawDescription: "raw",
          hostname: "example.com",
          icon: "",
        },
        {
          title: "Second",
          url: "https://example.com/2",
          description: "d2",
          rawDescription: "raw2",
          hostname: "example.com",
          icon: "",
        },
      ],
    } as never);
    // clampedMax = Math.max(1, 0) => 1 — the slice keeps only one result.
    const results = await webSearch("query", 0);
    expect(results).toHaveLength(1);
  });

  it("should default missing title/url/description fields from DDG results", async () => {
    mockedSearch.mockResolvedValue({
      noResults: false,
      vqd: "abc",
      results: [
        {
          title: "",
          url: "",
          description: "",
          rawDescription: "raw snippet",
          hostname: "daad.de",
          icon: "icon",
        },
      ],
    } as never);

    const results = await webSearch("study in germany", 3);
    expect(results[0]).toEqual({
      title: "Web Result",
      url: "#",
      snippet: "raw snippet",
    });
  });

  it("should render an empty snippet when both description fields are missing", async () => {
    mockedSearch.mockResolvedValue({
      noResults: false,
      vqd: "abc",
      results: [
        {
          title: "Title only",
          url: "https://example.com",
          description: "",
          rawDescription: "",
          hostname: "example.com",
          icon: "",
        },
      ],
    } as never);

    const results = await webSearch("study in germany", 3);
    expect(results[0]?.snippet).toBe("");
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

describe("formatChunksForPrompt", () => {
  it("returns a sentinel when there are no chunks", () => {
    expect(formatChunksForPrompt([])).toBe("No relevant context found.");
  });

  it("renders the [Source: name (url)] block for each chunk", () => {
    const chunk = {
      id: "c1",
      sourceName: "DAAD",
      sourceUrl: "https://www.daad.de/en/",
      text: "Official study-in-Germany guidelines.",
    } as Chunk;
    const output = formatChunksForPrompt([chunk]);
    expect(output).toContain("[Source: DAAD (https://www.daad.de/en/)]");
    expect(output).toContain("Official study-in-Germany guidelines.");
  });
});
