import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth";
import { readGuestIdFromRequest } from "@/server/guest";
import { chatRateLimiter } from "@/server/lib/security/rate-limiter";
import { runChatStream } from "@/server/rag/chat-pipeline";
import { chatModeSchema } from "@/server/routers/conversation";
import { MAX_QUERY_LENGTH } from "@/lib/chat/types";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("chat-stream-route");

export const runtime = "nodejs";

const streamRequestSchema = z.object({
  conversationId: z.string().min(1),
  query: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
  mode: chatModeSchema.default("agentic"),
  bypassCache: z.boolean().optional(),
});

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export async function POST(request: Request) {
  const session = await auth();
  // Guest admission (3.10): no real session, but a valid signed guest cookie
  // still names the user (the guest id is the User id).
  const userId = session?.user?.id ?? readGuestIdFromRequest(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await chatRateLimiter.check(`chat:${userId}`);
  if (!rateLimit.success) {
    return NextResponse.json(
      {
        error: "Too many requests. Please try again later.",
        resetInSeconds: rateLimit.reset,
      },
      { status: 429 },
    );
  }

  let body: z.infer<typeof streamRequestSchema>;
  try {
    body = streamRequestSchema.parse(await request.json());
  } catch (error) {
    logger.warn({ error: String(error) }, "[STREAM] invalid request body");
    return NextResponse.json({ error: "Invalid request body" }, { status: 422 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: object) => {
        if (request.signal.aborted) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream was cancelled by the client.
        }
      };
      try {
        for await (const event of runChatStream({
          conversationId: body.conversationId,
          userId,
          query: body.query,
          mode: body.mode,
          bypassCache: body.bypassCache,
          signal: request.signal,
        })) {
          if (request.signal.aborted) {
            break;
          }
          emit(event);
        }
      } catch (error) {
        logger.error(
          { error: String(error), conversationId: body.conversationId },
          "[STREAM] pipeline aborted",
        );
        emit({ type: "error", message: "An error occurred while processing your request." });
      } finally {
        controller.close();
      }
    },
    cancel() {
      logger.info("[STREAM] client disconnected; stream cancelled");
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
