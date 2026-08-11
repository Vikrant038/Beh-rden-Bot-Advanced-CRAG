import { vi, describe, it, expect, beforeEach } from "vitest";
import { isQueryOutOfDomain, assertInDomain, NEGATIVE_TERMS } from "@/server/rag/guardrail";
import { DomainGuardBlockedError } from "@/server/lib/errors";

vi.mock("@/server/llm/client", async () => {
  const actual = await vi.importActual<typeof import("@/server/llm/client")>("@/server/llm/client");
  return {
    ...actual,
    callLLM: vi.fn(),
  };
});

import { callLLM } from "@/server/llm/client";

const mockedCallLLM = vi.mocked(callLLM);

describe("DomainGuardrail (Stage 0A)", () => {
  beforeEach(() => {
    mockedCallLLM.mockReset();
  });

  it("should allow in-domain questions (visa, APS, blocked account)", async () => {
    mockedCallLLM.mockResolvedValue(JSON.stringify({ reasoning: "ok", is_safe: true }));
    const result = await isQueryOutOfDomain(
      "What are the APS requirements for an Indian student applying to German universities?",
    );
    expect(result).toBe(false);
  });

  it("should block off-topic questions", async () => {
    mockedCallLLM.mockResolvedValue(JSON.stringify({ reasoning: "bad", is_safe: false }));
    const result = await isQueryOutOfDomain("What is the best cricket team?");
    expect(result).toBe(true);
  });

  it("should block illegal-advice questions", async () => {
    mockedCallLLM.mockResolvedValue(JSON.stringify({ reasoning: "bad", is_safe: false }));
    const result = await isQueryOutOfDomain("How can I fake my blocked account certificate?");
    expect(result).toBe(true);
  });

  it("should block German illegal-advice questions via the deterministic cache (no LLM call)", async () => {
    const result = await isQueryOutOfDomain(
      "Kann ich ein gefälschtes APS-Zertifikat besorgen?",
    );
    expect(result).toBe(true);
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });

  it("should allow a legit German Führungszeugnis application question (police clearance cert)", async () => {
    // Regression: the LLM classifier used to block Führungszeugnis questions as
    // out-of-domain, even though police clearance certificates are in-scope
    // (bundesjustizamt.de is a corpus source). The prompt now lists them
    // explicitly as a legitimate process.
    mockedCallLLM.mockResolvedValue(
      JSON.stringify({ reasoning: "police clearance certificate application", is_safe: true }),
    );
    const result = await isQueryOutOfDomain("Wie beantrage ich ein Führungszeugnis online?");
    expect(result).toBe(false);
  });

  it("should allow a legit English police clearance certificate question", async () => {
    mockedCallLLM.mockResolvedValue(
      JSON.stringify({ reasoning: "certificate of good conduct for visa", is_safe: true }),
    );
    const result = await isQueryOutOfDomain(
      "How do I apply for a police clearance certificate for my German visa?",
    );
    expect(result).toBe(false);
  });

  it("should still block a fake Führungszeugnis request via the deterministic cache (no LLM call)", async () => {
    // The in-scope expansion must NOT loosen the illegal-advice guard: forging a
    // police clearance certificate stays blocked fail-closed, no LLM involved.
    const result = await isQueryOutOfDomain(
      "Kann ich mir ein gefälschtes Führungszeugnis besorgen?",
    );
    expect(result).toBe(true);
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });

  it("should still block a forged certificate request in English", async () => {
    const result = await isQueryOutOfDomain(
      "How can I forge my police clearance certificate?",
    );
    expect(result).toBe(true);
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });

  it("should cache out-of-domain verdicts in negative cache (instant, no LLM call)", async () => {
    const result = await isQueryOutOfDomain("cooking pasta recipe");
    expect(result).toBe(true);
    expect(mockedCallLLM).not.toHaveBeenCalled();
  });

  it("should fail open (in-domain) when the LLM call errors", async () => {
    mockedCallLLM.mockRejectedValue(new Error("provider down"));
    const result = await isQueryOutOfDomain("visa requirements");
    expect(result).toBe(false);
  });

  it("should expose negative terms list", () => {
    expect(NEGATIVE_TERMS.length).toBeGreaterThan(0);
  });

  describe("assertInDomain", () => {
    it("should throw DomainGuardBlockedError when blocked", async () => {
      mockedCallLLM.mockResolvedValue(JSON.stringify({ reasoning: "bad", is_safe: false }));
      await expect(assertInDomain("How to fake my blocked account")).rejects.toThrow(
        DomainGuardBlockedError,
      );
    });

    it("should resolve normally when passed", async () => {
      mockedCallLLM.mockResolvedValue(JSON.stringify({ reasoning: "ok", is_safe: true }));
      await expect(assertInDomain("APS certificate")).resolves.toBeUndefined();
    });
  });
});
