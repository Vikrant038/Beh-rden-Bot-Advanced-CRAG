import { z } from "zod";
import { Prisma } from "@prisma/client";
import { router, protectedProcedure } from "@/server/trpc/t";
import { prisma } from "@/server/db";
import { GuestLimitReachedError, NotFoundError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";
import type { AuthedUser } from "@/server/trpc/t";
import type { ChatMessage, ChatSource } from "@/lib/chat/types";
import { GUEST_PROMPT_LIMIT } from "@/lib/guest";
import {
  countGuestPromptsUsed,
  ensureConversationOwnership,
} from "@/server/lib/conversation-policy";

const logger = createLogger("conversation-router");

/**
 * Zod schema for the ChatSource shape stored in Message.sources (Json?).
 *
 * Design note: Message.sources is intentionally kept as a Json? blob rather
 * than a separate MessageSource relation. Sources are only ever read as part
 * of their parent message (never joined or queried independently), so a
 * relational table adds schema complexity with no query benefit.
 *
 * The trade-off: SQL-level queries on "which documents were cited most" are
 * impossible without a relation. If that analytics use-case is needed later,
 * migrate to a MessageSource table at that point.
 *
 * This Zod schema is the contract enforcement at the read boundary — it catches
 * any malformed or legacy JSON before it reaches the client, returning an empty
 * array rather than propagating corrupt data.
 */
const chatSourceSchema = z.object({
  name: z.string(),
  url: z.string(),
  score: z.number(),
  documentId: z.string().optional(),
});

const chatSourceArraySchema = z.array(chatSourceSchema);

function parseSourcesJson(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) return [];
  const result = chatSourceArraySchema.safeParse(value);
  return result.success ? result.data : [];
}

export const chatModeSchema = z.enum(["standard", "agentic"]);

