import { describe, it, expect, vi } from "vitest";
import {
  ensureConversationOwnership,
  countGuestPromptsUsed,
} from "@/server/lib/conversation-policy";
import { NotFoundError } from "@/server/lib/errors";

const db = {
  conversation: { findUnique: vi.fn() },
  message: { count: vi.fn() },
} as unknown as Parameters<typeof ensureConversationOwnership>[0];

const user = { id: "user-1" } as Parameters<typeof ensureConversationOwnership>[1];

const findUnique = db.conversation.findUnique as ReturnType<typeof vi.fn>;
const messageCount = db.message.count as ReturnType<typeof vi.fn>;

describe("ensureConversationOwnership", () => {
  it("returns the conversation when owned by the user", async () => {
    findUnique.mockResolvedValue({ id: "c1", userId: "user-1", title: "My chat" });
    const result = await ensureConversationOwnership(db, user, "c1");
    expect(result.conversationId).toBe("c1");
    expect(result.userId).toBe("user-1");
    expect(result.title).toBe("My chat");
  });

  it("throws NotFoundError when the conversation does not exist", async () => {
    findUnique.mockResolvedValue(null);
    await expect(ensureConversationOwnership(db, user, "c1")).rejects.toThrow(NotFoundError);
  });

  it("throws NotFoundError when the conversation belongs to a different user", async () => {
    findUnique.mockResolvedValue({ id: "c1", userId: "someone-else", title: "Other chat" });
    await expect(ensureConversationOwnership(db, user, "c1")).rejects.toThrow(NotFoundError);
  });
});

describe("countGuestPromptsUsed", () => {
  it("counts user prompts in non-deleted conversations", async () => {
    messageCount.mockResolvedValue(3);
    await expect(countGuestPromptsUsed(db, "user-1")).resolves.toBe(3);
    expect(messageCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          conversation: { userId: "user-1", deletedAt: null },
          role: "USER",
        },
      }),
    );
  });
});
