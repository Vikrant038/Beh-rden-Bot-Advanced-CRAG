import { z } from "zod";
import { router, protectedProcedure } from "@/server/trpc/t";
import { prisma } from "@/server/db";
import { NotFoundError, ValidationError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";
import type { AuthedUser } from "@/server/trpc/t";
import type { ChatMode } from "@/lib/chat/types";
import { chatModeSchema } from "@/server/routers/conversation";

const logger = createLogger("chat-router");

export const sendMessageSchema = z.object({
  conversationId: z.string().min(1),
  query: z.string().trim().min(1).max(2000),
  mode: chatModeSchema.default("agentic"),
});

export interface SendMessageResult {
  messageId: string;
  conversationId: string;
}

export interface RegenerateResult {
  userMessageId: string;
  query: string;
  conversationId: string;
}

async function ensureOwnership(user: AuthedUser, conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, userId: true, title: true },
  });
  if (!conversation) {
    throw new NotFoundError("Conversation", conversationId);
  }
  if (conversation.userId !== user.id) {
    throw new NotFoundError("Conversation", conversationId);
  }
  return conversation;
}

export const chatRouter = router({
  sendMessage: protectedProcedure
    .input(sendMessageSchema)
    .mutation(async ({ ctx, input }): Promise<SendMessageResult> => {
      const user = ctx.user as AuthedUser;
      const conversation = await ensureOwnership(user, input.conversationId);

      const mode: ChatMode = input.mode;
      const message = await prisma.message.create({
        data: {
          conversationId: input.conversationId,
          role: "USER",
          content: input.query,
          metadata: { mode },
        },
        select: { id: true },
      });

      if (!conversation.title || conversation.title === "New conversation") {
        await prisma.conversation.update({
          where: { id: input.conversationId },
          data: { title: input.query.slice(0, 48) },
        });
      }

      logger.info(
        { conversationId: input.conversationId, userId: user.id, messageId: message.id },
        "[CHAT] user message persisted",
      );

      return { messageId: message.id, conversationId: input.conversationId };
    }),

  regenerate: protectedProcedure
    .input(z.object({ conversationId: z.string().min(1) }))
    .mutation(async ({ ctx, input }): Promise<RegenerateResult> => {
      const user = ctx.user as AuthedUser;
      await ensureOwnership(user, input.conversationId);

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
});
