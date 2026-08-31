import { vi, describe, it, expect, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  ingestJob: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  },
  document: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@/server/db", () => ({ prisma: prismaMock }));
vi.mock("@/server/ingest/pipeline", () => ({
  ingestUrl: vi.fn(),
  ingestPdf: vi.fn(),
}));
// `runJob` builds a translation rate limiter before calling ingestUrl/ingestPdf.
// The worker tests exercise orchestration only, so stub the factory with a
// minimal limiter instead of requiring a GROQ key (absent in CI).
vi.mock("@/server/ingest/translate", () => ({
  createTranslationRateLimiter: vi.fn(() => ({
    size: 1,
    waitForTokens: vi.fn(async () => {}),
  })),
}));

import { ingestUrl, ingestPdf } from "@/server/ingest/pipeline";
import {
  drainPendingJobs,
  enqueueUrlJob,
  enqueuePdfJob,
  enqueueSyncJobs,
  processIngestJobs,
  getJob,
  getJobStats,
  isJobPending,
} from "@/server/ingest/jobs";

const mockedIngestUrl = vi.mocked(ingestUrl);
const mockedIngestPdf = vi.mocked(ingestPdf);

/** Simulates the atomic claim: findFirst returns the candidate, findUnique returns it RUNNING. */
function stubClaim(candidate: unknown) {
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
  );
  // First claim finds the candidate; any further claim finds an empty queue.
  prismaMock.ingestJob.findFirst.mockResolvedValueOnce(candidate ?? null).mockResolvedValue(null);
  prismaMock.ingestJob.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.ingestJob.findUnique.mockResolvedValue(candidate ?? null);
}

/** Minimal claimed URL job rows — the fields runJob actually reads. */
const urlJob = (id: string, url: string) => ({
  id,
  type: "URL",
  url,
  title: null,
  filename: null,
  payload: null,
  force: false,
});

const pdfJob = (
  id: string,
  filename: string,
  payload: Buffer,
  title: string | null,
  progress = 0,
) => ({
  id,
  type: "PDF",
  url: null,
  title,
  filename,
  payload,
  force: false,
  progress,
});

describe("enqueueUrlJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a job when no duplicate is pending", async () => {
    prismaMock.ingestJob.findFirst.mockResolvedValue(null);
    prismaMock.ingestJob.create.mockResolvedValue({ id: "job-1" });
    const result = await enqueueUrlJob("https://example.com/a");
    expect(result).toEqual({ jobId: "job-1", queued: true });
    expect(prismaMock.ingestJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "URL", url: "https://example.com/a" }),
      }),
    );
  });

  it("dedupes when an identical job is already QUEUED/RUNNING", async () => {
    prismaMock.ingestJob.findFirst.mockResolvedValue({ id: "job-dup" });
    const result = await enqueueUrlJob("https://example.com/a");
    expect(result).toEqual({ jobId: "job-dup", queued: false });
    expect(prismaMock.ingestJob.create).not.toHaveBeenCalled();
  });
});

describe("enqueuePdfJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the PDF buffer as bytea payload", async () => {
    prismaMock.ingestJob.create.mockResolvedValue({ id: "job-pdf" });
    const buffer = Buffer.from("%PDF-1.7 fake");
    const result = await enqueuePdfJob(buffer, "antrag.pdf", "Antrag");
    expect(result.jobId).toBe("job-pdf");
    expect(prismaMock.ingestJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "PDF",
          payload: buffer,
          filename: "antrag.pdf",
          title: "Antrag",
        }),
      }),
    );
  });
});

describe("enqueueSyncJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues one job per document and reports dedup counts", async () => {
    prismaMock.document.findMany.mockResolvedValue([
      { url: "https://a" },
      { url: "https://b" },
      { url: "https://c" },
    ]);
    prismaMock.ingestJob.findFirst.mockResolvedValue(null);
    prismaMock.ingestJob.create
      .mockResolvedValueOnce({ id: "j1" })
      .mockResolvedValueOnce({ id: "j2" })
      .mockResolvedValueOnce({ id: "j3" });

    const result = await enqueueSyncJobs({ force: true });
    expect(result.enqueued).toBe(3);
    expect(result.alreadyPending).toBe(0);
    expect(prismaMock.ingestJob.create).toHaveBeenCalledTimes(3);
  });
});

