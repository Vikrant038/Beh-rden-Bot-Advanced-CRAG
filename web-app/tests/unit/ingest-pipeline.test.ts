vi.mock("@/server/ingest/pdf-parser", () => ({
  parsePdf: vi.fn(),
}));

import { vi, describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";

vi.mock("@/server/db", () => {
  const tx = {
    document: { upsert: vi.fn(), update: vi.fn() },
    documentParentChunk: { deleteMany: vi.fn(), create: vi.fn() },
    $executeRaw: vi.fn(),
  };
  return {
    prisma: {
      document: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
      documentParentChunk: { deleteMany: vi.fn(), create: vi.fn() },
      documentChunk: { deleteMany: vi.fn(), updateMany: vi.fn() },
      semanticCacheEntry: { findMany: vi.fn(), deleteMany: vi.fn() },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(tx)),
      $executeRaw: vi.fn(),
    },
    __tx: tx,
  };
});

vi.mock("@/server/ingest/scraper", () => ({
  scrapeWebPage: vi.fn(),
}));

vi.mock("@/server/rag/instance", () => ({
  getCorpusProvider: () => ({ invalidate: vi.fn() }),
}));

vi.mock("@/server/rag/cache/semantic-cache", () => ({
  semanticCache: { invalidateForDocument: vi.fn() },
}));

import { prisma } from "@/server/db";
import { cleanText } from "@/server/ingest/cleaner";
import { ingestUrl, syncAllDocuments, pdfSourceKey, ingestPdf } from "@/server/ingest/pipeline";
import { scrapeWebPage } from "@/server/ingest/scraper";
import { parsePdf } from "@/server/ingest/pdf-parser";
import { semanticCache } from "@/server/rag/cache/semantic-cache";

