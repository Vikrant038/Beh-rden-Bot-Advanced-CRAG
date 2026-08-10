import { vi, describe, it, expect, beforeEach } from "vitest";
import { appRouter } from "@/server/trpc/router";
import type { Context } from "@/server/trpc/context";

vi.mock("@/server/db", () => ({
  prisma: {
    user: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    conversation: { count: vi.fn() },
    message: {
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
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
  // isAuthenticated reads role + block status fresh from the DB.
  prismaMock.user.findUnique.mockResolvedValue({ role, blockedAt: null } as never);
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

  it("users: lists users with conversation counts and block status", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: "u1",
        name: "Alice",
        email: "alice@example.com",
        role: "USER",
        blockedAt: null,
        createdAt: new Date(),
        _count: { conversations: 4 },
      },
      {
        id: "u2",
        name: "Bob",
        email: "bob@example.com",
        role: "ADMIN",
        blockedAt: new Date("2026-08-01T00:00:00Z"),
        createdAt: new Date(),
        _count: { conversations: 1 },
      },
    ] as never);

    const caller = makeCaller();
    const result = await caller.admin.users();
    expect(result[0].conversationCount).toBe(4);
    expect(result[0].role).toBe("USER");
    expect(result[0].blockedAt).toBeNull();
    expect(result[1].blockedAt).toBeInstanceOf(Date);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: { not: { startsWith: "guest:" } } } }),
    );
  });

  it("dailyQueries: returns a time series of user queries", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { date: "2026-07-28", count: 3 },
      { date: "2026-07-29", count: 5 },
    ] as never);
    const caller = makeCaller();
    const result = await caller.admin.dailyQueries({ days: 14 });
    expect(result).toEqual([
      { date: "2026-07-28", count: 3 },
      { date: "2026-07-29", count: 5 },
    ]);
  });

  it("dailyQueries: falls back to empty list on aggregation failure", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("db down"));
    const caller = makeCaller();
    const result = await caller.admin.dailyQueries({ days: 14 });
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
        conversationId: "c1",
        query: "How do I open a blocked account?",
        createdAt: new Date("2026-07-31T10:00:00Z"),
        mode: "agentic",
        latencyMs: 812.5,
        isCached: false,
        sourceCount: 4,
      },
      {
        id: "m2",
        conversationId: "c2",
        query: "Visa fee?",
        createdAt: new Date("2026-07-31T09:00:00Z"),
        mode: "standard",
        latencyMs: 1.2,
        isCached: true,
        sourceCount: 0,
      },
    ] as never);
    const caller = makeCaller();
    const result = await caller.admin.recentQueries();
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
    expect(result.items[0].mode).toBe("agentic");
    expect(result.items[1].isCached).toBe(true);
  });

  it("recentQueries: exposes a nextCursor when a further page exists", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      {
        id: "m1",
        conversationId: "c1",
        query: "q1",
        createdAt: new Date("2026-07-31T10:00:00Z"),
        mode: "agentic",
        latencyMs: 1,
        isCached: false,
        sourceCount: 1,
      },
      {
        id: "m2",
        conversationId: "c2",
        query: "q2",
        createdAt: new Date("2026-07-31T09:00:00Z"),
        mode: "standard",
        latencyMs: 1,
        isCached: false,
        sourceCount: 2,
      },
      {
        id: "m3",
        conversationId: "c3",
        query: "q3",
        createdAt: new Date("2026-07-31T08:00:00Z"),
        mode: "agentic",
        latencyMs: 1,
        isCached: false,
        sourceCount: 0,
      },
    ] as never);
    const caller = makeCaller();
    const result = await caller.admin.recentQueries({ limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toEqual({
      createdAt: new Date("2026-07-31T09:00:00Z"),
      id: "m2",
    });
  });

  it("recentQueries: passes the cursor through as a keyset predicate", async () => {
    prismaMock.$queryRaw.mockResolvedValue([] as never);
    const caller = makeCaller();
    const cursor = { createdAt: new Date("2026-07-31T09:00:00Z"), id: "m2" };
    await caller.admin.recentQueries({ limit: 10, cursor });
    const call = prismaMock.$queryRaw.mock.calls[0] ?? [];

    // The literal SQL keeps the DESC keyset ordering.
    const literals = call.filter((arg) => Array.isArray(arg)).flat();
    expect(literals.join(" ")).toContain('ORDER BY m."createdAt" DESC, m."id" DESC');

    // The cursor predicate is interpolated as a Prisma.sql fragment (a tagged
    // template object whose `strings` carry the comparison operators) and the
    // cursor id travels as a bound parameter.
    const fragments = call.filter(
      (arg): arg is { strings: string[] } =>
        typeof arg === "object" &&
        arg !== null &&
        "strings" in arg &&
        Array.isArray((arg as { strings?: unknown }).strings),
    );
    const fragmentText = fragments.map((fragment) => fragment.strings.join("?")).join(" ");
    expect(fragmentText).toContain('m."createdAt" <');
    expect(fragmentText).toContain('m."id" <');
    expect(JSON.stringify(call)).toContain(cursor.id);
  });

  it("recentQueries: falls back to an empty page on aggregation failure", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("db down"));
    const caller = makeCaller();
    const result = await caller.admin.recentQueries();
    expect(result).toEqual({ items: [], nextCursor: null });
  });

  it("metrics: interpolates a days window into the stats query when provided", async () => {
    prismaMock.user.count.mockResolvedValue(1 as never);
    prismaMock.conversation.count.mockResolvedValue(1 as never);
    prismaMock.message.count.mockResolvedValue(1 as never);
    prismaMock.document.count.mockResolvedValue(1 as never);
    prismaMock.$queryRaw.mockResolvedValue([
      { assistantCount: 1, cacheHits: 0, avgLatencyMs: null },
    ] as never);

    const caller = makeCaller();
    const result = await caller.admin.metrics({ days: 7 });
    expect(result.avgLatencyMs).toBe(0);
    expect(result.cacheHitRate).toBe(0);
    // A days window means the raw query is invoked with a Prisma.sql fragment.
    const call = prismaMock.$queryRaw.mock.calls[0] ?? [];
    const hasSqlFragment = call.some(
      (arg) =>
        typeof arg === "object" && arg !== null && "strings" in arg && Array.isArray(arg.strings),
    );
    expect(hasSqlFragment).toBe(true);
  });

  it("metrics: treats a null avgLatencyMs as zero", async () => {
    prismaMock.user.count.mockResolvedValue(0 as never);
    prismaMock.conversation.count.mockResolvedValue(0 as never);
    prismaMock.message.count.mockResolvedValue(0 as never);
    prismaMock.document.count.mockResolvedValue(0 as never);
    prismaMock.$queryRaw.mockResolvedValue([
      { assistantCount: 0, cacheHits: 0, avgLatencyMs: null },
    ] as never);

    const caller = makeCaller();
    const result = await caller.admin.metrics();
    expect(result.cacheHitRate).toBe(0);
    expect(result.avgLatencyMs).toBe(0);
  });

  it("topQuestions: ranks the most-asked questions", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { query: "Blocked account amount?", count: 9 },
      { query: "APS certificate?", count: 4 },
    ] as never);
    const caller = makeCaller();
    const result = await caller.admin.topQuestions({ days: 30 });
    expect(result[0]).toEqual({ query: "Blocked account amount?", count: 9 });
  });

  it("topQuestions: falls back to empty on failure", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("db down"));
    const caller = makeCaller();
    await expect(caller.admin.topQuestions({ days: 30 })).resolves.toEqual([]);
  });

  it("failedQueries: lists questions with no assistant reply", async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { id: "m1", conversationId: "c1", query: "orphaned", createdAt: new Date() },
    ] as never);
    const caller = makeCaller();
    const result = await caller.admin.failedQueries();
    expect(result).toHaveLength(1);
    expect(result[0].query).toBe("orphaned");
  });

  it("failedQueries: falls back to empty on failure", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("db down"));
    const caller = makeCaller();
    await expect(caller.admin.failedQueries()).resolves.toEqual([]);
  });

  it("queryDetail: returns the user message with its assistant response", async () => {
    const userMessage = {
      id: "m1",
      conversationId: "c1",
      content: "How much?",
      role: "USER",
      sources: [],
      metadata: {},
      createdAt: new Date("2026-01-01T00:00:00Z"),
      conversation: { id: "c1", title: "t", mode: "AGENTIC", user: { email: "a@b.c" } },
    };
    prismaMock.message.findUnique.mockResolvedValue(userMessage as never);
    prismaMock.message.findFirst.mockResolvedValue({
      id: "m2",
      conversationId: "c1",
      content: "€992/mo",
      role: "ASSISTANT",
      sources: null,
      metadata: null,
      createdAt: new Date("2026-01-01T00:00:01Z"),
    } as never);

    const caller = makeCaller();
    const result = await caller.admin.queryDetail({ id: "m1" });
    expect(result.userMessage.content).toBe("How much?");
    expect(result.assistantResponse?.content).toBe("€992/mo");
  });

  it("queryDetail: returns a null assistant response when none follows", async () => {
    prismaMock.message.findUnique.mockResolvedValue({
      id: "m1",
      conversationId: "c1",
      content: "orphaned",
      role: "USER",
      sources: null,
      metadata: null,
      createdAt: new Date(),
      conversation: { id: "c1", title: "t", mode: "AGENTIC", user: { email: "a@b.c" } },
    } as never);
    prismaMock.message.findFirst.mockResolvedValue(null as never);
    const caller = makeCaller();
    const result = await caller.admin.queryDetail({ id: "m1" });
    expect(result.assistantResponse).toBeNull();
  });

  it("queryDetail: throws when the message is missing", async () => {
    prismaMock.message.findUnique.mockResolvedValue(null as never);
    const caller = makeCaller();
    await expect(caller.admin.queryDetail({ id: "ghost" })).rejects.toThrow(/not found/i);
  });

  it("setUserRole: promotes a regular user to ADMIN", async () => {
    // First findUnique is the isAuthenticated role lookup; the second is the
    // mutation's existence check on the target user.
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ role: "ADMIN", blockedAt: null } as never)
      .mockResolvedValueOnce({ id: "u2" } as never);
    prismaMock.user.update.mockResolvedValue({ id: "u2" } as never);
    const caller = makeCaller();

    const result = await caller.admin.setUserRole({ id: "u2", role: "ADMIN" });
    expect(result.success).toBe(true);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "u2" },
      data: { role: "ADMIN" },
      select: { id: true },
    });
  });

  it("setUserRole: demotes an admin to USER", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ role: "ADMIN", blockedAt: null } as never)
      .mockResolvedValueOnce({ id: "u2" } as never);
    prismaMock.user.update.mockResolvedValue({ id: "u2" } as never);
    const caller = makeCaller();

    await caller.admin.setUserRole({ id: "u2", role: "USER" });
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: "USER" } }),
    );
  });

  it("setUserRole: refuses to modify the caller's own row (self-protection)", async () => {
    const caller = makeCaller();
    await expect(caller.admin.setUserRole({ id: "user-1", role: "USER" })).rejects.toThrow();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    // The existence check never runs either — the guard fires before any DB write.
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("setUserRole: throws when the target user does not exist", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ role: "ADMIN", blockedAt: null } as never)
      .mockResolvedValueOnce(null as never);
    const caller = makeCaller();
    await expect(caller.admin.setUserRole({ id: "ghost", role: "USER" })).rejects.toThrow();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("setUserBlocked: blocks an account and stamps blockedAt", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ role: "ADMIN", blockedAt: null } as never)
      .mockResolvedValueOnce({ id: "u2" } as never);
    prismaMock.user.update.mockResolvedValue({ id: "u2" } as never);
    const caller = makeCaller();

    const result = await caller.admin.setUserBlocked({ id: "u2", blocked: true });
    expect(result.success).toBe(true);
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { blockedAt: expect.any(Date) } }),
    );
  });

  it("setUserBlocked: unblocks an account by clearing blockedAt", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ role: "ADMIN", blockedAt: null } as never)
      .mockResolvedValueOnce({ id: "u2" } as never);
    prismaMock.user.update.mockResolvedValue({ id: "u2" } as never);
    const caller = makeCaller();

    await caller.admin.setUserBlocked({ id: "u2", blocked: false });
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { blockedAt: null } }),
    );
  });

  it("setUserBlocked: refuses to block the caller's own row", async () => {
    const caller = makeCaller();
    await expect(caller.admin.setUserBlocked({ id: "user-1", blocked: true })).rejects.toThrow();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("setUserBlocked: throws when the target user does not exist", async () => {
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ role: "ADMIN", blockedAt: null } as never)
      .mockResolvedValueOnce(null as never);
    const caller = makeCaller();
    await expect(caller.admin.setUserBlocked({ id: "ghost", blocked: true })).rejects.toThrow();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
