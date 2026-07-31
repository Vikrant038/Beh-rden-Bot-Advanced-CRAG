import { vi, describe, it, expect, beforeEach } from "vitest";
import { disambiguateQuery } from "@/server/rag/disambiguation";

vi.mock("@/server/llm/json", async () => {
  const actual = await vi.importActual<typeof import("@/server/llm/json")>("@/server/llm/json");
  return {
    ...actual,
    callLLMJson: vi.fn(),
  };
});

import { callLLMJson } from "@/server/llm/json";

const mockedCallLLMJson = vi.mocked(callLLMJson);

describe("QueryDisambiguator (Stage 0B)", () => {
  beforeEach(() => {
    mockedCallLLMJson.mockReset();
  });

  it("should detect vague <=3-word queries", async () => {
    mockedCallLLMJson.mockResolvedValue([
      "Are you asking about blocked accounts?",
      "Are you asking about student visas?",
      "Are you asking about university admission?",
    ]);
    const result = await disambiguateQuery("What about it?");
    expect(result.isAmbiguous).toBe(true);
    expect(result.options).toHaveLength(3);
  });

  it("should generate exactly 3 clarifying options", async () => {
    mockedCallLLMJson.mockResolvedValue(["opt1", "opt2", "opt3"]);
    const result = await disambiguateQuery("visa?");
    expect(result.options).toHaveLength(3);
  });

  it("should pass through clear queries unchanged", async () => {
    const result = await disambiguateQuery(
      "What is the blocked account requirement for a German student visa in 2026?",
    );
    expect(result.isAmbiguous).toBe(false);
    expect(result.options).toEqual([]);
    expect(mockedCallLLMJson).not.toHaveBeenCalled();
  });
});