const prismaMock = prisma as unknown as {
  document: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  documentParentChunk: { deleteMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  documentChunk: { deleteMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  semanticCacheEntry: { findMany: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
};

const txMock = (await import("@/server/db")) as unknown as {
  __tx: {
    document: { upsert: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    documentParentChunk: { deleteMany: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    $executeRaw: ReturnType<typeof vi.fn>;
  };
};

const mockedParsePdf = vi.mocked(parsePdf);

const mockedScrape = vi.mocked(scrapeWebPage);
const mockedCache = vi.mocked(semanticCache.invalidateForDocument);

const MOCK_LINES = Array.from(
  { length: 40 },
  (_, i) =>
    `German visa rule ${i + 1}: student applicants must prove sufficient financial resources, valid health insurance, and a confirmed university admission for the full course of study.`,
);
const MOCK_TEXT = MOCK_LINES.join("\n");

function fakeEmbeddingClient() {
  return {
    embedTexts: vi.fn(async (texts: string[]) => texts.map((_, i) => [0.1, 0.2, i])),
    embedQuery: vi.fn(async () => [0.1]),
  };
}

describe("ingestUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedScrape.mockResolvedValue({
      title: "German Student Visa Guide",
      url: "https://www.example.com/visa-guide",
      text: MOCK_TEXT,
    });
    txMock.__tx.document.upsert.mockResolvedValue({ id: "doc-1" });
    txMock.__tx.document.update.mockResolvedValue({ id: "doc-1", chunkCount: 5 });
    txMock.__tx.documentParentChunk.create.mockResolvedValue({ id: "parent-1" });
    prismaMock.document.findUnique.mockResolvedValue(null);
    mockedCache.mockResolvedValue(2);
  });

  it("creates a new document with chunks and embeddings", async () => {
    const result = await ingestUrl("https://www.example.com/visa-guide", {
      embeddingClient: fakeEmbeddingClient(),
    });

    expect(result.status).toBe("created");
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.title).toBe("German Student Visa Guide");
    expect(txMock.__tx.document.upsert).toHaveBeenCalled();
    expect(txMock.__tx.documentParentChunk.deleteMany).toHaveBeenCalled();
    expect(txMock.__tx.$executeRaw).toHaveBeenCalled();
    expect(txMock.__tx.document.update).toHaveBeenCalled();
    expect(mockedCache).toHaveBeenCalledWith("doc-1");
    expect(result.cacheInvalidated).toBe(2);
  });

  it("uses the provided title override instead of the scraped title", async () => {
    const result = await ingestUrl("https://www.example.com/visa-guide", {
      embeddingClient: fakeEmbeddingClient(),
      title: "My Custom Name",
    });

    expect(result.title).toBe("My Custom Name");
    expect(txMock.__tx.document.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ title: "My Custom Name" }),
      }),
    );
  });

  it("updates the stored title even when content is unchanged", async () => {
    const expectedHash = createHash("sha256").update(cleanText(MOCK_TEXT)).digest("hex");
    prismaMock.document.findUnique.mockResolvedValue({
      id: "doc-1",
      url: "https://www.example.com/visa-guide",
      title: "Old Messy Title",
      hash: expectedHash,
      chunkCount: 7,
    });

    const result = await ingestUrl("https://www.example.com/visa-guide", {
      embeddingClient: fakeEmbeddingClient(),
      title: "Clean Title",
    });

    expect(result.status).toBe("skipped");
    expect(result.title).toBe("Clean Title");
    expect(prismaMock.document.update).toHaveBeenCalledWith({
      where: { url: "https://www.example.com/visa-guide" },
      data: { title: "Clean Title" },
    });
    expect(prismaMock.documentChunk.updateMany).toHaveBeenCalledWith({
      where: { documentId: "doc-1" },
      data: { sourceName: "Clean Title" },
    });
    expect(txMock.__tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("skips unchanged documents (idempotent)", async () => {
    mockedScrape.mockResolvedValue({
      title: "German Student Visa Guide",
      url: "https://www.example.com/visa-guide",
      text: MOCK_TEXT,
    });
    const expectedHash = createHash("sha256").update(cleanText(MOCK_TEXT)).digest("hex");
    prismaMock.document.findUnique.mockResolvedValue({
      id: "doc-1",
      url: "https://www.example.com/visa-guide",
      hash: expectedHash,
      chunkCount: 7,
    });

    const result = await ingestUrl("https://www.example.com/visa-guide", {
      embeddingClient: fakeEmbeddingClient(),
    });

    expect(result.status).toBe("skipped");
    expect(result.chunkCount).toBe(7);
    expect(txMock.__tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("updates an existing document when content changed", async () => {
    prismaMock.document.findUnique.mockResolvedValue({
      id: "doc-old",
      url: "https://www.example.com/visa-guide",
      hash: "different-hash",
      chunkCount: 2,
    });
    const result = await ingestUrl("https://www.example.com/visa-guide", {
      embeddingClient: fakeEmbeddingClient(),
    });
    expect(result.status).toBe("updated");
    expect(txMock.__tx.document.upsert).toHaveBeenCalled();
  });

  it("re-embeds when force is set even if hash matches", async () => {
    prismaMock.document.findUnique.mockResolvedValue({
      id: "doc-1",
      url: "https://www.example.com/visa-guide",
      hash: "matching-hash",
      chunkCount: 7,
    });
    const result = await ingestUrl("https://www.example.com/visa-guide", {
      force: true,
      embeddingClient: fakeEmbeddingClient(),
    });
    expect(result.status).not.toBe("skipped");
    expect(txMock.__tx.$executeRaw).toHaveBeenCalled();
  });

  it("returns failed status when scraping throws", async () => {
    mockedScrape.mockRejectedValue(new Error("Could not fetch URL"));
    const result = await ingestUrl("https://www.example.com/bad", {
      embeddingClient: fakeEmbeddingClient(),
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("Could not fetch URL");
  });
  it("returns failed status when embedding throws", async () => {
    const badClient = {
      embedTexts: vi.fn(async () => {
        throw new Error("embedding service down");
      }),
      embedQuery: vi.fn(),
    };
    const result = await ingestUrl("https://www.example.com/visa-guide", {
      embeddingClient: badClient,
    });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("embedding service down");
  });
});

describe("ingestPdf (resumable)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedParsePdf.mockResolvedValue({
      text: MOCK_TEXT, // 40 lines, creates multiple chunks
      pages: 1,
      metadata: {},
    });
    txMock.__tx.document.upsert.mockResolvedValue({ id: "doc-pdf" });
    txMock.__tx.document.update.mockResolvedValue({ id: "doc-pdf", chunkCount: 5 });
    txMock.__tx.documentParentChunk.create.mockResolvedValue({ id: "parent-pdf" });
    prismaMock.document.findUnique.mockResolvedValue(null);
    mockedCache.mockResolvedValue(2);
  });

  it("yields mid-job when budget is exhausted", async () => {
    let calls = 0;
    const isBudgetExhausted = vi.fn(() => {
      calls++;
      return calls === 1; // Exhaust after first block
    });

    const result = await ingestPdf(Buffer.from("dummy"), "test.pdf", {
      embeddingClient: fakeEmbeddingClient(),
      isBudgetExhausted,
    });

    expect(result.status).toBe("progress");
    expect(result.nextBlock).toBe(1);
    expect(txMock.__tx.document.upsert).toHaveBeenCalledTimes(1);
    expect(txMock.__tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("resumes from the given block cursor", async () => {
    const expectedHash = createHash("sha256").update(cleanText(MOCK_TEXT)).digest("hex");
    prismaMock.document.findUnique.mockResolvedValue({
      id: "doc-pdf",
      url: pdfSourceKey(Buffer.from("dummy"), "test.pdf"),
      hash: expectedHash,
      chunkCount: 10,
    });

    const result = await ingestPdf(Buffer.from("dummy"), "test.pdf", {
      embeddingClient: fakeEmbeddingClient(),
      resumeFrom: 1,
    });

    expect(result.status).toBe("updated");
    expect(txMock.__tx.document.upsert).not.toHaveBeenCalled();
    expect(txMock.__tx.$executeRaw).toHaveBeenCalled();
  });
});

describe("syncAllDocuments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.document.findMany.mockResolvedValue([
      { url: "https://www.example.com/a" },
      { url: "https://www.example.com/b" },
    ]);
    mockedScrape.mockResolvedValue({
      title: "Doc",
      url: "https://www.example.com/a",
      text: MOCK_TEXT,
    });
    txMock.__tx.document.upsert.mockResolvedValue({ id: "doc-x" });
    txMock.__tx.document.update.mockResolvedValue({ id: "doc-x" });
    txMock.__tx.documentParentChunk.create.mockResolvedValue({ id: "parent-1" });
    prismaMock.document.findUnique.mockResolvedValue(null);
  });

  it("re-ingests every stored document", async () => {
    const results = await syncAllDocuments({ embeddingClient: fakeEmbeddingClient() });
    expect(prismaMock.document.findMany).toHaveBeenCalled();
    expect(results).toHaveLength(2);
    expect(mockedScrape).toHaveBeenCalledTimes(2);
  });
});

