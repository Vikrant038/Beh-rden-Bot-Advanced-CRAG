import { vi, describe, it, expect, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/server/auth", () => ({
  auth: (...args: unknown[]) => mockAuth(...args),
}));

const mockRateCheck = vi.fn();
vi.mock("@/server/lib/security/rate-limiter", () => ({
  chatRateLimiter: { check: (...args: unknown[]) => mockRateCheck(...args) },
}));

const mockRunChatStream = vi.fn();
vi.mock("@/server/rag/chat-pipeline", () => ({
  runChatStream: (...args: unknown[]) => mockRunChatStream(...args),
}));

import { POST } from "@/app/api/chat/stream/route";

const session = {
  user: { id: "user-1", role: "USER" },
  expires: "2099-01-01T00:00:00.000Z",
};

function buildRequest(overrides: Record<string, unknown> = {}): Request {
  return new Request("http://localhost/api/chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId: "conv-1", query: "hello", ...overrides }),
  });
}

function streamEvents(...events: Array<Record<string, unknown>>): AsyncGenerator<Record<string, unknown>> {
  return (async function* () {
    for (const event of events) {
      yield event;
    }
  })();
}

describe("POST /api/chat/stream", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockResolvedValue(session);
    mockRateCheck.mockResolvedValue({ success: true, reset: 0 });
    mockRunChatStream.mockImplementation(() => streamEvents(
      { type: "status", stage: "guardrail" },
      { type: "token", content: "Hello world" },
      { type: "done", messageId: "m1", sources: [], metadata: {} },
    ));
  });

  it("returns 401 when the request is unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const response = await POST(buildRequest());
    expect(response.status).toBe(401);
    expect(mockRunChatStream).not.toHaveBeenCalled();
  });

  it("returns 429 with resetInSeconds when rate limited", async () => {
    mockRateCheck.mockResolvedValue({ success: false, reset: 37 });
    const response = await POST(buildRequest());
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.resetInSeconds).toBe(37);
    expect(mockRunChatStream).not.toHaveBeenCalled();
  });

  it("returns 422 for an invalid request body", async () => {
    const response = await POST(buildRequest({ query: "" }));
    expect(response.status).toBe(422);
    expect(mockRunChatStream).not.toHaveBeenCalled();
  });

  it("streams status, token, and done events as text/event-stream", async () => {
    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-accel-buffering")).toBe("no");

    const body = await response.text();
    expect(body).toContain(`data: ${JSON.stringify({ type: "status", stage: "guardrail" })}\n\n`);
    expect(body).toContain(`data: ${JSON.stringify({ type: "token", content: "Hello world" })}\n\n`);
    expect(body).toContain(`data: ${JSON.stringify({ type: "done", messageId: "m1", sources: [], metadata: {} })}\n\n`);
  });

  it("passes the session user id, default mode, and query to the pipeline", async () => {
    await POST(buildRequest());
    expect(mockRunChatStream).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        userId: "user-1",
        query: "hello",
        mode: "agentic",
        bypassCache: undefined,
      }),
    );
  });

  it("propagates an explicit mode and bypassCache flag", async () => {
    await POST(buildRequest({ mode: "standard", bypassCache: true }));
    expect(mockRunChatStream).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "standard", bypassCache: true }),
    );
  });

  it("emits an error event and still closes the stream when the pipeline throws", async () => {
    mockRunChatStream.mockImplementation(() => {
      throw new Error("boom");
    });
    const response = await POST(buildRequest());
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"type":"error"');
  });
});
