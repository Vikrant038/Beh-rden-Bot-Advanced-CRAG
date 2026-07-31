import { vi, describe, it, expect, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  }
  return { default: MockOpenAI };
});

const env = process.env;
const originalFetch = globalThis.fetch;

describe("LLM client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.HF_TOKEN = "test-hf-token";
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it("should call Groq via OpenAI SDK and return trimmed content", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "  hello world  " } }],
    });

    const { callLLM } = await import("@/server/llm/client");
    const result = await callLLM([{ role: "user", content: "hi" }]);
    expect(result).toBe("hello world");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("should throw when Groq client unavailable (no API key)", async () => {
    delete process.env.GROQ_API_KEY;
    const { callLLM } = await import("@/server/llm/client");
    await expect(callLLM([{ role: "user", content: "hi" }])).rejects.toThrow(
      /No working LLM provider/,
    );
  });

  it("should fall back to HuggingFace when Groq fails", async () => {
    mockCreate.mockRejectedValue(new Error("Groq 503"));
    const hfResponse = { ok: true, json: async () => ({ generated_text: "hf answer" }) };
    globalThis.fetch = vi.fn().mockResolvedValue(hfResponse);

    const { callLLM } = await import("@/server/llm/client");
    const result = await callLLM([{ role: "user", content: "hi" }], { maxTokens: 100 });
    expect(result).toBe("hf answer");
    expect(globalThis.fetch).toHaveBeenCalled();
  }, 20000);

  it("should throw when both providers fail", async () => {
    mockCreate.mockRejectedValue(new Error("Groq down"));
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => "err" });

    const { callLLM } = await import("@/server/llm/client");
    await expect(callLLM([{ role: "user", content: "hi" }])).rejects.toThrow(
      /No working LLM provider/,
    );
  }, 20000);

  it("should throw HF raw error when HF_TOKEN missing", async () => {
    mockCreate.mockRejectedValue(new Error("Groq down"));
    delete process.env.HF_TOKEN;

    const { callLLM } = await import("@/server/llm/client");
    await expect(callLLM([{ role: "user", content: "hi" }])).rejects.toThrow(
      /No working LLM provider/,
    );
  }, 20000);

  it("callLLMStream should yield streamed deltas from Groq", async () => {
    mockCreate.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: "Hel" } }] };
        yield { choices: [{ delta: { content: "lo" } }] };
        yield { choices: [{ delta: { content: null } }] };
      },
    });

    const { callLLMStream } = await import("@/server/llm/client");
    const parts: string[] = [];
    for await (const chunk of callLLMStream([{ role: "user", content: "hi" }])) {
      parts.push(chunk);
    }
    expect(parts.join("")).toBe("Hello");
  });

  it("callLLMStream should fall back to non-streamed when Groq unavailable", async () => {
    delete process.env.GROQ_API_KEY;
    const hfResponse = { ok: true, json: async () => ({ generated_text: "fallback" }) };
    globalThis.fetch = vi.fn().mockResolvedValue(hfResponse);

    const { callLLMStream } = await import("@/server/llm/client");
    const parts: string[] = [];
    for await (const chunk of callLLMStream([{ role: "user", content: "hi" }])) {
      parts.push(chunk);
    }
    expect(parts).toEqual(["fallback"]);
  }, 20000);
});