describe("processIngestJobs (cron worker)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("claims, runs, and finalizes a URL job to DONE, syncing the document", async () => {
    stubClaim(urlJob("job-1", "https://example.com/a"));
    mockedIngestUrl.mockResolvedValue({
      url: "https://example.com/a",
      title: "A",
      status: "created",
      chunkCount: 4,
      hash: "h",
      cacheInvalidated: 0,
    });
    prismaMock.ingestJob.update.mockResolvedValue({ id: "job-1" });
    prismaMock.document.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.ingestJob.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.ingestJob.count.mockResolvedValue(0);

    const result = await processIngestJobs({ maxJobs: 5, timeBudgetMs: 60_000 });

    expect(result.processed).toBe(1);
    expect(result.remaining).toBe(0);
    expect(mockedIngestUrl).toHaveBeenCalledWith(
      "https://example.com/a",
      expect.objectContaining({
        force: false,
        normalizeEnglish: true,
        rateLimiter: expect.any(Object),
      }),
    );
    expect(prismaMock.ingestJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DONE" }),
      }),
    );
    expect(prismaMock.document.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SYNCED" }) }),
    );
  });

  it("marks the job FAILED and the document FAILED when ingest fails", async () => {
    stubClaim(urlJob("job-2", "https://example.com/bad"));
    mockedIngestUrl.mockResolvedValue({
      url: "https://example.com/bad",
      title: "Bad",
      status: "failed",
      chunkCount: 0,
      hash: "h",
      cacheInvalidated: 0,
      error: "fetch failed",
    });
    prismaMock.ingestJob.update.mockResolvedValue({ id: "job-2" });
    prismaMock.document.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.ingestJob.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.ingestJob.count.mockResolvedValue(0);

    const result = await processIngestJobs({ maxJobs: 5, timeBudgetMs: 60_000 });

    expect(result.processed).toBe(1);
    expect(prismaMock.ingestJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", error: "fetch failed" }),
      }),
    );
    expect(prismaMock.document.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ url: "https://example.com/bad" }),
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });

  it("runs PDF jobs through ingestPdf with the stored payload", async () => {
    const buffer = Buffer.from("%PDF-1.7 fake");
    stubClaim(pdfJob("job-3", "antrag.pdf", buffer, "Antrag"));
    mockedIngestPdf.mockResolvedValue({
      url: "pdf://abc/antrag.pdf",
      title: "Antrag",
      status: "created",
      chunkCount: 8,
      hash: "h",
      cacheInvalidated: 0,
      filename: "antrag.pdf",
    });
    prismaMock.ingestJob.update.mockResolvedValue({ id: "job-3" });
    prismaMock.document.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.ingestJob.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.ingestJob.count.mockResolvedValue(0);

    const result = await processIngestJobs({ maxJobs: 5, timeBudgetMs: 60_000 });

    expect(result.processed).toBe(1);
    expect(mockedIngestPdf).toHaveBeenCalledWith(buffer, "antrag.pdf", {
      title: "Antrag",
      resumeFrom: 0,
      isBudgetExhausted: expect.any(Function),
      normalizeEnglish: true,
      rateLimiter: expect.any(Object),
    });
  });

  it("yields gracefully back to QUEUED when ingest returns progress status", async () => {
    const buffer = Buffer.from("%PDF-1.7 large");
    stubClaim(pdfJob("job-progress", "large.pdf", buffer, null, 5));
    mockedIngestPdf.mockResolvedValue({
      url: "pdf://abc/large.pdf",
      title: "Large",
      status: "progress",
      chunkCount: 50,
      hash: "h",
      cacheInvalidated: 0,
      filename: "large.pdf",
      nextBlock: 8,
    });
    prismaMock.ingestJob.update.mockResolvedValue({ id: "job-progress" });
    prismaMock.ingestJob.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.ingestJob.count.mockResolvedValue(1);

    const result = await processIngestJobs({ maxJobs: 5, timeBudgetMs: 60_000 });

    expect(result.processed).toBe(1);
    expect(mockedIngestPdf).toHaveBeenCalledWith(buffer, "large.pdf", {
      resumeFrom: 5,
      isBudgetExhausted: expect.any(Function),
      normalizeEnglish: true,
      rateLimiter: expect.any(Object),
    });

    expect(prismaMock.ingestJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-progress" },
        data: {
          status: "QUEUED",
          progress: 8,
          startedAt: null,
          attempts: 0,
        },
      }),
    );
  });

  it("returns remaining queue depth when work is left", async () => {
    stubClaim(urlJob("job-4", "https://example.com/c"));
    mockedIngestUrl.mockResolvedValue({
      url: "https://example.com/c",
      title: "C",
      status: "skipped",
      chunkCount: 2,
      hash: "h",
      cacheInvalidated: 0,
    });
    prismaMock.ingestJob.update.mockResolvedValue({ id: "job-4" });
    prismaMock.document.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.ingestJob.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.ingestJob.count.mockResolvedValue(7);

    const result = await processIngestJobs({ maxJobs: 5, timeBudgetMs: 60_000 });
    expect(result.processed).toBe(1);
    expect(result.remaining).toBe(7);
  });
});

