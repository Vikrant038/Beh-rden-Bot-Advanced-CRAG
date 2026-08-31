import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  prisma: {
    document: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    documentChunk: {},
    semanticCacheEntry: {},
    user: {
      findUnique: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/server/ingest/jobs", () => ({
  drainPendingJobs: vi.fn(),
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
import type { MockPrisma } from "../helpers/mock-prisma";
import {
  drainPendingJobs,
  enqueueUrlJob,
  enqueueSyncJobs,
  getJob,
  getJobStats,
} from "@/server/ingest/jobs";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { assertSafeUrl } from "@/server/lib/security/url-validator";
import { makeUserCaller } from "../helpers/caller";

const prismaMock = prisma as unknown as Pick<MockPrisma, "user"> & {
  document: {
    findUnique: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};
const mockedDrainPendingJobs = vi.mocked(drainPendingJobs);
const mockedEnqueueUrl = vi.mocked(enqueueUrlJob);
const mockedEnqueueSync = vi.mocked(enqueueSyncJobs);
const mockedGetJob = vi.mocked(getJob);
const mockedGetJobStats = vi.mocked(getJobStats);
const mockedInvalidate = vi.mocked(semanticCache.invalidateForDocument);
const mockedAssertSafeUrl = vi.mocked(assertSafeUrl);

const makeCaller = (role: "USER" | "ADMIN" = "ADMIN") => makeUserCaller(prismaMock, role);

describe("document router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAssertSafeUrl.mockResolvedValue();
    mockedDrainPendingJobs.mockResolvedValue({ drained: false, processed: 0, remaining: 0 });
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

  it("jobGet: drains pending jobs (Hobby poll-loop trigger) then returns the job", async () => {
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
    expect(mockedDrainPendingJobs).toHaveBeenCalledWith({ maxJobs: 3, timeBudgetMs: 20_000 });
    expect(job.status).toBe("RUNNING");
  });

  it("jobGet: throws NotFoundError when the job was pruned", async () => {
    mockedGetJob.mockResolvedValue(null);
    const caller = makeCaller();
    await expect(caller.document.jobGet({ id: "gone" })).rejects.toThrow();
  });

  it("jobStats: drains pending jobs then reports queue depth", async () => {
    mockedGetJobStats.mockResolvedValue({
      queued: 3,
      running: 1,
      done24h: 5,
      failed24h: 0,
    });
    const caller = makeCaller();
    const stats = await caller.document.jobStats();
    expect(mockedDrainPendingJobs).toHaveBeenCalledWith({ maxJobs: 3, timeBudgetMs: 20_000 });
    expect(stats.queued).toBe(3);
    expect(stats.running).toBe(1);
  });

  it("deleteMany: bulk-deletes owned documents and invalidates caches", async () => {
    prismaMock.document.findMany.mockResolvedValue([
      { id: "d1", chunkCount: 5 },
      { id: "d2", chunkCount: 3 },
    ] as never);
    prismaMock.document.deleteMany.mockResolvedValue({ count: 2 } as never);
    mockedInvalidate.mockResolvedValue(0);

    const caller = makeCaller();
    const result = await caller.document.deleteMany({ ids: ["d1", "d2", "d-missing"] });
    expect(result.deletedCount).toBe(2);
    expect(result.deletedChunks).toBe(8);
    expect(mockedInvalidate).toHaveBeenCalledTimes(2);
    expect(prismaMock.document.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["d1", "d2"] } },
    });
  });

  it("deleteMany: no-ops when none of the requested documents exist", async () => {
    prismaMock.document.findMany.mockResolvedValue([] as never);
    const caller = makeCaller();
    const result = await caller.document.deleteMany({ ids: ["ghost"] });
    expect(result.deletedCount).toBe(0);
    expect(result.deletedChunks).toBe(0);
    expect(prismaMock.document.deleteMany).not.toHaveBeenCalled();
    expect(mockedInvalidate).not.toHaveBeenCalled();
  });
});
