import { vi, describe, it, expect, beforeEach } from "vitest";
import { appRouter } from "@/server/trpc/router";
import type { Context } from "@/server/trpc/context";

vi.mock("@/server/db", () => ({
  prisma: {
    conversation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    message: {
      create: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from "@/server/db";
import type { MockPrisma } from "../helpers/mock-prisma";

const prismaMock = prisma as unknown as MockPrisma;

function makeCaller() {
  return appRouter.createCaller({
    db: prismaMock as never,
    session: {
      user: { id: "user-1", role: "USER", name: "Test", email: "test@example.com" },
      expires: "2099-01-01T00:00:00.000Z",
    },
    headers: new Headers(),
    resHeaders: new Headers(),
  } as unknown as Context);
}

describe("chat router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sendMessage: persists the user message and returns its id", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
      title: "My chat",
    } as never);
    prismaMock.message.create.mockResolvedValue({ id: "msg-1" } as never);

    const caller = makeCaller();
    const result = await caller.chat.sendMessage({
      conversationId: "conv-1",
      query: "What is APS?",
      mode: "agentic",
    });

    expect(result.messageId).toBe("msg-1");
    expect(prismaMock.message.create).toHaveBeenCalledWith({
      data: {
        conversationId: "conv-1",
        role: "USER",
        content: "What is APS?",
        metadata: { mode: "agentic" },
      },
      select: { id: true },
    });
  });

  it("sendMessage: auto-titles a new conversation from the first query", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
      title: "New conversation",
    } as never);
    prismaMock.message.create.mockResolvedValue({ id: "msg-1" } as never);
    prismaMock.conversation.update.mockResolvedValue({ id: "conv-1" } as never);

    const caller = makeCaller();
    await caller.chat.sendMessage({
      conversationId: "conv-1",
      query: "How much is the blocked account?",
      mode: "standard",
    });

    expect(prismaMock.conversation.update).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: { title: "How much is the blocked account?" },
    });
  });

  it("sendMessage: does not rewrite an existing title", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
      title: "Named chat",
    } as never);
    prismaMock.message.create.mockResolvedValue({ id: "msg-1" } as never);

    const caller = makeCaller();
    await caller.chat.sendMessage({ conversationId: "conv-1", query: "hello", mode: "agentic" });

    expect(prismaMock.conversation.update).not.toHaveBeenCalled();
  });

  it("sendMessage: rejects messages to another user's conversation", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-x",
      userId: "other-user",
      title: "Theirs",
    } as never);

    const caller = makeCaller();
    await expect(
      caller.chat.sendMessage({ conversationId: "conv-x", query: "hi", mode: "agentic" }),
    ).rejects.toThrow();
  });

  it("regenerate: removes the last assistant message and returns the prior user query", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
      title: "My chat",
    } as never);
    prismaMock.message.findFirst
      .mockResolvedValueOnce({ id: "assistant-9", createdAt: new Date("2026-01-02T00:00:00Z") } as never)
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
});
