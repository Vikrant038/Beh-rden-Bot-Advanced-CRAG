import { z } from "zod";
import { Prisma } from "@prisma/client";
import { router, protectedProcedure } from "@/server/trpc/t";
import { prisma } from "@/server/db";
import { NotFoundError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";
import type { AuthedUser } from "@/server/trpc/t";
import type { ChatMessage, ChatSource } from "@/lib/chat/types";

const logger = createLogger("conversation-router");

export const chatModeSchema = z.enum(["standard", "agentic"]);

const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
});

export interface ConversationListItem {
  id: string;
  title: string | null;
  mode: "STANDARD" | "AGENTIC";
  updatedAt: Date;
  createdAt: Date;
  preview: string;
  messageCount: number;
}

export interface ConversationWithMessages {
  id: string;
  title: string | null;
  mode: "STANDARD" | "AGENTIC";
  createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
}

function parseJsonArray(value: unknown): ChatSource[] {
  return Array.isArray(value) ? (value as ChatSource[]) : [];
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toChatMessage(row: {
  id: string;
  role: string;
  content: string;
  sources: unknown;
  metadata: unknown;
  createdAt: Date;
}): ChatMessage {
  return {
    id: row.id,
    role: row.role as ChatMessage["role"],
    content: row.content,
    sources: parseJsonArray(row.sources),
    metadata: parseJsonObject(row.metadata) as ChatMessage["metadata"],
    createdAt: row.createdAt.toISOString(),
  };
}

async function ensureOwnership(user: AuthedUser, conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, userId: true },
  });
  if (!conversation) {
    throw new NotFoundError("Conversation", conversationId);
  }
  if (conversation.userId !== user.id) {
    throw new NotFoundError("Conversation", conversationId);
  }
  return conversation;
}

export const conversationRouter = router({
  create: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().max(200).optional(),
        mode: chatModeSchema.default("agentic"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;
      const conversation = await prisma.conversation.create({
        data: {
          userId: user.id,
          title: input.title?.trim() || "New conversation",
          mode: input.mode === "standard" ? "STANDARD" : "AGENTIC",
        },
        select: { id: true, title: true, mode: true, createdAt: true, updatedAt: true },
      });
      return conversation;
    }),

  list: protectedProcedure.input(paginationSchema).query(async ({ ctx, input }) => {
    const user = ctx.user as AuthedUser;
    const limit = input.limit + 1;

    const where: Prisma.ConversationWhereInput = {
      userId: user.id,
      ...(input.search
        ? { title: { contains: input.search, mode: Prisma.QueryMode.insensitive } }
        : {}),
      ...(input.cursor ? { id: { lt: input.cursor } } : {}),
    };

    const rows = await prisma.conversation.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        title: true,
        mode: true,
        updatedAt: true,
        createdAt: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true },
        },
        _count: { select: { messages: true } },
      },
    });

    const items: ConversationListItem[] = rows.slice(0, input.limit).map((row) => ({
      id: row.id,
      title: row.title,
      mode: row.mode,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      preview: row.messages[0]?.content?.slice(0, 90) ?? "",
      messageCount: row._count.messages,
    }));

    const nextCursor = rows.length > input.limit ? rows[input.limit]?.id : undefined;
    return { items, nextCursor: nextCursor ?? null };
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;
      await ensureOwnership(user, input.id);

      const conversation = await prisma.conversation.findUnique({
        where: { id: input.id },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              role: true,
              content: true,
              sources: true,
              metadata: true,
              createdAt: true,
            },
          },
        },
      });

      if (!conversation) {
        throw new NotFoundError("Conversation", input.id);
      }

      const result: ConversationWithMessages = {
        id: conversation.id,
        title: conversation.title,
        mode: conversation.mode,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages.map((message) => toChatMessage(message)),
      };
      return result;
    }),

  updateTitle: protectedProcedure
    .input(z.object({ id: z.string().min(1), title: z.string().trim().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;
      await ensureOwnership(user, input.id);
      const conversation = await prisma.conversation.update({
        where: { id: input.id },
        data: { title: input.title },
        select: { id: true, title: true, mode: true, updatedAt: true },
      });
      return conversation;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;
      await ensureOwnership(user, input.id);
      await prisma.conversation.delete({ where: { id: input.id } });
      logger.info({ conversationId: input.id, userId: user.id }, "[CONV] deleted");
      return { success: true };
    }),

  export: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;
      await ensureOwnership(user, input.id);

      const conversation = await prisma.conversation.findUnique({
        where: { id: input.id },
        include: {
          messages: {
            orderBy: { createdAt: "asc" },
            select: { role: true, content: true, createdAt: true },
          },
        },
      });

      if (!conversation) {
        throw new NotFoundError("Conversation", input.id);
      }

      const lines = [
        `# ${conversation.title ?? "Behoerden-Bot conversation"}`,
        "",
        `- Conversation ID: ${conversation.id}`,
        `- Created: ${conversation.createdAt.toISOString()}`,
        `- Engine mode: ${conversation.mode}`,
        "",
      ];

      for (const message of conversation.messages) {
        const speaker =
          message.role === "USER"
            ? "User"
            : message.role === "ASSISTANT"
              ? "Assistant"
              : message.role;
        lines.push(`## ${speaker}`, "", message.content, "");
      }

      if (conversation.messages.length === 0) {
        lines.push("_No messages in this conversation._", "");
      }

      return { markdown: lines.join("\n") };
    }),
});
