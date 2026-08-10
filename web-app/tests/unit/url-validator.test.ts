import { vi, describe, it, expect, beforeEach } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

const prismaMock = vi.hoisted(() => ({
  documentChunk: { findMany: vi.fn() },
}));
vi.mock("@/server/db", () => ({ prisma: prismaMock }));

import { assertSafeUrl } from "@/server/lib/security/url-validator";
import { SsrfBlockedError } from "@/server/lib/errors";
import { PrismaCorpusProvider } from "@/server/rag/retrieval/corpus";

describe("assertSafeUrl (SSRF guard)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects malformed URLs", async () => {
    await expect(assertSafeUrl("not a url")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("rejects non-http(s) protocols", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertSafeUrl("ftp://example.com")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("rejects IPv4 loopback", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(assertSafeUrl("https://example.com")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("rejects IPv6 loopback", async () => {
    lookupMock.mockResolvedValue([{ address: "::1", family: 6 }]);
    await expect(assertSafeUrl("https://example.com")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("rejects RFC1918 private ranges (10/8, 172.16/12, 192.168/16)", async () => {
    for (const address of ["10.1.2.3", "172.20.5.5", "192.168.1.1"]) {
      lookupMock.mockResolvedValue([{ address, family: 4 }]);
      await expect(assertSafeUrl("https://example.com")).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  it("rejects IPv6 link-local and unique-local (ULA) ranges", async () => {
    for (const address of ["fe80::1", "fe80::a1b2:c3d4", "fc00::1", "fd12:3456:789a::1"]) {
      lookupMock.mockResolvedValue([{ address, family: 6 }]);
      await expect(assertSafeUrl("https://example.com")).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  it("rejects IPv4-mapped IPv6 forms of blocked IPv4 addresses", async () => {
    // ::ffff:127.0.0.1 → loopback, ::ffff:10.0.0.1 → RFC1918,
    // ::ffff:169.254.169.254 → cloud metadata. All must be caught even though
    // the literal string is an IPv6 address.
    for (const address of ["::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254"]) {
      lookupMock.mockResolvedValue([{ address, family: 6 }]);
      await expect(assertSafeUrl("https://example.com")).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  it("rejects IPv4-compatible IPv6 forms of loopback", async () => {
    lookupMock.mockResolvedValue([{ address: "::127.0.0.1", family: 6 }]);
    await expect(assertSafeUrl("https://example.com")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("rejects the IPv6 unspecified address", async () => {
    lookupMock.mockResolvedValue([{ address: "::", family: 6 }]);
    await expect(assertSafeUrl("https://example.com")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("accepts public IPv6 hosts outside blocked ranges", async () => {
    lookupMock.mockResolvedValue([{ address: "2606:4700::6810:84e5", family: 6 }]);
    await expect(assertSafeUrl("https://example.com")).resolves.toBeUndefined();
  });

  it("rejects link-local and cloud-metadata IPs", async () => {
    for (const address of ["169.254.1.1", "169.254.169.254"]) {
      lookupMock.mockResolvedValue([{ address, family: 4 }]);
      await expect(assertSafeUrl("https://example.com")).rejects.toBeInstanceOf(SsrfBlockedError);
    }
  });

  it("rejects when any of several resolved addresses is blocked", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    await expect(assertSafeUrl("https://example.com")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("accepts a public host that resolves outside blocked ranges", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    await expect(assertSafeUrl("https://example.com")).resolves.toBeUndefined();
  });

  // Regression: macOS/Linux resolvers return IPv6 addresses in UNCOMPRESSED
  // form (no "::") — e.g. getaddrinfo returns "2606:4700:8392:2270:1639:83a:
  // 291c:7105" for www.fintiba.com. The parser must not crash on the missing
  // right-hand side of split("::").
  it("accepts an uncompressed public IPv6 address (no '::')", async () => {
    lookupMock.mockResolvedValue([
      { address: "2606:4700:8392:2270:1639:83a:291c:7105", family: 6 },
    ]);
    await expect(assertSafeUrl("https://www.fintiba.com")).resolves.toBeUndefined();
  });

  it("blocks an uncompressed IPv6 loopback (no '::')", async () => {
    lookupMock.mockResolvedValue([{ address: "0:0:0:0:0:0:0:1", family: 6 }]);
    await expect(assertSafeUrl("https://example.com")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("blocks an uncompressed IPv4-mapped loopback (no '::')", async () => {
    // 0:0:0:0:0:ffff:7f00:1 == ::ffff:127.0.0.1 written without compression.
    lookupMock.mockResolvedValue([{ address: "0:0:0:0:0:ffff:7f00:1", family: 6 }]);
    await expect(assertSafeUrl("https://example.com")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("blocks an uncompressed IPv6 link-local address (no '::')", async () => {
    lookupMock.mockResolvedValue([{ address: "fe80:0:0:0:0:0:0:1", family: 6 }]);
    await expect(assertSafeUrl("https://example.com")).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});

describe("PrismaCorpusProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const row = {
    id: 1,
    parentId: null,
    documentId: "doc-1",
    sourceName: "Example",
    sourceUrl: "https://example.com",
    text: "hello",
  };

  it("loads all chunks across batches and maps ids to strings", async () => {
    prismaMock.documentChunk.findMany.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    const provider = new PrismaCorpusProvider();
    const chunks = await provider.loadChunks();
    expect(chunks).toEqual([
      {
        id: "1",
        parentId: undefined,
        documentId: "doc-1",
        sourceName: "Example",
        sourceUrl: "https://example.com",
        text: "hello",
      },
    ]);
    expect(prismaMock.documentChunk.findMany).toHaveBeenCalledTimes(2);
  });

  it("serves the cached corpus within the TTL without querying again", async () => {
    prismaMock.documentChunk.findMany.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    const provider = new PrismaCorpusProvider();
    const first = await provider.loadChunks();
    const second = await provider.loadChunks();
    expect(first).toEqual(second);
    expect(prismaMock.documentChunk.findMany).toHaveBeenCalledTimes(2);
  });

  it("invalidates the cache so the next load re-queries", async () => {
    prismaMock.documentChunk.findMany
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([]);
    const provider = new PrismaCorpusProvider();
    await provider.loadChunks();
    await provider.invalidate();
    await provider.loadChunks();
    expect(prismaMock.documentChunk.findMany).toHaveBeenCalledTimes(4);
  });
});
