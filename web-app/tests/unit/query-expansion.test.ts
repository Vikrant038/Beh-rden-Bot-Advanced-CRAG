import { vi, describe, it, expect, beforeEach } from "vitest";
import { generateSubQueries } from "@/server/rag/query-expansion";

vi.mock("@/server/llm/json", async () => {
  const actual = await vi.importActual<typeof import("@/server/llm/json")>("@/server/llm/json");
  return {
    ...actual,
    callLLMJson: vi.fn(),
  };
});

import { callLLMJson } from "@/server/llm/json";

const mockedCallLLMJson = vi.mocked(callLLMJson);

describe("QueryExpander (bilingual, deterministic 2+2)", () => {
  beforeEach(() => {
    mockedCallLLMJson.mockReset();
  });

  it("returns the original query plus exactly 2 EN and 2 DE alternatives", async () => {
    mockedCallLLMJson.mockResolvedValue({
      english: [
        "What is the blocked account amount?",
        "student visa fees",
      ],
      german: [
        "Sperrkonto Anforderungen für Studenten",
        "Visumgebühren für Studierende",
      ],
    });
    const result = await generateSubQueries("blocked account for German student visa", 5);
    expect(result).toHaveLength(5);
    expect(result[0]).toBe("blocked account for German student visa");
    expect(result).toEqual(expect.arrayContaining(["Sperrkonto Anforderungen für Studenten"]));
    expect(result).toEqual(expect.arrayContaining(["Visumgebühren für Studierende"]));
    expect(result).toEqual(expect.arrayContaining(["What is the blocked account amount?"]));
  });

  it("keeps the bilingual split stable for odd numQueries values", async () => {
    mockedCallLLMJson.mockResolvedValue({
      english: ["english alt"],
      german: ["deutsche alternative"],
    });
    const result = await generateSubQueries("query", 3);
    expect(result).toEqual(["query", "english alt", "deutsche alternative"]);
  });

  it("deduplicates repeated alternatives across languages", async () => {
    mockedCallLLMJson.mockResolvedValue({
      english: ["Sperrkonto Anforderungen", "english alternative"],
      german: ["Sperrkonto Anforderungen", "eine weitere"],
    });
    const result = await generateSubQueries("blocked account", 5);
    expect(result).toHaveLength(4);
    expect(result.filter((q) => q === "Sperrkonto Anforderungen")).toHaveLength(1);
  });

  it("filters out empty alternatives", async () => {
    mockedCallLLMJson.mockResolvedValue({
      english: ["", "   ", "valid english alternative"],
      german: ["gültige deutsche alternative"],
    });
    const result = await generateSubQueries("short query", 5);
    expect(result).toEqual(["short query", "valid english alternative", "gültige deutsche alternative"]);
  });

  it("keeps sub-queries within the character budget", async () => {
    mockedCallLLMJson.mockResolvedValue({
      english: ["x".repeat(1000), "short english"],
      german: ["kurze alternative", "noch eine"],
    });
    const result = await generateSubQueries("short query", 5);
    expect(result).toHaveLength(5);
    for (const query of result) {
      expect(query.length).toBeLessThanOrEqual(500);
    }
  });

  it("returns the original query when expansion fails", async () => {
    mockedCallLLMJson.mockResolvedValue(null);
    const result = await generateSubQueries("blocked account");
    expect(result).toEqual(["blocked account"]);
  });

  it("returns the original query when the response has no usable arrays", async () => {
    mockedCallLLMJson.mockResolvedValue({});
    const result = await generateSubQueries("blocked account", 5);
    expect(result).toEqual(["blocked account"]);
  });
});
