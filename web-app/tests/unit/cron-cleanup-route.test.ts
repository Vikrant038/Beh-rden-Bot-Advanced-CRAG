import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  prisma: {
    semanticCacheEntry: { deleteMany: vi.fn() },
  },
}));

vi.mock("@/server/env", () => ({
  env: { CRON_SECRET: "super-secret" },
}));

import { prisma } from "@/server/db";
import { GET } from "@/app/api/cron/cleanup-cache/route";

const prismaMock = prisma as unknown as {
  semanticCacheEntry: { deleteMany: ReturnType<typeof vi.fn> };
};

function makeRequest(authorization?: string): Request {
  const headers = new Headers();
  if (authorization) {
    headers.set("authorization", authorization);
  }
  return new Request("https://behoerden.local/api/cron/cleanup-cache", { headers });
}

describe("cleanup-cache cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests without the cron secret", async () => {
    const response = await GET(makeRequest());
    expect(response.status).toBe(401);
    expect(prismaMock.semanticCacheEntry.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects requests with the wrong cron secret", async () => {
    const response = await GET(makeRequest("Bearer wrong-secret"));
    expect(response.status).toBe(401);
  });

  it("deletes expired cache entries when the secret matches", async () => {
    prismaMock.semanticCacheEntry.deleteMany.mockResolvedValue({ count: 12 } as never);
    const response = await GET(makeRequest("Bearer super-secret"));
    expect(response.status).toBe(200);
    expect(prismaMock.semanticCacheEntry.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: expect.any(Date) } },
    });
    const body = (await response.json()) as { success: boolean; deleted: number };
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(12);
  });

  it("returns 500 when deletion fails", async () => {
    prismaMock.semanticCacheEntry.deleteMany.mockRejectedValue(new Error("db down"));
    const response = await GET(makeRequest("Bearer super-secret"));
    expect(response.status).toBe(500);
  });
});
