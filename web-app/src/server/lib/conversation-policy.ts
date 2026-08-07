/**
 * Cross-cutting conversation ownership + guest-quota helpers.
 *
 * These two checks were copy-pasted across routers:
 * - `ensureOwnership` (a fetch + userId guard) existed in both `routers/chat.ts`
 *   and `routers/conversation.ts`.
 * - The "how many prompts has this guest used" count was duplicated in
 *   `conversation.ts` (create + count) and the chat/stream SSE route. (The
 *   tRPC `chat.sendMessage` mutation that once also enforced it was deleted —
 *   user-message persistence now lives only in the SSE route.) Centralizing
 *   them ensures the free-tier invariant and the ownership rule are enforced
 *   identically everywhere.
 */

import type { PrismaClient } from "@prisma/client";
import { NotFoundError } from "@/server/lib/errors";
import type { AuthedUser } from "@/server/trpc/t";

/** Conversation-ownership guard used by every conversation-scoped mutation. */
export async function ensureConversationOwnership(
  db: PrismaClient,
  user: AuthedUser,
  conversationId: string,
): Promise<{ conversationId: string; userId: string; title: string | null }> {
  const conversation = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, userId: true, title: true },
  });
  if (!conversation || conversation.userId !== user.id) {
    // Do not leak whether the conversation exists vs. is owned by someone else.
    throw new NotFoundError("Conversation", conversationId);
  }
  return { conversationId: conversation.id, userId: conversation.userId, title: conversation.title };
}

/**
 * Counts the USER prompts a guest has persisted across all non-deleted
 * conversations. This is the free-tier invariant: a guest may have at most
 * GUEST_PROMPT_LIMIT prompts at a time (soft-deleting frees them).
 */
export async function countGuestPromptsUsed(
  db: PrismaClient,
  userId: string,
): Promise<number> {
  return db.message.count({
    where: { conversation: { userId, deletedAt: null }, role: "USER" },
  });
}