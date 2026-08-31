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

  it("parses JSON followed by trailing model commentary", () => {
    // Real failure mode: Groq returns the JSON object then appends prose, which
    // JSON.parse rejects — this is what broke query expansion (every response
    // fell back to the original query). The first complete value wins.
    expect(parseJsonLoose('{"language": "de"}\n\nDone! Hope this helps.')).toEqual({
      language: "de",
    });
  });

  it("parses fenced JSON followed by trailing text", () => {
    expect(parseJsonLoose('```json\n{"queries": ["a", "b"]}\n```\n\nGenerated above.')).toEqual({
      queries: ["a", "b"],
    });
  });

  it("prefers the JSON object over an earlier bracket reference", () => {
    // Prose like "See [1] for details" must not be mistaken for the JSON value.
    expect(parseJsonLoose('See [1] for the summary.\n{"a":1}')).toEqual({ a: 1 });
  });

  it("parses a JSON array preceded by prose", () => {
    expect(parseJsonLoose('The options are:\n["visa", "work"]\nChoose one.')).toEqual([
      "visa",
      "work",
    ]);
  });

  it('recovers `"language": language` (bare word value) — the observed Groq glitch', () => {
    // Real failure mode: the LLM emits the value without quotes. Before the
    // repair this whole response was discarded and query expansion silently
    // fell back to the original (German) query.
    expect(parseJsonLoose('{"language": language, "queries": ["a", "b"]}')).toEqual({
      language: "language",
      queries: ["a", "b"],
    });
  });

  it('recovers a bare ISO code value (`"language": de`) to its intended string', () => {
    // The repair's best case: the LLM only forgot the quotes, so the intended
    // value survives verbatim — the sanitizer sees "de" and the writer answers
    // in German as designed.
    expect(parseJsonLoose('{"language": de, "queries": ["a"]}')).toEqual({
      language: "de",
      queries: ["a"],
    });
  });

  it("recovers a bare-word value combined with trailing commentary", () => {
    // Both failure modes at once: unquoted value AND prose after the JSON.
    expect(parseJsonLoose('{"language": language, "queries": ["a"]} Hope this helps!')).toEqual({
      language: "language",
      queries: ["a"],
    });
  });

  it('recovers unquoted keys (`{language: "de"}`)', () => {
    expect(parseJsonLoose('{language: "de", queries: ["a"]}')).toEqual({
      language: "de",
      queries: ["a"],
    });
  });

  it("recovers unquoted array elements", () => {
    expect(parseJsonLoose("[visa, work]")).toEqual(["visa", "work"]);
  });

  it("leaves valid JSON literals untouched while repairing bare words", () => {
    // true/false/null are valid JSON — the repair must not quote them.
    expect(parseJsonLoose('{"flag": true, "empty": null, "language": language}')).toEqual({
      flag: true,
      empty: null,
      language: "language",
    });
  });

  it("does not corrupt identifiers inside string values", () => {
    // Freeform reasoning strings often contain prose like ", see: FAQ" — the
    // string-aware repair must leave them untouched while fixing the bare word.
    expect(parseJsonLoose('{"reasoning": "visa questions, see: FAQ", "language": de}')).toEqual({
      reasoning: "visa questions, see: FAQ",
      language: "de",
    });
  });

  it("recovers single-quoted keys and values (`{'language': 'de'}`)", () => {
    // JSON has no single quotes — the LLM sometimes emits them anyway. The
    // repair converts them to double quotes, preserving the intended values.
    expect(parseJsonLoose("{'language': 'de', 'queries': ['a', 'b']}")).toEqual({
      language: "de",
      queries: ["a", "b"],
    });
  });

  it("recovers single quotes mixed with double-quoted strings", () => {
    // An apostrophe inside a double-quoted string ("it's") is prose, not a
    // delimiter — it must survive untouched while the single-quoted value is
    // converted.
    expect(parseJsonLoose('{"reasoning": "it\'s fine", "language": \'de\'}')).toEqual({
      reasoning: "it's fine",
      language: "de",
    });
  });

  it("recovers an escaped single quote inside a single-quoted string", () => {
    expect(parseJsonLoose("{'a': 'it\\'s'}")).toEqual({ a: "it's" });
  });

  it("escapes inner double quotes when converting single-quoted strings", () => {
    expect(parseJsonLoose("{'a': 'say \"hi\"'}")).toEqual({ a: 'say "hi"' });
  });

  it('recovers a missing comma between object fields (`{"a": 1 "b": 2}`)', () => {
    expect(parseJsonLoose('{"language": "de" "queries": ["a"]}')).toEqual({
      language: "de",
      queries: ["a"],
    });
  });

  it("recovers missing commas between string fields and array elements", () => {
    expect(parseJsonLoose('{"a": "x" "b": ["p" "q"]}')).toEqual({
      a: "x",
      b: ["p", "q"],
    });
  });

  it("recovers a missing comma after a nested object", () => {
    expect(parseJsonLoose('{"a": {"b": 1} "c": 2}')).toEqual({ a: { b: 1 }, c: 2 });
  });

  it("recovers a missing comma between numbers in an array", () => {
    expect(parseJsonLoose("[3 4]")).toEqual([3, 4]);
  });

  it("does not double-insert commas where separators already exist (repair path)", () => {
    // The single quote forces the repair path; the existing comma must not be
    // duplicated by the missing-comma pass.
    expect(parseJsonLoose('{"a": 1, "b": \'de\'}')).toEqual({ a: 1, b: "de" });
  });

  it("recovers single quotes AND missing commas together", () => {
    expect(parseJsonLoose("{'language': 'de' 'queries': ['a']}")).toEqual({
      language: "de",
      queries: ["a"],
    });
  });

  it("does not let braces inside single-quoted strings unbalance extraction", () => {
    // extractJsonValue must treat single-quoted strings as opaque so a '}' or
    // '[' inside them can't truncate the extracted value early.
    expect(parseJsonLoose("{'a': 'x}y' 'b': [1]}")).toEqual({ a: "x}y", b: [1] });
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

  it("returns the parsed object for a bare-word response instead of null (no caller fallback)", async () => {
    // End-to-end consequence of the repair: callLLMJson no longer returns null
    // for `\"language\": language`, so query expansion keeps the English
    // canonical queries instead of silently falling back to the original query.
    mockedCallLLM.mockResolvedValue(
      '{"language": language, "queries": ["How do I apply for a blocked account?"]}',
    );
    await expect(callLLMJson<{ language: string; queries: string[] }>("prompt")).resolves.toEqual({
      language: "language",
      queries: ["How do I apply for a blocked account?"],
    });
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