describe("drainPendingJobs (Hobby on-demand drain)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no-ops (no worker tick) when the queue is empty", async () => {
    prismaMock.ingestJob.count.mockResolvedValue(0);
    const result = await drainPendingJobs();
    expect(result).toEqual({ drained: false, processed: 0, remaining: 0 });
    expect(prismaMock.ingestJob.findFirst).not.toHaveBeenCalled();
  });

  it("runs a bounded worker tick when jobs are pending", async () => {
    stubClaim(urlJob("job-drain", "https://example.com/drain"));
    mockedIngestUrl.mockResolvedValue({
      url: "https://example.com/drain",
      title: "Drain",
      status: "created",
      chunkCount: 4,
      hash: "h",
      cacheInvalidated: 0,
    });
    prismaMock.ingestJob.update.mockResolvedValue({ id: "job-drain" });
    prismaMock.document.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.ingestJob.deleteMany.mockResolvedValue({ count: 0 });
    // First count = pending check (1), second = remaining after the tick (0).
    prismaMock.ingestJob.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    const result = await drainPendingJobs({ maxJobs: 1, timeBudgetMs: 10_000 });
    expect(result).toEqual({ drained: true, processed: 1, remaining: 0 });
    expect(mockedIngestUrl).toHaveBeenCalled();
  });
});

describe("getJob / getJobStats / isJobPending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isJobPending is true for QUEUED and RUNNING only", () => {
    expect(isJobPending("QUEUED")).toBe(true);
    expect(isJobPending("RUNNING")).toBe(true);
    expect(isJobPending("DONE")).toBe(false);
    expect(isJobPending("FAILED")).toBe(false);
  });

  it("getJob maps a stored job to the admin JobView", async () => {
    const stored = {
      id: "job-1",
      type: "URL",
      status: "DONE",
      error: null,
      result: { title: "A", status: "created", chunkCount: 4 },
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      finishedAt: new Date("2026-08-01T00:01:00.000Z"),
    };
    prismaMock.ingestJob.findUnique.mockResolvedValue(stored);
    await expect(getJob("job-1")).resolves.toMatchObject({
      id: "job-1",
      type: "URL",
      status: "DONE",
    });
    expect(prismaMock.ingestJob.findUnique).toHaveBeenCalledWith({ where: { id: "job-1" } });
  });

  it("getJob returns null when the job does not exist", async () => {
    prismaMock.ingestJob.findUnique.mockResolvedValue(null);
    await expect(getJob("missing")).resolves.toBeNull();
  });

  it("getJobStats counts the queue by status over the last 24h", async () => {
    prismaMock.ingestJob.count
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(2);
    await expect(getJobStats()).resolves.toEqual({
      queued: 3,
      running: 1,
      done24h: 9,
      failed24h: 2,
    });
    expect(prismaMock.ingestJob.count).toHaveBeenCalledTimes(4);
  });
});
