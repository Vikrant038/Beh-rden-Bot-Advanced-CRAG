import { vi, describe, it, expect, beforeEach } from "vitest";
import { appRouter } from "@/server/trpc/router";
import type { Context } from "@/server/trpc/context";

vi.mock("@/server/db", () => ({
  prisma: {
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    conversation: { count: vi.fn() },
    message: { count: vi.fn() },
    document: { count: vi.fn() },
    semanticCacheEntry: {
      deleteMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

import { prisma } from "@/server/db";
import type { MockPrisma } from "../helpers/mock-prisma";

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

describe("admin router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires the ADMIN role", async () => {
    const caller = makeCaller("USER");
    await expect(caller.admin.metrics()).rejects.toThrow();
  });

  it("metrics: aggregates usage statistics", async () => {
    prismaMock.user.count.mockResolvedValue(5 as never);
    prismaMock.conversation.count.mockResolvedValue(10 as never);
    prismaMock.message.count.mockResolvedValue(50 as never);
    prismaMock.document.count.mockResolvedValue(3 as never);
    prismaMock.$queryRaw.mockResolvedValue([
      { assistantCount: 40, cacheHits: 12, avgLatencyMs: 810.5 },
    ] as never);

    const caller = makeCaller();
    const result = await caller.admin.metrics();

    expect(result.totalUsers).toBe(5);
    expect(result.totalConversations).toBe(10);
    expect(result.totalMessages).toBe(50);
    expect(result.queriesToday).toBe(50);
    expect(result.documentCount).toBe(3);
    expect(result.cacheHitRate).toBeCloseTo(0.3);
    expect(result.avgLatencyMs).toBeCloseTo(810.5);
  });

  it("metrics: degrades gracefully when aggregation fails", async () => {
    prismaMock.user.count.mockResolvedValue(1 as never);
    prismaMock.conversation.count.mockResolvedValue(1 as never);
    prismaMock.message.count.mockResolvedValue(1 as never);
    prismaMock.document.count.mockResolvedValue(0 as never);
    prismaMock.$queryRaw.mockRejectedValue(new Error("db down"));

    const caller = makeCaller();
    const result = await caller.admin.metrics();
    expect(result.cacheHitRate).toBe(0);
    expect(result.avgLatencyMs).toBe(0);
  });

  it("clearCache: wipes the semantic cache", async () => {
    prismaMock.semanticCacheEntry.deleteMany.mockResolvedValue({ count: 3 } as never);
    const caller = makeCaller();
    const result = await caller.admin.clearCache();
    expect(result.cleared).toBe(true);
  });

  it("users: lists users with conversation counts", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: "u1",
        name: "Alice",
        email: "alice@example.com",
        role: "USER",
        createdAt: new Date(),
        _count: { conversations: 4 },
      },
    ] as never);

    const caller = makeCaller();
    const result = await caller.admin.users();
    expect(result[0].conversationCount).toBe(4);
    expect(result[0].role).toBe("USER");
  });

  it("dailyQueries: returns a time series of user queries", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { date: "2026-07-28", count: 3 },
      { date: "2026-07-29", count: 5 },
    ] as never);
    const caller = makeCaller();
    const result = await caller.admin.dailyQueries();
    expect(result).toEqual([
      { date: "2026-07-28", count: 3 },
      { date: "2026-07-29", count: 5 },
    ]);
  });

  it("dailyQueries: falls back to empty list on aggregation failure", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("db down"));
    const caller = makeCaller();
    const result = await caller.admin.dailyQueries();
    expect(result).toEqual([]);
  });

  it("modeSplit: groups assistant messages by engine mode", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { mode: "agentic", count: 8 },
      { mode: "standard", count: 2 },
    ] as never);
    const caller = makeCaller();
    const result = await caller.admin.modeSplit();
    expect(result).toEqual([
      { mode: "agentic", count: 8 },
      { mode: "standard", count: 2 },
    ]);
  });

  it("modeSplit: falls back to empty list on aggregation failure", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("db down"));
    const caller = makeCaller();
    const result = await caller.admin.modeSplit();
    expect(result).toEqual([]);
  });

  it("recentQueries: returns the latest queries with pipeline outcome", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: "m1",
        query: "How do I open a blocked account?",
        createdAt: new Date("2026-07-31T10:00:00Z"),
        mode: "agentic",
        latencyMs: 812.5,
        isCached: false,
        retrievalPath: "AGENTIC_3_AGENT_REACT",
      },
      {
        id: "m2",
        query: "Visa fee?",
        createdAt: new Date("2026-07-31T09:00:00Z"),
        mode: "standard",
        latencyMs: 1.2,
        isCached: true,
        retrievalPath: "TIER_2_VECTOR_CACHE_HIT (Sim: 0.980)",
      },
    ] as never);
    const caller = makeCaller();
    const result = await caller.admin.recentQueries();
    expect(result).toHaveLength(2);
    expect(result[0].mode).toBe("agentic");
    expect(result[1].isCached).toBe(true);
  });

  it("recentQueries: falls back to empty list on aggregation failure", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("db down"));
    const caller = makeCaller();
    const result = await caller.admin.recentQueries();
    expect(result).toEqual([]);
  });
});
