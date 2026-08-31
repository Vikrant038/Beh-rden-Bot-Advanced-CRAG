import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  prisma: {
    pipelineRun: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/server/rag/cache/semantic-cache", () => ({
  semanticCache: { clearAll: vi.fn(), invalidateForDocument: vi.fn() },
}));

vi.mock("@/server/rag/agents/orchestrator", () => ({
  runAgenticRag: vi.fn(),
}));

vi.mock("@/server/rag/instance", () => ({
  getHybridRetriever: () => ({ retrieve: vi.fn() }),
}));

vi.mock("@/server/rag/disambiguation", () => ({
  disambiguateQuery: vi.fn(),
}));

vi.mock("@/server/pii/masker", () => ({
  maskPii: vi.fn((text: string) => ({ text, masked: text })),
}));

import { prisma } from "@/server/db";
import { runAgenticRag } from "@/server/rag/agents/orchestrator";
import { disambiguateQuery } from "@/server/rag/disambiguation";
import { executePipelineTest, formatDebugError } from "@/server/routers/admin";
import type { MockPrisma } from "../helpers/mock-prisma";
import { makeUserCaller } from "../helpers/caller";

const prismaMock = prisma as unknown as MockPrisma;
const mockedRunAgenticRag = vi.mocked(runAgenticRag);
const mockedDisambiguate = vi.mocked(disambiguateQuery);

const makeCaller = (role: "USER" | "ADMIN" = "ADMIN") => makeUserCaller(prismaMock, role);

const runningRow = {
  id: "run-1",
  prompt: "Is APS mandatory?",
  traceJson: {},
  latencyMs: 0,
  status: "RUNNING",
  error: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
};

const successRow = {
  ...runningRow,
  status: "SUCCESS",
  latencyMs: 12_345,
  traceJson: { totalLatencyMs: 12_345 },
};

describe("admin pipeline-run procedures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDisambiguate.mockResolvedValue({
      isAmbiguous: false,
      options: [],
    } as never);
  });

  it("requires the ADMIN role", async () => {
    const caller = makeCaller("USER");
    await expect(caller.admin.testPipeline({ prompt: "hello world" })).rejects.toThrow();
    await expect(caller.admin.getTestRun({ id: "run-1" })).rejects.toThrow();
    await expect(caller.admin.listTestRuns()).rejects.toThrow();
  });

  it("testPipeline: creates a RUNNING row and returns the runId instantly", async () => {
    prismaMock.pipelineRun.create.mockResolvedValue(runningRow as never);
    prismaMock.pipelineRun.update.mockResolvedValue({ id: "run-1" } as never);
    mockedRunAgenticRag.mockResolvedValue({ totalLatencyMs: 100, answer: "yes" } as never);
    const caller = makeCaller();
    const result = await caller.admin.testPipeline({ prompt: "Is APS mandatory?" });

    expect(result.runId).toBe("run-1");
    expect(prismaMock.pipelineRun.create).toHaveBeenCalledWith({
      data: {
        prompt: "Is APS mandatory?",
        traceJson: {},
        latencyMs: 0,
        status: "RUNNING",
      },
    });
  });

  it("listTestRuns: paginates run history and maps statuses", async () => {
    prismaMock.pipelineRun.findMany.mockResolvedValue([
      {
        ...successRow,
        id: "run-3",
        status: "SUCCESS",
        createdAt: new Date("2026-08-03T00:00:00Z"),
      },
      {
        ...runningRow,
        id: "run-2",
        status: "RUNNING",
        createdAt: new Date("2026-08-02T00:00:00Z"),
      },
      {
        ...runningRow,
        id: "run-1",
        status: "FAILED",
        error: "boom",
        latencyMs: 5,
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
    ] as never);

    const caller = makeCaller();
    const result = await caller.admin.listTestRuns({ limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].status).toBe("SUCCESS");
    expect(result.items[1].status).toBe("RUNNING");
    // A third row beyond the limit yields a nextCursor keyed on the last item.
    expect(result.nextCursor).toEqual({
      createdAt: new Date("2026-08-02T00:00:00Z"),
      id: "run-2",
    });
  });

  it("listTestRuns: passes a keyset cursor through to the query", async () => {
    prismaMock.pipelineRun.findMany.mockResolvedValue([] as never);
    const caller = makeCaller();
    const cursor = { createdAt: new Date("2026-08-01T00:00:00Z"), id: "run-9" };
    await caller.admin.listTestRuns({ cursor });
    expect(prismaMock.pipelineRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        },
      }),
    );
  });

  it("getTestRun: returns a stored run with its trace", async () => {
    prismaMock.pipelineRun.findUnique.mockResolvedValue(successRow as never);
    const caller = makeCaller();
    const result = await caller.admin.getTestRun({ id: "run-1" });
    expect(result.status).toBe("SUCCESS");
    expect(result.traceJson).toEqual({ totalLatencyMs: 12_345 });
  });

  it("getTestRun: throws NotFoundError for a missing run", async () => {
    prismaMock.pipelineRun.findUnique.mockResolvedValue(null as never);
    const caller = makeCaller();
    await expect(caller.admin.getTestRun({ id: "ghost" })).rejects.toThrow();
  });
});

