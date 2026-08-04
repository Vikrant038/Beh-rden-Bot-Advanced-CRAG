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

import { ingestUrl, ingestPdf } from "@/server/ingest/pipeline";
import {
  enqueueUrlJob,
  enqueuePdfJob,
  enqueueSyncJobs,
  processIngestJobs,
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
    stubClaim({
      id: "job-1",
      type: "URL",
      url: "https://example.com/a",
      title: null,
      filename: null,
      payload: null,
      force: false,
    });
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
    expect(mockedIngestUrl).toHaveBeenCalledWith("https://example.com/a", {
      title: undefined,
      force: false,
    });
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
    stubClaim({
      id: "job-2",
      type: "URL",
      url: "https://example.com/bad",
      title: null,
      filename: null,
      payload: null,
      force: false,
    });
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
    stubClaim({
      id: "job-3",
      type: "PDF",
      url: null,
      title: "Antrag",
      filename: "antrag.pdf",
      payload: buffer,
      force: false,
    });
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
    expect(mockedIngestPdf).toHaveBeenCalledWith(buffer, "antrag.pdf", { title: "Antrag" });
  });

  it("returns remaining queue depth when work is left", async () => {
    stubClaim({
      id: "job-4",
      type: "URL",
      url: "https://example.com/c",
      title: null,
      filename: null,
      payload: null,
      force: false,
    });
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
