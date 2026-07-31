import { initTRPC, TRPCError } from "@trpc/server";
import type { Session } from "next-auth";
import { ZodError } from "zod";
import { DomainError, ErrorCode } from "@/server/lib/errors";
import type { Context } from "@/server/trpc/context";

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
}

const isAuthenticated = t.middleware(({ ctx, next }) => {
  const session = ctx.session as Session | null;
  if (!session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  const user: AuthedUser = {
    id: session.user.id,
    role: session.user.role,
  };
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

// Root router — feature routers attached in Phase C.
export const appRouter = router({});

export type AppRouter = typeof appRouter;
