import { vi, describe, it, expect, beforeEach } from "vitest";
import { appRouter } from "@/server/trpc/router";
import type { Context } from "@/server/trpc/context";

vi.mock("@/server/db", () => ({
  prisma: {
    document: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    documentChunk: {},
    semanticCacheEntry: {},
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/server/ingest/jobs", () => ({
  enqueueUrlJob: vi.fn(),
  enqueueSyncJobs: vi.fn(),
  getJob: vi.fn(),
  getJobStats: vi.fn(),
}));

vi.mock("@/server/rag/cache/semantic-cache", () => ({
  semanticCache: { invalidateForDocument: vi.fn() },
}));

vi.mock("@/server/rag/instance", () => ({
  getCorpusProvider: () => ({ invalidate: vi.fn() }),
}));

vi.mock("@/server/lib/security/url-validator", () => ({
  assertSafeUrl: vi.fn(),
}));

import { prisma } from "@/server/db";
import { enqueueUrlJob, enqueueSyncJobs, getJob, getJobStats } from "@/server/ingest/jobs";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { assertSafeUrl } from "@/server/lib/security/url-validator";

const prismaMock = prisma as unknown as {
  document: { findUnique: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
};
const mockedEnqueueUrl = vi.mocked(enqueueUrlJob);
const mockedEnqueueSync = vi.mocked(enqueueSyncJobs);
const mockedGetJob = vi.mocked(getJob);
const mockedGetJobStats = vi.mocked(getJobStats);
const mockedInvalidate = vi.mocked(semanticCache.invalidateForDocument);
const mockedAssertSafeUrl = vi.mocked(assertSafeUrl);

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

describe("document router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAssertSafeUrl.mockResolvedValue();
  });

  it("requires the ADMIN role", async () => {
    const caller = makeCaller("USER");
    await expect(caller.document.delete({ id: "d1" })).rejects.toThrow();
    await expect(caller.document.ingestUrl({ url: "https://example.com" })).rejects.toThrow();
    await expect(caller.document.sync({ force: false })).rejects.toThrow();
  });

  it("delete: removes a document and invalidates cache + corpus", async () => {
    prismaMock.document.findUnique.mockResolvedValue({
      id: "d1",
      title: "Blocked Account",
      chunkCount: 8,
    } as never);
    prismaMock.document.delete.mockResolvedValue({} as never);
    mockedInvalidate.mockResolvedValue(4);

    const caller = makeCaller();
    const result = await caller.document.delete({ id: "d1" });
    expect(result.deletedChunks).toBe(8);
    expect(result.cacheInvalidated).toBe(4);
    expect(mockedInvalidate).toHaveBeenCalledWith("d1");
  });

  it("delete: throws NotFoundError for missing documents", async () => {
    prismaMock.document.findUnique.mockResolvedValue(null);
    const caller = makeCaller();
    await expect(caller.document.delete({ id: "missing" })).rejects.toThrow();
  });

  it("ingestUrl: SSRF-validates then enqueues a background job", async () => {
    mockedEnqueueUrl.mockResolvedValue({ jobId: "job-1", queued: true });
    const caller = makeCaller();
    const result = await caller.document.ingestUrl({ url: "https://example.com/visa" });
    expect(mockedAssertSafeUrl).toHaveBeenCalledWith("https://example.com/visa");
    expect(result).toEqual({ jobId: "job-1", queued: true });
    expect(mockedEnqueueUrl).toHaveBeenCalledWith("https://example.com/visa", { title: undefined });
  });

  it("ingestUrl: forwards an optional title override to the job", async () => {
    mockedEnqueueUrl.mockResolvedValue({ jobId: "job-1", queued: true });
    const caller = makeCaller();
    await caller.document.ingestUrl({
      url: "https://example.com/visa",
      title: "Visa Guide Custom",
    });
    expect(mockedEnqueueUrl).toHaveBeenCalledWith("https://example.com/visa", {
      title: "Visa Guide Custom",
    });
  });

  it("ingestUrl: propagates SSRF blocks before enqueueing", async () => {
    mockedAssertSafeUrl.mockRejectedValue(new Error("SSRF blocked"));
    const caller = makeCaller();
    await expect(caller.document.ingestUrl({ url: "http://127.0.0.1/x" })).rejects.toThrow(
      "SSRF blocked",
    );
    expect(mockedEnqueueUrl).not.toHaveBeenCalled();
  });

  it("sync: enqueues one job per document and reports dedup", async () => {
    mockedEnqueueSync.mockResolvedValue({ jobIds: ["j1", "j2"], enqueued: 2, alreadyPending: 1 });
    const caller = makeCaller();
    const result = await caller.document.sync({ force: false });
    expect(result.enqueued).toBe(2);
    expect(result.alreadyPending).toBe(1);
    expect(mockedEnqueueSync).toHaveBeenCalledWith({ force: false });
  });

  it("jobGet: returns the pollable job view", async () => {
    mockedGetJob.mockResolvedValue({
      id: "job-1",
      type: "URL",
      status: "RUNNING",
      error: null,
      result: null,
      createdAt: new Date(),
      finishedAt: null,
    });
    const caller = makeCaller();
    const job = await caller.document.jobGet({ id: "job-1" });
    expect(job.status).toBe("RUNNING");
  });

  it("jobGet: throws NotFoundError when the job was pruned", async () => {
    mockedGetJob.mockResolvedValue(null);
    const caller = makeCaller();
    await expect(caller.document.jobGet({ id: "gone" })).rejects.toThrow();
  });

  it("jobStats: reports queue depth", async () => {
    mockedGetJobStats.mockResolvedValue({
      queued: 3,
      running: 1,
      done24h: 5,
      failed24h: 0,
    });
    const caller = makeCaller();
    const stats = await caller.document.jobStats();
    expect(stats.queued).toBe(3);
    expect(stats.running).toBe(1);
  });
});
