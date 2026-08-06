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
    pipelineRun: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
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
import { formatDebugError } from "@/server/routers/admin";

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
    toolCalls: [],
    stages: [
      { index: 0, name: "Query disambiguation & guardrail", durationMs: 400, status: "executed" },
      { index: 1, name: "Research agent (ReAct)", durationMs: 1200, status: "executed" },
      { index: 2, name: "Analyst (comparison matrix)", durationMs: 500, status: "executed" },
      { index: 3, name: "Writer (markdown synthesis)", durationMs: 300, status: "executed" },
    ],
    llmCalls: [
      {
        stage: "Stage 2 — Analyst (comparison matrix)",
        provider: "groq",
        model: "llama-3.1-8b-instant",
        latencyMs: 500,
        promptTokens: 900,
        completionTokens: 220,
        totalTokens: 1120,
        costUsd: 0.0000626,
      },
      {
        stage: "Stage 3 — Writer (markdown synthesis)",
        provider: "groq",
        model: "llama-3.1-8b-instant",
        latencyMs: 300,
        promptTokens: 700,
        completionTokens: 480,
        totalTokens: 1180,
        costUsd: 0.0000734,
      },
    ],
    totalCostUsd: 0.000136,
  };
}

describe("admin.testPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHybridRetriever.mockReturnValue({ embedQuery: vi.fn() });
    // Background worker prunes old runs on completion; default to an empty
    // history so the prune path is a no-op unless a test supplies rows.
    prismaMock.pipelineRun?.findMany.mockResolvedValue([] as never);
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

  it("queues a RUNNING run, executes the pipeline, and returns { runId }", async () => {
    mockRunAgenticRag.mockResolvedValue(fullTrace());
    prismaMock.pipelineRun?.create.mockResolvedValue({ id: "run-1" } as never);
    prismaMock.pipelineRun?.update.mockResolvedValue({ id: "run-1" } as never);
    const caller = makeCaller();

    const result = await caller.admin.testPipeline({
      prompt: "What documents are required for a German student visa?",
    });

    // Background contract: the mutation returns the run id immediately; the
    // RUNNING row was created first and the worker updated it to SUCCESS.
    expect(result).toEqual({ runId: "run-1" });
    expect(prismaMock.pipelineRun?.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prompt: "What documents are required for a German student visa?",
          status: "RUNNING",
          latencyMs: 0,
        }),
      }),
    );
    expect(prismaMock.pipelineRun?.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({
          status: "SUCCESS",
          latencyMs: 2400,
          traceJson: expect.objectContaining({
            finalAnswer: expect.stringContaining("valid passport"),
          }),
        }),
      }),
    );

    // The NoopMemory adapter must prevent any ConversationMemory write.
    expect(prismaMock.conversationMemory?.upsert).not.toHaveBeenCalled();

    // Called with a NoopMemory instance and cache bypassed.
    const [query, options] = mockRunAgenticRag.mock.calls[0] ?? [];
    expect(query).toBe("What documents are required for a German student visa?");
    expect(options).toMatchObject({ bypassCache: true });
    expect(typeof (options as { memory: { addTurn: () => void } }).memory.addTurn).toBe("function");
  });

  it("propagates a guardrail-blocked (out of domain) response into the trace", async () => {
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
    prismaMock.pipelineRun?.create.mockResolvedValue({ id: "run-2" } as never);
    prismaMock.pipelineRun?.update.mockResolvedValue({ id: "run-2" } as never);
    const caller = makeCaller();

    const result = await caller.admin.testPipeline({ prompt: "Tell me about cooking pasta" });
    expect(result).toEqual({ runId: "run-2" });

    const updateData = prismaMock.pipelineRun?.update.mock.calls[0]?.[0] as {
      data: { traceJson: { guardrail: { passed: boolean }; sources: unknown[] } };
    };
    expect(updateData.data.traceJson.guardrail.passed).toBe(false);
    expect(updateData.data.traceJson.sources).toHaveLength(0);
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
    prismaMock.pipelineRun?.create.mockResolvedValue({ id: "run-3" } as never);
    prismaMock.pipelineRun?.update.mockResolvedValue({ id: "run-3" } as never);
    const caller = makeCaller();

    const result = await caller.admin.testPipeline({ prompt: "visa fee germany" });
    expect(result).toEqual({ runId: "run-3" });
    const updateData = prismaMock.pipelineRun?.update.mock.calls[0]?.[0] as {
      data: { traceJson: { researchSteps: Array<{ action: string }> } };
    };
    expect(updateData.data.traceJson.researchSteps[0]?.action).toBe("Semantic Cache Hit");
  });

  it("persists only the pipeline run — never a conversation or message row", async () => {
    mockRunAgenticRag.mockResolvedValue(fullTrace());
    prismaMock.pipelineRun?.create.mockResolvedValue({ id: "run-1" } as never);
    prismaMock.pipelineRun?.update.mockResolvedValue({ id: "run-1" } as never);
    const caller = makeCaller();
    await caller.admin.testPipeline({ prompt: "What is an APS certificate?" });
    expect(prismaMock.pipelineRun?.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.pipelineRun?.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.conversation.create).not.toHaveBeenCalled();
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it("records a FAILED run and still returns the runId (background semantics)", async () => {
    mockRunAgenticRag.mockRejectedValue(new Error("LLM provider down"));
    prismaMock.pipelineRun?.create.mockResolvedValue({ id: "run-err" } as never);
    prismaMock.pipelineRun?.update.mockResolvedValue({ id: "run-err" } as never);
    const caller = makeCaller();

    // Unlike the old synchronous contract, the mutation does NOT rethrow — the
    // failure is recorded on the run row for the client's poller to surface.
    const result = await caller.admin.testPipeline({ prompt: "Why is my visa delayed?" });
    expect(result).toEqual({ runId: "run-err" });

    expect(prismaMock.pipelineRun?.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-err" },
        data: expect.objectContaining({
          status: "FAILED",
          error: "LLM provider down",
          traceJson: {},
        }),
      }),
    );
  });

  it("keeps the plain error message (no stack) when debug mode is off", async () => {
    mockRunAgenticRag.mockRejectedValue(new Error("LLM provider down"));
    prismaMock.pipelineRun?.create.mockResolvedValue({ id: "run-err" } as never);
    prismaMock.pipelineRun?.update.mockResolvedValue({ id: "run-err" } as never);
    const caller = makeCaller();

    await caller.admin.testPipeline({ prompt: "Why is my visa delayed?" });
    const updateData = prismaMock.pipelineRun?.update.mock.calls[0]?.[0] as {
      data: { error: string };
    };
    expect(updateData.data.error).toBe("LLM provider down");
    expect(updateData.data.error).not.toContain("Stack:");
  });

  it("debug mode persists the full error detail (name, message, cause, stack) on the run", async () => {
    const failure = new Error("LLM provider down");
    failure.cause = new Error("groq 429 rate limited");
    mockRunAgenticRag.mockRejectedValue(failure);
    prismaMock.pipelineRun?.create.mockResolvedValue({ id: "run-err" } as never);
    prismaMock.pipelineRun?.update.mockResolvedValue({ id: "run-err" } as never);
    const caller = makeCaller();

    const result = await caller.admin.testPipeline({
      prompt: "Why is my visa delayed?",
      debug: true,
    });
    expect(result).toEqual({ runId: "run-err" });

    // The full detail (including the stack) is persisted on the run row.
    const updateData = prismaMock.pipelineRun?.update.mock.calls[0]?.[0] as {
      data: { status: string; error: string };
    };
    expect(updateData.data.status).toBe("FAILED");
    expect(updateData.data.error).toContain("[Error] LLM provider down");
    expect(updateData.data.error).toContain("Cause: Error: groq 429 rate limited");
    expect(updateData.data.error).toContain("Stack:");
  });

  it("formatDebugError serializes name, message, cause and stack", () => {
    const cause = new Error("root cause");
    const failure = new Error("boom");
    failure.cause = cause;
    const out = formatDebugError(failure);
    expect(out).toContain("[Error] boom");
    expect(out).toContain("Cause: Error: root cause");
    expect(out).toContain("Stack:");
  });

  it("formatDebugError falls back for non-Error values", () => {
    expect(formatDebugError("boom")).toBe("[UnknownError] boom");
  });

  it("listTestRuns: returns paginated run summaries with nextCursor", async () => {
    prismaMock.pipelineRun?.findMany.mockResolvedValue([
      {
        id: "run-1",
        prompt: "Visa documents?",
        latencyMs: 2400,
        status: "SUCCESS",
        error: null,
        createdAt: new Date("2026-08-01T10:00:00Z"),
      },
      {
        id: "run-2",
        prompt: "Out of domain",
        latencyMs: 120,
        status: "FAILED",
        error: "boom",
        createdAt: new Date("2026-08-01T09:00:00Z"),
      },
    ] as never);
    const caller = makeCaller();
    const result = await caller.admin.listTestRuns({ limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
    expect(result.items[0].status).toBe("SUCCESS");
    expect(result.items[1].status).toBe("FAILED");
    expect(result.items[1].error).toBe("boom");
  });

  it("listTestRuns: exposes nextCursor when a further page exists", async () => {
    prismaMock.pipelineRun?.findMany.mockResolvedValue([
      {
        id: "run-1",
        prompt: "a",
        latencyMs: 1,
        status: "SUCCESS",
        error: null,
        createdAt: new Date("2026-08-01T10:00:00Z"),
      },
      {
        id: "run-2",
        prompt: "b",
        latencyMs: 1,
        status: "SUCCESS",
        error: null,
        createdAt: new Date("2026-08-01T09:00:00Z"),
      },
      {
        id: "run-3",
        prompt: "c",
        latencyMs: 1,
        status: "SUCCESS",
        error: null,
        createdAt: new Date("2026-08-01T08:00:00Z"),
      },
    ] as never);
    const caller = makeCaller();
    const result = await caller.admin.listTestRuns({ limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toEqual({
      createdAt: new Date("2026-08-01T09:00:00Z"),
      id: "run-2",
    });
  });

  it("getTestRun: returns the stored trace for a run id", async () => {
    prismaMock.pipelineRun?.findUnique.mockResolvedValue({
      id: "run-1",
      prompt: "Visa documents?",
      traceJson: fullTrace(),
      latencyMs: 2400,
      status: "SUCCESS",
      error: null,
      createdAt: new Date("2026-08-01T10:00:00Z"),
    } as never);
    const caller = makeCaller();
    const run = await caller.admin.getTestRun({ id: "run-1" });
    expect(run.traceJson).toMatchObject({ finalAnswer: expect.stringContaining("passport") });
  });

  it("getTestRun: throws NotFoundError for an unknown run", async () => {
    prismaMock.pipelineRun?.findUnique.mockResolvedValue(null as never);
    const caller = makeCaller();
    await expect(caller.admin.getTestRun({ id: "missing" })).rejects.toThrow();
  });
});