describe("pdfSourceKey", () => {
  it("is deterministic for the same buffer and filename", () => {
    const buffer = Buffer.from("%PDF-1.4\ncontent");
    expect(pdfSourceKey(buffer, "visa-guide.pdf")).toBe(pdfSourceKey(buffer, "visa-guide.pdf"));
  });

  it("produces different keys for different buffers", () => {
    const keyA = pdfSourceKey(Buffer.from("aaa"), "visa.pdf");
    const keyB = pdfSourceKey(Buffer.from("bbb"), "visa.pdf");
    expect(keyA).not.toBe(keyB);
  });

  it("is case-insensitive on the filename", () => {
    const buffer = Buffer.from("%PDF-1.4\ncontent");
    expect(pdfSourceKey(buffer, "VISA-GUIDE.PDF")).toBe(pdfSourceKey(buffer, "visa-guide.pdf"));
  });

  it("sanitizes unsafe characters in the filename", () => {
    const buffer = Buffer.from("%PDF-1.4\ncontent");
    const key = pdfSourceKey(buffer, "my file (final) v2.pdf");
    expect(key).toContain("my_file_final_v2.pdf");
  });

  it("formats as pdf://<16-hex>/<name>", () => {
    const buffer = Buffer.from("%PDF-1.4\ncontent");
    const key = pdfSourceKey(buffer, "visa.pdf");
    const match = key.match(/^pdf:\/\/([0-9a-f]{16})\/visa\.pdf$/);
    expect(match).not.toBeNull();
  });
});
