import { z } from "zod";
import { router, protectedProcedure } from "@/server/trpc/t";
import { prisma } from "@/server/db";
import { NotFoundError, ValidationError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";
import type { AuthedUser } from "@/server/trpc/t";
import { ensureConversationOwnership } from "@/server/lib/conversation-policy";

const logger = createLogger("chat-router");

export interface RegenerateResult {
  userMessageId: string;
  query: string;
  conversationId: string;
}

export const chatRouter = router({
  // Note: user-message persistence intentionally lives ONLY in the chat/stream
  // SSE route (`findOrCreateUserMessage` in rag/chat-pipeline.ts). A tRPC
  // `sendMessage` mutation used to duplicate that path and was deleted — the
  // client never called it, and keeping two persistence routes was a drift
  // hazard (different title/error behavior from the live SSE path).
  regenerate: protectedProcedure
    .input(z.object({ conversationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<RegenerateResult> => {
      const user = ctx.user as AuthedUser;
      await ensureConversationOwnership(prisma, user, input.conversationId);

      const lastAssistant = await prisma.message.findFirst({
        where: { conversationId: input.conversationId, role: "ASSISTANT" },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      });

      if (!lastAssistant) {
        throw new ValidationError("conversationId", "no assistant message to regenerate");
      }

      const lastUser = await prisma.message.findFirst({
        where: {
          conversationId: input.conversationId,
          role: "USER",
          createdAt: { lt: lastAssistant.createdAt },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, content: true },
      });

      if (!lastUser) {
        throw new ValidationError("conversationId", "no user message to regenerate");
      }

      await prisma.message.delete({ where: { id: lastAssistant.id } });
      logger.info(
        { conversationId: input.conversationId, messageId: lastAssistant.id },
        "[CHAT] regenerating: removed previous assistant message",
      );

      return {
        userMessageId: lastUser.id,
        query: lastUser.content,
        conversationId: input.conversationId,
      };
    }),

  feedback: protectedProcedure
    .input(
      z.object({
        messageId: z.string().min(1),
        rating: z.enum(["UP", "DOWN"]).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;
      const message = await prisma.message.findUnique({
        where: { id: input.messageId },
        select: { id: true, conversation: { select: { userId: true } } },
      });
      if (!message || message.conversation.userId !== user.id) {
        throw new NotFoundError("Message", input.messageId);
      }

      if (input.rating === null) {
        await prisma.messageFeedback.deleteMany({
          where: { messageId: input.messageId, userId: user.id },
        });
        return { rating: null };
      }

      const feedback = await prisma.messageFeedback.upsert({
        where: {
          messageId_userId: {
            messageId: input.messageId,
            userId: user.id,
          },
        },
        create: {
          messageId: input.messageId,
          userId: user.id,
          rating: input.rating,
        },
        update: {
          rating: input.rating,
        },
        select: { rating: true },
      });

      return { rating: feedback.rating };
    }),
});
