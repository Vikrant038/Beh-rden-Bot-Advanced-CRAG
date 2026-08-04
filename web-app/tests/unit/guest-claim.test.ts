import { vi, describe, it, expect, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { claimGuestData } from "@/server/guest";

vi.mock("@/server/db", () => ({
  prisma: {
    conversation: { updateMany: vi.fn() },
    messageFeedback: { updateMany: vi.fn(), deleteMany: vi.fn() },
    user: { delete: vi.fn() },
  },
}));

import { prisma } from "@/server/db";
import type { MockPrisma } from "../helpers/mock-prisma";

const prismaMock = prisma as unknown as MockPrisma;

describe("claimGuestData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-parents conversations and feedback to the account, then deletes the guest row", async () => {
    prismaMock.conversation.updateMany.mockResolvedValue({ count: 3 } as never);
    prismaMock.messageFeedback.updateMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.user.delete.mockResolvedValue({ id: "guest-1" } as never);

    const result = await claimGuestData("guest-1", "user-42");

    expect(result).toBe(true);
    expect(prismaMock.conversation.updateMany).toHaveBeenCalledWith({
      where: { userId: "guest-1" },
      data: { userId: "user-42" },
    });
    expect(prismaMock.messageFeedback.updateMany).toHaveBeenCalledWith({
      where: { userId: "guest-1" },
      data: { userId: "user-42" },
    });
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: "guest-1" } });
  });

  it("is a no-op when the guest id equals the target account id", async () => {
    const result = await claimGuestData("user-42", "user-42");
    expect(result).toBe(false);
    expect(prismaMock.conversation.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it("tolerates a concurrent-delete race (P2025) and still reports success", async () => {
    prismaMock.conversation.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.messageFeedback.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.user.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Record not found", {
        code: "P2025",
        clientVersion: "test",
      }),
    );

    await expect(claimGuestData("guest-1", "user-42")).resolves.toBe(true);
  });

  it("drops duplicate guest feedback on a (messageId, userId) conflict, then retries", async () => {
    prismaMock.conversation.updateMany.mockResolvedValue({ count: 0 } as never);
    const conflict = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    prismaMock.messageFeedback.updateMany
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ count: 0 } as never);
    prismaMock.messageFeedback.deleteMany.mockResolvedValue({ count: 1 } as never);
    prismaMock.user.delete.mockResolvedValue({ id: "guest-1" } as never);

    await expect(claimGuestData("guest-1", "user-42")).resolves.toBe(true);

    expect(prismaMock.messageFeedback.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "guest-1",
        message: { feedback: { some: { userId: "user-42" } } },
      },
    });
    expect(prismaMock.messageFeedback.updateMany).toHaveBeenCalledTimes(2);
  });

  it("propagates non-conflict feedback errors so the caller can retry later", async () => {
    prismaMock.conversation.updateMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.messageFeedback.updateMany.mockRejectedValue(new Error("db down"));

    await expect(claimGuestData("guest-1", "user-42")).rejects.toThrow("db down");
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });
});
