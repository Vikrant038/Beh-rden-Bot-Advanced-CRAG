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

describe("QueryExpander", () => {
  beforeEach(() => {
    mockedCallLLMJson.mockReset();
  });

  it("should generate 3 sub-queries from a single query", async () => {
    mockedCallLLMJson.mockResolvedValue([
      "What is the blocked account amount?",
      "Sperrkonto requirements for students",
    ]);
    const result = await generateSubQueries("blocked account for German student visa", 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("blocked account for German student visa");
  });

  it("should keep sub-queries within token budget", async () => {
    const longAlternative = "x".repeat(1000);
    mockedCallLLMJson.mockResolvedValue([longAlternative]);
    const result = await generateSubQueries("short query", 3);
    for (const query of result) {
      expect(query.length).toBeLessThanOrEqual(500);
    }
  });

  it("should return the original query when expansion fails", async () => {
    mockedCallLLMJson.mockResolvedValue(null);
    const result = await generateSubQueries("blocked account");
    expect(result).toEqual(["blocked account"]);
  });
});
