import { z } from "zod";
import { router, protectedProcedure } from "@/server/trpc/t";
import { prisma } from "@/server/db";
import { GuestLimitReachedError, NotFoundError, ValidationError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";
import type { AuthedUser } from "@/server/trpc/t";
import type { ChatMode } from "@/lib/chat/types";
import { MAX_QUERY_LENGTH } from "@/lib/chat/types";
import { chatModeSchema } from "@/server/routers/conversation";
import { GUEST_PROMPT_LIMIT } from "@/lib/guest";
import {
  countGuestPromptsUsed,
  ensureConversationOwnership,
} from "@/server/lib/conversation-policy";

const logger = createLogger("chat-router");

export const sendMessageSchema = z.object({
  conversationId: z.string().min(1),
  query: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
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

export const chatRouter = router({
  sendMessage: protectedProcedure
    .input(sendMessageSchema)
    .mutation(async ({ ctx, input }): Promise<SendMessageResult> => {
      const user = ctx.user as AuthedUser;
      const conversation = await ensureConversationOwnership(prisma, user, input.conversationId);

      // Same free-tier invariant as conversation.create and the chat stream
      // route: guests may persist at most GUEST_PROMPT_LIMIT prompts.
      if (user.isGuest) {
        const promptCount = await countGuestPromptsUsed(prisma, user.id);
        if (promptCount >= GUEST_PROMPT_LIMIT) {
          throw new GuestLimitReachedError(GUEST_PROMPT_LIMIT);
        }
      }

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