const paginationSchema = z.object({
  cursor: z.object({ updatedAt: z.coerce.date(), id: z.string() }).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(200).optional(),
  mode: chatModeSchema.optional(),
  includeDeleted: z.boolean().default(false),
  pinnedOnly: z.boolean().default(false),
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
  /**
   * True when the viewer may read but not write. Owners get `false`; admins
   * opening another user's conversation (admin dashboard drill-in) get `true`
   * so the UI disables the composer. The write paths (stream route,
   * regenerate, clear, delete) enforce ownership independently.
   */
  readOnly: boolean;
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
    sources: parseSourcesJson(row.sources),
    metadata: parseJsonObject(row.metadata) as ChatMessage["metadata"],
    createdAt: row.createdAt.toISOString(),
  };
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

      // Free-tier cap: guests may ask at most GUEST_PROMPT_LIMIT prompts (USER
      // messages across all non-deleted conversations). Soft-deleting a
      // conversation frees its prompts, so a guest always has up to N prompts at
      // a time. Signing in lifts the cap entirely and the guest's data is
      // transferred to the account (see server/guest.ts + trpc/context.ts).
      if (user.isGuest) {
        const promptCount = await countGuestPromptsUsed(prisma, user.id);
        if (promptCount >= GUEST_PROMPT_LIMIT) {
          throw new GuestLimitReachedError(GUEST_PROMPT_LIMIT);
        }
      }

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
      deletedAt: input.includeDeleted ? { not: null } : null,
      ...(input.pinnedOnly ? { pinned: true } : {}),
      ...(input.search
        ? { title: { contains: input.search, mode: Prisma.QueryMode.insensitive } }
        : {}),
      ...(input.mode ? { mode: input.mode === "standard" ? "STANDARD" : "AGENTIC" } : {}),
      ...(input.cursor
        ? {
            OR: [
              { updatedAt: { lt: input.cursor.updatedAt } },
              { updatedAt: input.cursor.updatedAt, id: { lt: input.cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await prisma.conversation.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        title: true,
        mode: true,
        pinned: true,
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

    const items = rows.slice(0, input.limit).map((row) => ({
      id: row.id,
      title: row.title,
      mode: row.mode,
      pinned: row.pinned,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      preview: row.messages[0]?.content?.slice(0, 90) ?? "",
      messageCount: row._count.messages,
    }));

    const lastItem = rows.length > input.limit ? rows[input.limit - 1] : undefined;
    const nextCursor =
      rows.length > input.limit && lastItem
        ? { updatedAt: lastItem.updatedAt, id: lastItem.id }
        : null;
    return { items, nextCursor };
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;

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

      // Ownership: a user may only open their own conversations. Admins may
      // open ANY conversation — the admin dashboard drills into all users'
      // recent queries — but the returned `readOnly` flag tells the UI to
      // disable writes. The write paths (SSE stream route, regenerate, clear,
      // delete, rename, pin) enforce ownership independently, so read-only is
      // a UX guard, not the security boundary.
      const isOwner = conversation.userId === user.id;
      if (!isOwner && user.role !== "ADMIN") {
        throw new NotFoundError("Conversation", input.id);
      }

      const result: ConversationWithMessages = {
        id: conversation.id,
        title: conversation.title,
        mode: conversation.mode,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages.map((message) => toChatMessage(message)),
        readOnly: !isOwner,
      };
      return result;
    }),

  updateTitle: protectedProcedure
    .input(z.object({ id: z.string().min(1), title: z.string().trim().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;
      await ensureConversationOwnership(prisma, user, input.id);
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
      await ensureConversationOwnership(prisma, user, input.id);
      await prisma.conversation.update({
        where: { id: input.id },
        data: { deletedAt: new Date() },
      });
      logger.info({ conversationId: input.id, userId: user.id }, "[CONV] soft deleted");
      return { success: true };
    }),

  deleteMany: protectedProcedure
    .input(z.object({ ids: z.array(z.string().min(1)).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;
      const ids = [...new Set(input.ids)];
      const owned = await prisma.conversation.findMany({
        where: { id: { in: ids }, userId: user.id },
        select: { id: true },
      });
      const ownedIds = owned.map((row) => row.id);
      if (ownedIds.length > 0) {
        await prisma.conversation.updateMany({
          where: { id: { in: ownedIds } },
          data: { deletedAt: new Date() },
        });
      }
      logger.info(
        { deleted: ownedIds.length, requested: ids.length, userId: user.id },
        "[CONV] bulk soft deleted",
      );
      return { success: true, deleted: ownedIds.length };
    }),

  clearAll: protectedProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(200).optional(),
          mode: chatModeSchema.optional(),
          ids: z.array(z.string().min(1)).optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;
      const where: Prisma.ConversationWhereInput = {
        userId: user.id,
        deletedAt: null,
        ...(input?.ids ? { id: { in: input.ids } } : {}),
        ...(input?.search
          ? { title: { contains: input.search, mode: Prisma.QueryMode.insensitive } }
          : {}),
        ...(input?.mode ? { mode: input.mode === "standard" ? "STANDARD" : "AGENTIC" } : {}),
      };
      const result = await prisma.conversation.updateMany({
        where,
        data: { deletedAt: new Date() },
      });
      logger.info({ deleted: result.count, userId: user.id }, "[CONV] cleared filtered");
      return { success: true, deleted: result.count };
    }),

  restore: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;
      const conversation = await prisma.conversation.findFirst({
        where: { id: input.id, userId: user.id },
        select: { id: true },
      });
      if (!conversation) {
        throw new NotFoundError("Conversation", input.id);
      }
      await prisma.conversation.update({
        where: { id: input.id },
        data: { deletedAt: null },
      });
      logger.info({ conversationId: input.id, userId: user.id }, "[CONV] restored");
      return { success: true, id: input.id };
    }),

  clear: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;
      await ensureConversationOwnership(prisma, user, input.id);
      await prisma.message.deleteMany({ where: { conversationId: input.id } });
      logger.info({ conversationId: input.id, userId: user.id }, "[CONV] cleared");
      return { success: true };
    }),

  export: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;
      await ensureConversationOwnership(prisma, user, input.id);

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

  setPinned: protectedProcedure
    .input(z.object({ id: z.string().min(1), pinned: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;
      await ensureConversationOwnership(prisma, user, input.id);
      const updated = await prisma.conversation.update({
        where: { id: input.id },
        data: { pinned: input.pinned },
        select: { id: true, pinned: true },
      });
      logger.info(
        { conversationId: input.id, pinned: input.pinned, userId: user.id },
        "[CONV] pinned status updated",
      );
      return updated;
    }),

  count: protectedProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(200).optional(),
          mode: chatModeSchema.optional(),
          pinnedOnly: z.boolean().default(false),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const user = ctx.user as AuthedUser;

      // For guests, `count` reports the number of prompts (USER messages) used
      // so the sidebar chip reads `n/GUEST_PROMPT_LIMIT prompts` — the resource
      // that is actually capped. Signed-in users get the conversation count.
      if (user.isGuest) {
        const prompts = await countGuestPromptsUsed(prisma, user.id);
        return { count: prompts };
      }

      const count = await prisma.conversation.count({
        where: {
          userId: user.id,
          deletedAt: null,
          ...(input?.pinnedOnly ? { pinned: true } : {}),
          ...(input?.search
            ? { title: { contains: input.search, mode: Prisma.QueryMode.insensitive } }
            : {}),
          ...(input?.mode ? { mode: input.mode === "standard" ? "STANDARD" : "AGENTIC" } : {}),
        },
      });
      return { count };
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user as AuthedUser;
    const [total, pinned, deleted, messageAggregate] = await Promise.all([
      prisma.conversation.count({
        where: { userId: user.id, deletedAt: null },
      }),
      prisma.conversation.count({
        where: { userId: user.id, deletedAt: null, pinned: true },
      }),
      prisma.conversation.count({
        where: { userId: user.id, deletedAt: { not: null } },
      }),
      prisma.message.count({
        where: { conversation: { userId: user.id, deletedAt: null } },
      }),
    ]);
    return {
      totalConversations: total,
      pinnedConversations: pinned,
      deletedConversations: deleted,
      totalMessages: messageAggregate,
    };
  }),

  exportAll: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user as AuthedUser;
    const conversations = await prisma.conversation.findMany({
      where: { userId: user.id, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: { role: true, content: true, createdAt: true },
        },
      },
    });

    const documentParts: string[] = [
      `# Behörden-Bot Complete Export`,
      `Exported at: ${new Date().toISOString()}`,
      `Total Conversations: ${conversations.length}`,
      `---\n`,
    ];

    for (const conv of conversations) {
      documentParts.push(
        `## ${conv.title ?? "Untitled Conversation"}`,
        `- ID: ${conv.id}`,
        `- Mode: ${conv.mode}`,
        `- Updated: ${conv.updatedAt.toISOString()}`,
        "",
      );
      for (const msg of conv.messages) {
        documentParts.push(`**${msg.role}:** ${msg.content}\n`);
      }
      documentParts.push("---\n");
    }

    return { markdown: documentParts.join("\n") };
  }),
});
