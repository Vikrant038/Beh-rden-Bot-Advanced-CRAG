import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/server/db", () => ({
  prisma: {
    conversation: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    message: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    messageFeedback: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/server/db";
import type { MockPrisma } from "../helpers/mock-prisma";
import { makeUserCaller } from "../helpers/caller";

const prismaMock = prisma as unknown as MockPrisma & {
  messageFeedback: { upsert: ReturnType<typeof vi.fn> };
};

const makeCaller = () => makeUserCaller(prismaMock);

describe("chat router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("regenerate: removes the last assistant message and returns the prior user query", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
      title: "My chat",
    } as never);
    prismaMock.message.findFirst
      .mockResolvedValueOnce({
        id: "assistant-9",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      } as never)
      .mockResolvedValueOnce({
        id: "user-8",
        content: "Tell me about blocked accounts",
      } as never);
    prismaMock.message.delete.mockResolvedValue({ id: "assistant-9" } as never);

    const caller = makeCaller();
    const result = await caller.chat.regenerate({ conversationId: "conv-1" });

    expect(result.userMessageId).toBe("user-8");
    expect(result.query).toBe("Tell me about blocked accounts");
    expect(prismaMock.message.delete).toHaveBeenCalledWith({ where: { id: "assistant-9" } });
  });

  it("regenerate: fails when there is no assistant message", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
      title: "My chat",
    } as never);
    prismaMock.message.findFirst.mockResolvedValue(null as never);

    const caller = makeCaller();
    await expect(caller.chat.regenerate({ conversationId: "conv-1" })).rejects.toThrow();
  });

  it("regenerate: fails when no user message precedes the assistant reply", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
      title: "My chat",
    } as never);
    prismaMock.message.findFirst
      .mockResolvedValueOnce({
        id: "assistant-9",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      } as never)
      .mockResolvedValueOnce(null as never);

    const caller = makeCaller();
    await expect(caller.chat.regenerate({ conversationId: "conv-1" })).rejects.toThrow();
  });

  it("feedback: upserts an UP rating on an owned message", async () => {
    prismaMock.message.findUnique.mockResolvedValue({
      id: "msg-1",
      conversation: { userId: "user-1" },
    } as never);
    prismaMock.messageFeedback.upsert.mockResolvedValue({ rating: "UP" } as never);

    const caller = makeCaller();
    const result = await caller.chat.feedback({ messageId: "msg-1", rating: "UP" });
    expect(result.rating).toBe("UP");
    expect(prismaMock.messageFeedback.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          messageId_userId: { messageId: "msg-1", userId: "user-1" },
        },
        create: expect.objectContaining({ rating: "UP" }),
      }),
    );
  });

  it("feedback: removes feedback when rating is null", async () => {
    prismaMock.message.findUnique.mockResolvedValue({
      id: "msg-1",
      conversation: { userId: "user-1" },
    } as never);
    prismaMock.messageFeedback.deleteMany.mockResolvedValue({ count: 1 } as never);

    const caller = makeCaller();
    const result = await caller.chat.feedback({ messageId: "msg-1", rating: null });
    expect(result.rating).toBeNull();
    expect(prismaMock.messageFeedback.deleteMany).toHaveBeenCalledWith({
      where: { messageId: "msg-1", userId: "user-1" },
    });
  });

  it("feedback: rejects feedback on a message the user does not own", async () => {
    prismaMock.message.findUnique.mockResolvedValue({
      id: "msg-1",
      conversation: { userId: "someone-else" },
    } as never);

    const caller = makeCaller();
    await expect(caller.chat.feedback({ messageId: "msg-1", rating: "UP" })).rejects.toThrow();
  });
});
