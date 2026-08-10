import { vi, describe, it, expect, beforeEach } from "vitest";
import { appRouter } from "@/server/trpc/router";
import type { Context } from "@/server/trpc/context";

vi.mock("@/server/db", () => ({
  prisma: {
    conversation: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@/server/db";
import type { MockPrisma } from "../helpers/mock-prisma";
import { GuestLimitReachedError } from "@/server/lib/errors";
import { GUEST_PROMPT_LIMIT } from "@/lib/guest";

const prismaMock = prisma as unknown as MockPrisma;

function makeCaller(role: "USER" | "ADMIN" = "USER") {
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

/**
 * A caller that goes through the guest admission path (no session, signed
 * device cookie). `isAuthenticated` lazily provisions the guest User row.
 */
function makeGuestCaller(guestId = "guest-1") {
  return appRouter.createCaller({
    db: prismaMock as never,
    session: null,
    guestId,
    headers: new Headers(),
    resHeaders: new Headers(),
  } as unknown as Context);
}

const ownerConversation = {
  id: "conv-1",
  userId: "user-1",
  title: "My chat",
  mode: "AGENTIC" as const,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
};

describe("conversation router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("create: creates a conversation for the authenticated user", async () => {
    prismaMock.conversation.create.mockResolvedValue(ownerConversation as never);
    const caller = makeCaller();
    const result = await caller.conversation.create({});

    expect(prismaMock.conversation.create).toHaveBeenCalledWith({
      data: { userId: "user-1", title: "New conversation", mode: "AGENTIC" },
      select: { id: true, title: true, mode: true, createdAt: true, updatedAt: true },
    });
    expect(result.id).toBe("conv-1");
  });

  it("create: maps standard mode to STANDARD enum", async () => {
    prismaMock.conversation.create.mockResolvedValue({
      ...ownerConversation,
      mode: "STANDARD",
    } as never);
    const caller = makeCaller();
    await caller.conversation.create({ mode: "standard" });
    expect(prismaMock.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mode: "STANDARD" }) }),
    );
  });

  it("create: allows a guest below the free-tier prompt cap", async () => {
    prismaMock.user.create.mockResolvedValue({ id: "guest-1" } as never);
    prismaMock.message.count.mockResolvedValue(2);
    prismaMock.conversation.create.mockResolvedValue(ownerConversation as never);

    const caller = makeGuestCaller();
    const result = await caller.conversation.create({});

    expect(prismaMock.message.count).toHaveBeenCalledWith({
      where: { conversation: { userId: "guest-1", deletedAt: null }, role: "USER" },
    });
    expect(prismaMock.conversation.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "guest-1" }) }),
    );
    expect(result.id).toBe("conv-1");
  });

  it("create: blocks a guest at the free-tier prompt cap with GUEST_PROMPT_LIMIT", async () => {
    prismaMock.user.create.mockResolvedValue({ id: "guest-1" } as never);
    prismaMock.message.count.mockResolvedValue(GUEST_PROMPT_LIMIT);

    const caller = makeGuestCaller();
    // tRPC wraps thrown DomainErrors in a TRPCError whose cause preserves the
    // original error; match on the message and the underlying error class.
    await expect(caller.conversation.create({})).rejects.toThrow(/Guest limit reached/);
    await expect(caller.conversation.create({})).rejects.toMatchObject({
      cause: expect.any(GuestLimitReachedError),
    });
    // The cap is checked before any insert — no conversation row is created.
    expect(prismaMock.conversation.create).not.toHaveBeenCalled();
  });

  it("count: reports prompt usage for guests so the sidebar chip reads n/GUEST_PROMPT_LIMIT", async () => {
    prismaMock.user.create.mockResolvedValue({ id: "guest-1" } as never);
    prismaMock.message.count.mockResolvedValue(4);

    const caller = makeGuestCaller();
    const result = await caller.conversation.count(undefined);

    expect(prismaMock.message.count).toHaveBeenCalledWith({
      where: { conversation: { userId: "guest-1", deletedAt: null }, role: "USER" },
    });
    expect(result.count).toBe(4);
    expect(prismaMock.conversation.count).not.toHaveBeenCalled();
  });

  it("create: does not count prompts against signed-in (non-guest) users", async () => {
    prismaMock.conversation.create.mockResolvedValue(ownerConversation as never);
    const caller = makeCaller();
    await caller.conversation.create({});
    expect(prismaMock.message.count).not.toHaveBeenCalled();
    expect(prismaMock.conversation.count).not.toHaveBeenCalled();
  });

  it("list: returns paginated items with preview and nextCursor", async () => {
    const rows = [
      {
        id: "conv-2",
        title: "Visa question",
        mode: "AGENTIC",
        pinned: false,
        updatedAt: new Date("2026-01-03"),
        createdAt: new Date("2026-01-01"),
        messages: [{ content: "What is APS?" }],
        _count: { messages: 2 },
      },
      {
        id: "conv-1",
        title: "Blocked account",
        mode: "STANDARD",
        pinned: false,
        updatedAt: new Date("2026-01-02"),
        createdAt: new Date("2026-01-01"),
        messages: [{ content: "How much?" }],
        _count: { messages: 4 },
      },
    ];
    prismaMock.conversation.findMany.mockResolvedValue(rows as never);
    const caller = makeCaller();
    const result = await caller.conversation.list({ limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].preview).toBe("What is APS?");
    expect(result.items[0].messageCount).toBe(2);
    expect(prismaMock.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-1", deletedAt: null }),
      }),
    );
  });

  it("list: supports search filter and cursor pagination", async () => {
    prismaMock.conversation.findMany.mockResolvedValue([] as never);
    const caller = makeCaller();
    const now = new Date();
    await caller.conversation.list({
      limit: 10,
      search: "visa",
      cursor: { updatedAt: now, id: "conv-9" },
    });

    expect(prismaMock.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          deletedAt: null,
          title: { contains: "visa", mode: "insensitive" },
          OR: [{ updatedAt: { lt: now } }, { updatedAt: now, id: { lt: "conv-9" } }],
        },
      }),
    );
  });

  it("getById: returns conversation with ordered messages (readOnly: false for owner)", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      ...ownerConversation,
      messages: [
        {
          id: "m1",
          role: "USER",
          content: "hi",
          sources: null,
          metadata: null,
          createdAt: new Date("2026-01-01"),
        },
        {
          id: "m2",
          role: "ASSISTANT",
          content: "hello",
          sources: [{ name: "doc", url: "u", score: 1 }],
          metadata: { latencyMs: 5 },
          createdAt: new Date("2026-01-01"),
        },
      ],
    } as never);

    const caller = makeCaller();
    const result = await caller.conversation.getById({ id: "conv-1" });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].sources?.[0].name).toBe("doc");
    expect(result.messages[1].metadata?.latencyMs).toBe(5);
    expect(result.readOnly).toBe(false);
  });

  it("getById: maps the viewer's saved feedback onto messages", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      ...ownerConversation,
      messages: [
        {
          id: "m1",
          role: "ASSISTANT",
          content: "hello",
          sources: null,
          metadata: null,
          createdAt: new Date("2026-01-01"),
          feedback: [{ rating: "UP" }],
        },
        {
          id: "m2",
          role: "ASSISTANT",
          content: "again",
          sources: null,
          metadata: null,
          createdAt: new Date("2026-01-01"),
          feedback: [],
        },
      ],
    } as never);

    const caller = makeCaller();
    const result = await caller.conversation.getById({ id: "conv-1" });

    expect(result.messages[0].feedback).toBe("up");
    expect(result.messages[1].feedback).toBeNull();
    // The feedback sub-query is scoped to the requesting user.
    expect(prismaMock.conversation.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          messages: expect.objectContaining({
            select: expect.objectContaining({
              feedback: { where: { userId: "user-1" }, select: { rating: true }, take: 1 },
            }),
          }),
        }),
      }),
    );
  });

  it("getById: rejects access to another user's conversation for non-admins", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-x",
      userId: "other",
    } as never);
    const caller = makeCaller("USER");
    await expect(caller.conversation.getById({ id: "conv-x" })).rejects.toThrow();
  });

  it("getById: lets an admin read another user's conversation as readOnly", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      ...ownerConversation,
      id: "conv-x",
      userId: "other",
      messages: [
        {
          id: "m1",
          role: "USER",
          content: "what is aps",
          sources: null,
          metadata: null,
          createdAt: new Date("2026-01-01"),
        },
      ],
    } as never);
    const caller = makeCaller("ADMIN");
    const result = await caller.conversation.getById({ id: "conv-x" });
    expect(result.id).toBe("conv-x");
    expect(result.readOnly).toBe(true);
    expect(result.messages).toHaveLength(1);
  });

  it("updateTitle: renames a conversation the user owns", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
    } as never);
    prismaMock.conversation.update.mockResolvedValue({
      id: "conv-1",
      title: "New title",
      mode: "AGENTIC",
      updatedAt: new Date("2026-01-02"),
    } as never);

    const caller = makeCaller();
    const result = await caller.conversation.updateTitle({ id: "conv-1", title: "New title" });
    expect(result.title).toBe("New title");
    expect(prismaMock.conversation.update).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { title: "New title" },
      select: { id: true, title: true, mode: true, updatedAt: true },
    });
  });

  it("delete: soft deletes an owned conversation", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
    } as never);
    prismaMock.conversation.update.mockResolvedValue({ id: "conv-1" } as never);

    const caller = makeCaller();
    const result = await caller.conversation.delete({ id: "conv-1" });
    expect(result.success).toBe(true);
    expect(prismaMock.conversation.update).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("export: returns a markdown transcript", async () => {
    prismaMock.conversation.findUnique
      .mockResolvedValueOnce({ id: "conv-1", userId: "user-1" } as never)
      .mockResolvedValueOnce({
        ...ownerConversation,
        messages: [
          { role: "USER", content: "hello", createdAt: new Date("2026-01-01") },
          { role: "ASSISTANT", content: "hi there", createdAt: new Date("2026-01-01") },
        ],
      } as never);

    const caller = makeCaller();
    const result = await caller.conversation.export({ id: "conv-1" });
    expect(result.markdown).toContain("# My chat");
    expect(result.markdown).toContain("## User");
    expect(result.markdown).toContain("hello");
    expect(result.markdown).toContain("## Assistant");
  });

  it("export: handles empty conversations", async () => {
    prismaMock.conversation.findUnique
      .mockResolvedValueOnce({ id: "conv-1", userId: "user-1" } as never)
      .mockResolvedValueOnce({ ...ownerConversation, messages: [] } as never);

    const caller = makeCaller();
    const result = await caller.conversation.export({ id: "conv-1" });
    expect(result.markdown).toContain("No messages");
  });

  it("getById: rejects when the ownership row is missing", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue(null as never);
    const caller = makeCaller();
    await expect(caller.conversation.getById({ id: "ghost" })).rejects.toThrow();
  });

  it("deleteMany: soft-deletes only the conversations the user owns", async () => {
    prismaMock.conversation.findMany.mockResolvedValue([
      { id: "conv-1" },
      { id: "conv-2" },
    ] as never);
    prismaMock.conversation.updateMany.mockResolvedValue({ count: 2 } as never);

    const caller = makeCaller();
    const result = await caller.conversation.deleteMany({ ids: ["conv-1", "conv-2", "conv-x"] });
    expect(result.success).toBe(true);
    expect(result.deleted).toBe(2);
    expect(prismaMock.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["conv-1", "conv-2"] } },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("deleteMany: no-ops when the user owns none of the requested ids", async () => {
    prismaMock.conversation.findMany.mockResolvedValue([] as never);
    const caller = makeCaller();
    const result = await caller.conversation.deleteMany({ ids: ["conv-x"] });
    expect(result.deleted).toBe(0);
    expect(prismaMock.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("clearAll: soft-deletes every non-deleted conversation with no filter", async () => {
    prismaMock.conversation.updateMany.mockResolvedValue({ count: 3 } as never);
    const caller = makeCaller();
    const result = await caller.conversation.clearAll();
    expect(result.success).toBe(true);
    expect(result.deleted).toBe(3);
    expect(prismaMock.conversation.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("clearAll: applies search/mode/ids filters when given", async () => {
    prismaMock.conversation.updateMany.mockResolvedValue({ count: 1 } as never);
    const caller = makeCaller();
    await caller.conversation.clearAll({ search: "visa", mode: "standard", ids: ["conv-1"] });
    expect(prismaMock.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user-1",
          deletedAt: null,
          id: { in: ["conv-1"] },
          title: { contains: "visa", mode: "insensitive" },
          mode: "STANDARD",
        },
      }),
    );
  });

  it("restore: un-deletes an owned conversation", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue({ id: "conv-1" } as never);
    prismaMock.conversation.update.mockResolvedValue({ id: "conv-1" } as never);
    const caller = makeCaller();
    const result = await caller.conversation.restore({ id: "conv-1" });
    expect(result.success).toBe(true);
    expect(prismaMock.conversation.update).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { deletedAt: null },
    });
  });

  it("restore: throws when the conversation is not found", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(null as never);
    const caller = makeCaller();
    await expect(caller.conversation.restore({ id: "ghost" })).rejects.toThrow();
  });

  it("clear: deletes all messages in an owned conversation", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
    } as never);
    prismaMock.message.deleteMany.mockResolvedValue({ count: 5 } as never);
    const caller = makeCaller();
    const result = await caller.conversation.clear({ id: "conv-1" });
    expect(result.success).toBe(true);
    expect(prismaMock.message.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: "conv-1" },
    });
  });

  it("setPinned: flips the pinned flag and returns it", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
    } as never);
    prismaMock.conversation.update.mockResolvedValue({ id: "conv-1", pinned: true } as never);
    const caller = makeCaller();
    const result = await caller.conversation.setPinned({ id: "conv-1", pinned: true });
    expect(result.pinned).toBe(true);
    expect(prismaMock.conversation.update).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { pinned: true },
      select: { id: true, pinned: true },
    });
  });

  it("count: counts conversations for signed-in users with filters", async () => {
    prismaMock.conversation.count.mockResolvedValue(2 as never);
    const caller = makeCaller();
    const result = await caller.conversation.count({ pinnedOnly: true, mode: "agentic" });
    expect(result.count).toBe(2);
    expect(prismaMock.conversation.count).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        deletedAt: null,
        pinned: true,
        mode: "AGENTIC",
      },
    });
  });

  it("list: filters by mode and includeDeleted", async () => {
    prismaMock.conversation.findMany.mockResolvedValue([] as never);
    const caller = makeCaller();
    await caller.conversation.list({ mode: "standard", includeDeleted: true });
    expect(prismaMock.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          deletedAt: { not: null },
          mode: "STANDARD",
        }),
      }),
    );
  });

  it("stats: aggregates conversation and message counts", async () => {
    prismaMock.conversation.count
      .mockResolvedValueOnce(5 as never)
      .mockResolvedValueOnce(1 as never)
      .mockResolvedValueOnce(2 as never);
    prismaMock.message.count.mockResolvedValue(30 as never);
    const caller = makeCaller();
    const result = await caller.conversation.stats();
    expect(result.totalConversations).toBe(5);
    expect(result.pinnedConversations).toBe(1);
    expect(result.deletedConversations).toBe(2);
    expect(result.totalMessages).toBe(30);
  });

  it("exportAll: renders every conversation into one markdown document", async () => {
    prismaMock.conversation.findMany.mockResolvedValue([
      {
        ...ownerConversation,
        messages: [{ role: "USER", content: "hello", createdAt: new Date("2026-01-01") }],
      },
    ] as never);
    const caller = makeCaller();
    const result = await caller.conversation.exportAll();
    expect(result.markdown).toContain("Complete Export");
    expect(result.markdown).toContain("Total Conversations: 1");
    expect(result.markdown).toContain("**USER:** hello");
  });
});
