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

describe("QueryExpander (English-first, LLM language detection)", () => {
  beforeEach(() => {
    mockedCallLLMJson.mockReset();
  });

  it("returns { language, queries } with the canonical English query first + paraphrases", async () => {
    mockedCallLLMJson.mockResolvedValue({
      language: "de",
      queries: [
        "What is a blocked account?",
        "How much money must be deposited in a blocked account?",
        "Blocked account requirements for a German student visa",
      ],
    });
    const result = await generateSubQueries("Was ist ein Sperrkonto?");
    expect(result.language).toBe("de");
    expect(result.queries).toHaveLength(3);
    expect(result.queries[0]).toBe("What is a blocked account?");
  });

  it("keeps the original query as the canonical form when the input is already English", async () => {
    mockedCallLLMJson.mockResolvedValue({
      language: "en",
      queries: [
        "blocked account for German student visa",
        "How much money do I need in a blocked account?",
        "Blocked account deposit requirements for studying in Germany",
      ],
    });
    const result = await generateSubQueries("blocked account for German student visa");
    expect(result.language).toBe("en");
    expect(result.queries[0]).toBe("blocked account for German student visa");
  });

  it("honors numQueries (5 → 5 English queries)", async () => {
    mockedCallLLMJson.mockResolvedValue({
      language: "en",
      queries: ["q1", "q2", "q3", "q4", "q5", "q6"],
    });
    const result = await generateSubQueries("query", 5);
    expect(result.queries).toHaveLength(5);
  });

  it("deduplicates repeated paraphrases case-insensitively", async () => {
    mockedCallLLMJson.mockResolvedValue({
      language: "en",
      queries: ["canonical", "Same wording", "same wording", "another one"],
    });
    const result = await generateSubQueries("blocked account", 5);
    expect(result.queries).toEqual(["canonical", "Same wording", "another one"]);
  });

  it("filters out empty and whitespace-only entries", async () => {
    mockedCallLLMJson.mockResolvedValue({
      language: "en",
      queries: ["valid", "", "   ", "another valid"],
    });
    const result = await generateSubQueries("short query");
    expect(result.queries).toEqual(["valid", "another valid"]);
  });

  it("caps every sub-query at MAX_SUBQUERY_CHARS", async () => {
    mockedCallLLMJson.mockResolvedValue({
      language: "en",
      queries: ["x".repeat(1000), "short english"],
    });
    const result = await generateSubQueries("short query");
    for (const query of result.queries) {
      expect(query.length).toBeLessThanOrEqual(500);
    }
  });

  it("normalizes the detected language code", async () => {
    mockedCallLLMJson.mockResolvedValue({ language: "  DE  ", queries: ["canonical"] });
    const result = await generateSubQueries("was ist das?");
    expect(result.language).toBe("de");
  });

  it("carries needsDeepRerank=true when the LLM flags a multi-entity query", async () => {
    mockedCallLLMJson.mockResolvedValue({
      language: "en",
      queries: ["Compare TU Berlin vs LMU vs FU Berlin"],
      needsDeepRerank: true,
    });
    const result = await generateSubQueries("Compare TU Berlin vs LMU vs FU Berlin");
    expect(result.needsDeepRerank).toBe(true);
  });

  it('accepts the string form "true" for needsDeepRerank', async () => {
    mockedCallLLMJson.mockResolvedValue({
      language: "en",
      queries: ["Which universities have international offices?"],
      needsDeepRerank: "true",
    });
    const result = await generateSubQueries("Which universities have international offices?");
    expect(result.needsDeepRerank).toBe(true);
  });

  it("defaults needsDeepRerank to undefined for single-fact queries", async () => {
    mockedCallLLMJson.mockResolvedValue({
      language: "en",
      queries: ["What is the blocked account total?"],
      needsDeepRerank: false,
    });
    const result = await generateSubQueries("What is the blocked account total?");
    expect(result.needsDeepRerank).toBeUndefined();
  });

  it("treats garbage needsDeepRerank values as undefined (narrow retrieval)", async () => {
    mockedCallLLMJson.mockResolvedValue({
      language: "en",
      queries: ["query"],
      needsDeepRerank: "yes please",
    });
    const result = await generateSubQueries("query");
    expect(result.needsDeepRerank).toBeUndefined();
  });

  it("falls back to English + the original query when expansion fails", async () => {
    mockedCallLLMJson.mockResolvedValue(null);
    const result = await generateSubQueries("blocked account");
    expect(result).toEqual({ language: "en", queries: ["blocked account"] });
  });

  it("falls back to the original query when the response has no usable queries", async () => {
    mockedCallLLMJson.mockResolvedValue({ language: "de", queries: [] });
    const result = await generateSubQueries("blocked account");
    expect(result.queries).toEqual(["blocked account"]);
  });

  it("falls back to the original query when queries is not an array", async () => {
    mockedCallLLMJson.mockResolvedValue({ language: "en", queries: "not-an-array" });
    const result = await generateSubQueries("blocked account");
    expect(result.queries).toEqual(["blocked account"]);
  });
});
