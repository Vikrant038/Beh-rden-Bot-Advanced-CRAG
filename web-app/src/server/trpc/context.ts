import { auth } from "@/server/auth";
import { prisma } from "@/server/db";

export async function createTRPCContext(opts: { req: Request; resHeaders: Headers }) {
  const session = await auth();

  return {
    db: prisma,
    session,
    headers: opts.req.headers,
    resHeaders: opts.resHeaders,
  };
}

export type Context = Awaited<ReturnType<typeof createTRPCContext>>;
