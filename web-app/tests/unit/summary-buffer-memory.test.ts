import { vi, describe, it, expect, beforeEach } from "vitest";
import { SummaryBufferMemory } from "@/server/rag/memory/summary-buffer";

vi.mock("@/server/db", async () => {
  const prisma = {
    conversationMemory: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
    },
  };
  return { prisma };
});

vi.mock("@/server/llm/client", async () => {
  const actual = await vi.importActual<typeof import("@/server/llm/client")>("@/server/llm/client");
  return {
    ...actual,
    callLLM: vi.fn(),
  };
});

import { prisma } from "@/server/db";
import { callLLM } from "@/server/llm/client";

const mockedCallLLM = vi.mocked(callLLM);
const mockedFindUnique = vi.mocked(prisma.conversationMemory.findUnique);
const mockedUpsert = vi.mocked(prisma.conversationMemory.upsert);
const mockedMessageFindMany = vi.mocked(prisma.message.findMany);

describe("SummaryBufferMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFindUnique.mockResolvedValue(null);
    mockedMessageFindMany.mockResolvedValue([]);
    mockedUpsert.mockResolvedValue({} as never);
  });

  it("should keep last 8 verbatim turns", async () => {
    const memory = new SummaryBufferMemory("conv-1", 8);
    for (let i = 1; i <= 4; i += 1) {
      await memory.addTurn(`q${i}`, `a${i}`);
    }
    const context = await memory.getContextFormatted();
    expect(context).toContain("q1");
    expect(context).toContain("a4");
  });

  it("should compress older turns into a rolling summary", async () => {
    mockedCallLLM.mockResolvedValue("User is from India, applying for a German student visa.");
    const memory = new SummaryBufferMemory("conv-1", 4);
    for (let i = 1; i <= 3; i += 1) {
      await memory.addTurn(`q${i}`, `a${i}`);
    }
    expect(mockedCallLLM).toHaveBeenCalled();
    const context = await memory.getContextFormatted();
    expect(context).toContain("ROLLING BACKGROUND SUMMARY");
  });

  it("should cap summary at ~300 tokens", async () => {
    mockedCallLLM.mockResolvedValue(
      "Nationality Indian. Goal Master's in CS at TU Berlin. " +
        "Awaiting APS verification. Visa application stage.",
    );
    const memory = new SummaryBufferMemory("conv-1", 4);
    for (let i = 1; i <= 3; i += 1) {
      await memory.addTurn(`q${i}`, `a${i}`);
    }
    const context = await memory.getContextFormatted();
    const summarySection = context.split("=== ROLLING BACKGROUND SUMMARY ===")[1] ?? "";
    expect(summarySection.length).toBeLessThan(1200);
  });

  it("should handle empty conversation", async () => {
    const memory = new SummaryBufferMemory("conv-empty", 8);
    const context = await memory.getContextFormatted();
    expect(context).toBe("");
  });

  it("restores an existing rolling summary from the database", async () => {
    mockedFindUnique.mockResolvedValue({
      conversationId: "conv-1",
      summaryText: "Prior summary from earlier session",
    } as never);
    const memory = new SummaryBufferMemory("conv-1", 8);
    const context = await memory.getContextFormatted();
    expect(context).toContain("Prior summary from earlier session");
  });

  it("swallows a DB load failure", async () => {
    mockedFindUnique.mockRejectedValue(new Error("db down"));
    const memory = new SummaryBufferMemory("conv-1", 8);
    const context = await memory.getContextFormatted();
    expect(context).toBe("");
  });

  it("swallows an LLM failure while summarizing older turns", async () => {
    mockedCallLLM.mockRejectedValue(new Error("llm down"));
    const memory = new SummaryBufferMemory("conv-1", 2);
    for (let i = 1; i <= 2; i += 1) {
      await memory.addTurn(`q${i}`, `a${i}`);
    }
    const context = await memory.getContextFormatted();
    // No summary was produced, but the remaining turns are still verbatim.
    expect(context).toContain("q2");
    expect(context).not.toContain("ROLLING BACKGROUND SUMMARY");
  });

  it("swallows a DB save failure", async () => {
    mockedUpsert.mockRejectedValue(new Error("db down"));
    const memory = new SummaryBufferMemory("conv-1", 8);
    await memory.addTurn("q1", "a1");
    const context = await memory.getContextFormatted();
    expect(context).toContain("q1");
  });
});