describe("executePipelineTest (background worker contract)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDisambiguate.mockResolvedValue({ isAmbiguous: false, options: [] } as never);
    prismaMock.pipelineRun.findMany.mockResolvedValue([] as never);
  });

  it("persists a SUCCESS row with the trace and latency on completion", async () => {
    mockedRunAgenticRag.mockResolvedValue({
      totalLatencyMs: 5000,
      answer: "yes",
    } as never);
    prismaMock.pipelineRun.update.mockResolvedValue({ id: "run-1" } as never);

    await executePipelineTest("run-1", {
      prompt: "Is APS mandatory?",
      bypassCache: true,
      debug: false,
    });

    expect(prismaMock.pipelineRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({ status: "SUCCESS", latencyMs: 5000 }),
      }),
    );
  });

  it("persists a FAILED row with the raw message when debug is off", async () => {
    mockedRunAgenticRag.mockRejectedValue(new Error("Groq quota exceeded"));
    prismaMock.pipelineRun.update.mockResolvedValue({ id: "run-1" } as never);

    await executePipelineTest("run-1", {
      prompt: "Is APS mandatory?",
      bypassCache: true,
      debug: false,
    });

    const updateCall = prismaMock.pipelineRun.update.mock.calls[0] ?? [];
    expect(updateCall[0]).toMatchObject({ data: { status: "FAILED" } });
  });

  it("persists the full debug detail (name/cause/stack) when debug is on", async () => {
    const root = new Error("root cause");
    const wrapped = new Error("wrapped failure", { cause: root });
    mockedRunAgenticRag.mockRejectedValue(wrapped);
    prismaMock.pipelineRun.update.mockResolvedValue({ id: "run-1" } as never);

    await executePipelineTest("run-1", {
      prompt: "Is APS mandatory?",
      bypassCache: true,
      debug: true,
    });

    const updateCall = prismaMock.pipelineRun.update.mock.calls[0] ?? [];
    const data = updateCall[0] as { data: { error: string } };
    expect(data.data.error).toContain("Error: wrapped failure");
    expect(data.data.error).toContain("Cause: Error: root cause");
  });

  it("does not throw when persisting the FAILED row fails (best-effort)", async () => {
    mockedRunAgenticRag.mockRejectedValue(new Error("boom"));
    prismaMock.pipelineRun.update.mockRejectedValue(new Error("db write failed"));

    await expect(
      executePipelineTest("run-1", {
        prompt: "Is APS mandatory?",
        bypassCache: true,
        debug: false,
      }),
    ).resolves.toBeUndefined();
  });

  it("prunes old runs so only the 10 newest terminal runs remain", async () => {
    mockedRunAgenticRag.mockResolvedValue({ totalLatencyMs: 100, answer: "yes" } as never);
    prismaMock.pipelineRun.update.mockResolvedValue({ id: "run-1" } as never);
    prismaMock.pipelineRun.findMany.mockResolvedValue([
      { id: "run-10" },
      { id: "run-9" },
      { id: "run-8" },
      { id: "run-7" },
      { id: "run-6" },
      { id: "run-5" },
      { id: "run-4" },
      { id: "run-3" },
      { id: "run-2" },
      { id: "run-1" },
    ] as never);
    prismaMock.pipelineRun.deleteMany.mockResolvedValue({ count: 3 } as never);

    await executePipelineTest("run-1", {
      prompt: "Is APS mandatory?",
      bypassCache: true,
      debug: false,
    });

    // Keeps the newest MAX_PIPELINE_RUNS=10 and deletes everything older.
    expect(prismaMock.pipelineRun.findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
      select: { id: true },
    });
    expect(prismaMock.pipelineRun.deleteMany).toHaveBeenCalledWith({
      where: {
        id: {
          notIn: [
            "run-10",
            "run-9",
            "run-8",
            "run-7",
            "run-6",
            "run-5",
            "run-4",
            "run-3",
            "run-2",
            "run-1",
          ],
        },
        status: { not: "RUNNING" },
      },
    });
  });

  it("prune failure is swallowed — the run outcome is unaffected", async () => {
    mockedRunAgenticRag.mockResolvedValue({ totalLatencyMs: 100, answer: "yes" } as never);
    prismaMock.pipelineRun.update.mockResolvedValue({ id: "run-1" } as never);
    prismaMock.pipelineRun.findMany.mockRejectedValue(new Error("db down"));

    await expect(
      executePipelineTest("run-1", {
        prompt: "Is APS mandatory?",
        bypassCache: true,
        debug: false,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("formatDebugError", () => {
  it("formats an Error with an Error cause and a stack", () => {
    const err = new Error("outer", { cause: new Error("inner") });
    err.stack = "Error: outer\n  at fn (file.ts:1:1)";
    const out = formatDebugError(err);
    expect(out).toContain("[Error] outer");
    expect(out).toContain("Cause: Error: inner");
    expect(out).toContain("fn (file.ts:1:1)");
  });

  it("formats a string cause and a missing stack", () => {
    const err = new Error("plain");
    err.cause = "raw string cause";
    err.stack = undefined;
    const out = formatDebugError(err);
    expect(out).toContain("Cause: raw string cause");
    expect(out).toContain("(no stack captured)");
  });

  it("formats a non-Error value", () => {
    expect(formatDebugError("oops")).toBe("[UnknownError] oops");
    expect(formatDebugError(42)).toBe("[UnknownError] 42");
  });
});
