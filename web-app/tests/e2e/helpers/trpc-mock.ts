import type { Page } from "@playwright/test";

interface TrpcRequest {
  /** Comma-separated procedure paths, e.g. ["conversation.create"]. */
  procedures: string[];
  /** Inputs keyed by op index (from GET `input` param or batch POST body). */
  inputs: Array<Record<string, unknown>>;
}

type TrpcHandler = (input: Record<string, unknown>) => unknown;

const TRPC_PREFIX = "/api/trpc/";

function parseRequest(url: URL, method: string, postData: string | null): TrpcRequest | null {
  if (!url.pathname.startsWith(TRPC_PREFIX)) {
    return null;
  }
  const procedures = url.pathname.slice(TRPC_PREFIX.length).split(",").filter(Boolean);
  if (procedures.length === 0) {
    return null;
  }

  if (method === "GET") {
    const inputParam = url.searchParams.get("input");
    let inputs: Array<Record<string, unknown>> = [];
    if (inputParam) {
      try {
        const parsed = JSON.parse(inputParam) as Record<string, { json?: Record<string, unknown> }>;
        inputs = Object.values(parsed).map((entry) => entry?.json ?? entry);
      } catch {
        inputs = [];
      }
    }
    return { procedures, inputs };
  }

  let inputs: Array<Record<string, unknown>> = [];
  if (postData) {
    try {
      const body = JSON.parse(postData) as Array<{ json: Record<string, unknown> }>;
      inputs = body.map((entry) => entry?.json ?? {});
    } catch {
      inputs = [];
    }
  }
  return { procedures, inputs };
}

/**
 * Intercepts tRPC HTTP calls and answers them from a handler map keyed by
 * procedure name. Handles single- and multi-procedure batches (GET and POST).
 * Handlers not present answer 404 so the test fails loudly. Handlers that throw
 * answer a tRPC `INTERNAL_SERVER_ERROR` error item so clients exercise their
 * real error path (used e.g. to test the admin developer-mode error surface).
 */
export function mockTrpc(page: Page, handlers: Record<string, TrpcHandler>) {
  return page.route("**/api/trpc/**", async (route) => {
    const request = route.request();
    const parsed = parseRequest(new URL(request.url()), request.method(), request.postData());

    if (!parsed) {
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }

    const results = parsed.procedures.map((procedure, index) => {
      // public.guestStatus is an ambient read every page shell performs (login,
      // landing); default it so specs don't each have to duplicate the handler.
      const handler = handlers[procedure] ?? (procedure === "public.guestStatus"
        ? () => ({ hasGuest: false })
        : undefined);
      if (!handler) {
        throw new Error(`E2E tRPC mock: no handler for "${procedure}"`);
      }
      try {
        // No transformer is configured, so the wire format carries the raw data
        // (no `{ json: ... }` wrapper — that only appears with superjson).
        return { result: { data: handler(parsed.inputs[index] ?? {}) } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? (error.stack ?? null) : null;
        return {
          error: {
            json: {
              message,
              code: "INTERNAL_SERVER_ERROR",
              data: {
                code: "INTERNAL_SERVER_ERROR",
                httpStatus: 500,
                path: procedure,
                stack,
              },
            },
          },
        };
      }
    });

    return route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify(results),
    });
  });
}

/**
 * Answers POST /api/chat/stream with a canned SSE payload.
 */
export function mockChatStream(page: Page, events: Array<Record<string, unknown>>) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return page.route("**/api/chat/stream", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      return route.fulfill({ status: 405, body: "Method Not Allowed" });
    }
    return route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body,
    });
  });
}
