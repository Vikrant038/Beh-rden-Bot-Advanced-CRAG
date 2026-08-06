import { vi, describe, it, expect, beforeEach } from "vitest";
import { callLLMJson, parseJsonLoose } from "@/server/llm/json";

vi.mock("@/server/llm/client", () => ({
  callLLM: vi.fn(),
}));

import { callLLM } from "@/server/llm/client";

const mockedCallLLM = vi.mocked(callLLM);

describe("parseJsonLoose", () => {
  it("parses plain JSON", () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips ```json fences", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("strips plain ``` fences", () => {
    expect(parseJsonLoose('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("parses arrays", () => {
    expect(parseJsonLoose("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseJsonLoose("{not json")).toThrow();
  });

  it("throws when the fenced content is not JSON", () => {
    expect(() => parseJsonLoose("```json\ndefinitely not json\n```")).toThrow();
  });
});

describe("callLLMJson", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns parsed data on success", async () => {
    mockedCallLLM.mockResolvedValue('{"role":"user","ok":true}');
    await expect(callLLMJson<{ role: string }>("prompt")).resolves.toEqual({
      role: "user",
      ok: true,
    });
    expect(mockedCallLLM).toHaveBeenCalledWith([{ role: "user", content: "prompt" }], {
      maxTokens: 300,
      temperature: 0,
    });
  });

  it("returns null when the LLM call fails", async () => {
    mockedCallLLM.mockRejectedValue(new Error("provider down"));
    await expect(callLLMJson("prompt")).resolves.toBeNull();
  });

  it("returns null when the response is not JSON", async () => {
    mockedCallLLM.mockResolvedValue("I am sorry but I cannot do that");
    await expect(callLLMJson("prompt")).resolves.toBeNull();
  });

  it("passes custom maxTokens and temperature", async () => {
    mockedCallLLM.mockResolvedValue("{}");
    await callLLMJson("prompt", 500, 0.7);
    expect(mockedCallLLM).toHaveBeenCalledWith([{ role: "user", content: "prompt" }], {
      maxTokens: 500,
      temperature: 0.7,
    });
  });
});
