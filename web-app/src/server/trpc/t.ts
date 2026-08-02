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

const ADMIN_OPERATION_TIMEOUT_MS = 60_000;

/**
 * Timeout guard for long-running admin operations (pipeline tests make 3–5
 * sequential LLM calls). Rejects with INTERNAL_SERVER_ERROR once elapsed time
 * exceeds `ms`, so a hung LLM call fails fast instead of exhausting the
 * serverless function budget.
 */
function withTimeout(ms: number) {
  return t.middleware(async ({ next }) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Operation timed out" })),
        ms,
      );
    });
    try {
      return await Promise.race([next(), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
}

export const adminLongProcedure = t.procedure
  .use(isAuthenticated)
  .use(isAdmin)
  .use(withTimeout(ADMIN_OPERATION_TIMEOUT_MS));
