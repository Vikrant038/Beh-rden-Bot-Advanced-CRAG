import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/context";

export const runtime = "nodejs";
// Hobby ceiling (300s). The tester's `testPipeline` returns in ~100ms and runs
// the real pipeline via `after()`, which counts against this same budget; 300s
// leaves full headroom for the 15–38s background run.
export const maxDuration = 300;

const handler = (request: Request) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: (opts) => createTRPCContext({ req: opts.req, resHeaders: opts.resHeaders }),
  });
};

export { handler as GET, handler as POST };
