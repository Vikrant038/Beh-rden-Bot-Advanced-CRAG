import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/context";

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = (request: Request) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: (opts) => createTRPCContext({ req: opts.req, resHeaders: opts.resHeaders }),
  });
};

export { handler as GET, handler as POST };
