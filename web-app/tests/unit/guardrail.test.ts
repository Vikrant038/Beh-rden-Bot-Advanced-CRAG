import { vi, describe, it, expect, beforeEach } from "vitest";
import { isQueryOutOfDomain, NEGATIVE_TERMS } from "@/server/rag/guardrail";

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
    mockedCallLLM.mockResolvedValue("YES");
    const result = await isQueryOutOfDomain(
      "What are the APS requirements for an Indian student applying to German universities?",
    );
    expect(result).toBe(false);
  });

  it("should block off-topic questions", async () => {
    mockedCallLLM.mockResolvedValue("NO");
    const result = await isQueryOutOfDomain("What is the best cricket team?");
    expect(result).toBe(true);
  });

  it("should block illegal-advice questions", async () => {
    mockedCallLLM.mockResolvedValue("NO");
    const result = await isQueryOutOfDomain("How can I fake my blocked account certificate?");
    expect(result).toBe(true);
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
});
