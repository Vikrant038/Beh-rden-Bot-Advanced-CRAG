import { initTRPC, TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { ZodError } from "zod";
import { DomainError, ErrorCode } from "@/server/lib/errors";
import type { Context } from "@/server/trpc/context";
import { prisma } from "@/server/db";
import { guestEmail } from "@/server/guest";

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    const domainCode = error.cause instanceof DomainError ? error.cause.code : undefined;
    const isZod = error.cause instanceof ZodError;
    return {
      ...shape,
      data: {
        ...shape.data,
        code: domainCode ?? (isZod ? ErrorCode.VALIDATION_FAILED : shape.data.code),
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export interface AuthedUser {
  id: string;
  role: "USER" | "ADMIN";
  /** True when the request is a device-scoped guest (no real account). */
  isGuest?: boolean;
}

const isAuthenticated = t.middleware(async ({ ctx, next }) => {
  const session = ctx.session as Session | null;
  const guestId = (ctx as Context & { guestId?: string }).guestId;

  if (!session?.user?.id && !guestId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  let user: AuthedUser;
  if (session?.user?.id) {
    user = { id: session.user.id, role: session.user.role, isGuest: false };
  } else {
    // Guest admission: the id is signed (server/guest.ts), so treating it as a
    // User id cannot claim another account. Lazy-provision the row once so
    // conversation FKs resolve; guests are plain USER-role users. A single
    // create per device (P2002 = already provisioned on a previous request).
    try {
      await prisma.user.create({
        data: { id: guestId, email: guestEmail(guestId), name: "Guest" },
      });
    } catch (error) {
      const alreadyExists =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!alreadyExists) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: error instanceof Error ? error.message : "Invalid guest session",
        });
      }
    }
    user = { id: guestId, role: "USER", isGuest: true };
  }

  return next({ ctx: { ...ctx, user } });
});

const isAdmin = t.middleware(({ ctx, next }) => {
  const user = (ctx as Context & { user?: AuthedUser }).user;
  if (!user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (user.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});

export const protectedProcedure = t.procedure.use(isAuthenticated);
export const adminProcedure = t.procedure.use(isAuthenticated).use(isAdmin);

// Note: no long-running admin procedures exist anymore — `testPipeline` now
// returns a runId in ~100ms and executes the 15–38s pipeline in the background
// via `after()`, so the old synchronous 50s timeout middleware was removed.
