import { router } from "@/server/trpc/t";
import { chatRouter } from "@/server/routers/chat";
import { conversationRouter } from "@/server/routers/conversation";
import { sourceRouter } from "@/server/routers/source";
import { documentRouter } from "@/server/routers/document";
import { adminRouter } from "@/server/routers/admin";

// Feature routers (Phase C).
export const appRouter = router({
  chat: chatRouter,
  conversation: conversationRouter,
  source: sourceRouter,
  document: documentRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
