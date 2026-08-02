import { vi, describe, it, expect, beforeEach } from "vitest";
import { appRouter } from "@/server/trpc/router";
import type { Context } from "@/server/trpc/context";

vi.mock("@/server/db", () => ({
  prisma: {
    user: { count: vi.fn() },
    conversation: { count: vi.fn(), create: vi.fn() },
    message: { count: vi.fn(), create: vi.fn() },
    document: { count: vi.fn() },
    semanticCacheEntry: { deleteMany: vi.fn() },
    conversationMemory: { upsert: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

const mockRunAgenticRag = vi.fn();
vi.mock("@/server/rag/agents/orchestrator", () => ({
  runAgenticRag: (...args: unknown[]) => mockRunAgenticRag(...args),
}));

const mockGetHybridRetriever = vi.fn();
vi.mock("@/server/rag/instance", () => ({
  getHybridRetriever: () => mockGetHybridRetriever(),
  getCorpusProvider: () => ({ invalidate: vi.fn() }),
}));

import { prisma } from "@/server/db";
import type { MockPrisma } from "../helpers/mock-prisma";
import type { AgenticRagResponse } from "@/server/rag/agents/orchestrator";

const prismaMock = prisma as unknown as MockPrisma;

function makeCaller(role: "USER" | "ADMIN" = "ADMIN") {
  return appRouter.createCaller({
    db: prismaMock as never,
    session: {
      user: { id: "user-1", role, name: "Test", email: "test@example.com" },
      expires: "2099-01-01T00:00:00.000Z",
    },
    headers: new Headers(),
    resHeaders: new Headers(),
  } as unknown as Context);
}

function fullTrace(): AgenticRagResponse {
  return {
    userQuery: "What documents are required for a German student visa?",
    maskedQuery: "What documents are required for a German student visa?",
    guardrail: { passed: true, reason: "In-domain" },
    finalAnswer: "You need a valid passport, proof of funds, and a university admission.",
    researchSteps: [
      {
        iteration: 1,
        thought: "Retrieve documents about visa requirements.",
        action: "Hybrid Retrieval",
        observation: "Found 3 relevant sources.",
      },
    ],
    analysisMatrix: {
      summary: "Required documents include passport, proof of funds, admission.",
      structured_table: "| Document | Required |\n| Passport | Yes |",
      key_insights: ["Proof of funds is mandatory."],
      verified_facts: ["Blocked account is accepted."],
    },
    sources: [
      {
        name: "visa-guide.pdf",
        url: "pdf://abc/visa-guide.pdf",
        score: 0.82,
        documentId: "doc-1",
        childText: "Matched child snippet.",
        parentText: "Expanded parent context.",
      },
    ],
    totalLatencyMs: 2400,
  };
}

describe("admin.testPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHybridRetriever.mockReturnValue({ embedQuery: vi.fn() });
  });

  it("requires the ADMIN role", async () => {
    const caller = makeCaller("USER");
    await expect(caller.admin.testPipeline({ prompt: "a valid query" })).rejects.toThrow();
    expect(mockRunAgenticRag).not.toHaveBeenCalled();
  });

  it("rejects a prompt shorter than 5 characters", async () => {
    const caller = makeCaller();
    await expect(caller.admin.testPipeline({ prompt: "abc" })).rejects.toThrow();
    expect(mockRunAgenticRag).not.toHaveBeenCalled();
  });

  it("returns the full AgenticRagResponse trace without writing conversation memory", async () => {
    mockRunAgenticRag.mockResolvedValue(fullTrace());
    const caller = makeCaller();

    const result = await caller.admin.testPipeline({
      prompt: "What documents are required for a German student visa?",
    });

    expect(result.finalAnswer).toContain("valid passport");
    expect(result.researchSteps).toHaveLength(1);
    expect(result.sources[0]?.childText).toBe("Matched child snippet.");
    expect(result.sources[0]?.parentText).toBe("Expanded parent context.");
    expect(result.guardrail).toEqual({ passed: true, reason: "In-domain" });

    // The NoopMemory adapter must prevent any ConversationMemory write.
    expect(prismaMock.conversationMemory?.upsert).not.toHaveBeenCalled();

    // Called with a NoopMemory instance and cache bypassed.
    const [query, options] = mockRunAgenticRag.mock.calls[0] ?? [];
    expect(query).toBe("What documents are required for a German student visa?");
    expect(options).toMatchObject({ bypassCache: true });
    expect(typeof (options as { memory: { addTurn: () => void } }).memory.addTurn).toBe("function");
  });

  it("propagates a guardrail-blocked (out of domain) response", async () => {
    mockRunAgenticRag.mockResolvedValue({
      ...fullTrace(),
      finalAnswer: "**Out of Domain Detected:** ...",
      researchSteps: [
        {
          iteration: 1,
          thought: "Check domain validity of the query.",
          action: "Stage 0A Guardrail",
          observation: "Query rejected as Out of Domain.",
        },
      ],
      sources: [],
      guardrail: { passed: false, reason: "Out of domain" },
    });
    const caller = makeCaller();

    const result = await caller.admin.testPipeline({ prompt: "Tell me about cooking pasta" });
    expect(result.guardrail.passed).toBe(false);
    expect(result.sources).toHaveLength(0);
  });

  it("propagates a cache-hit response with a single research step", async () => {
    mockRunAgenticRag.mockResolvedValue({
      ...fullTrace(),
      finalAnswer: "Served from cache.",
      researchSteps: [
        {
          iteration: 0,
          thought: "Check cache.",
          action: "Semantic Cache Hit",
          observation: "Found matching response in cache.",
        },
      ],
      analysisMatrix: {
        summary: "Served from cache.",
        structured_table: "",
        key_insights: [],
        verified_facts: [],
      },
    });
    const caller = makeCaller();

    const result = await caller.admin.testPipeline({ prompt: "visa fee germany" });
    expect(result.researchSteps[0]?.action).toBe("Semantic Cache Hit");
  });

  it("does not persist a conversation or message row", async () => {
    mockRunAgenticRag.mockResolvedValue(fullTrace());
    const caller = makeCaller();
    await caller.admin.testPipeline({ prompt: "What is an APS certificate?" });
    expect(prismaMock.conversation.create).not.toHaveBeenCalled();
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });
});
