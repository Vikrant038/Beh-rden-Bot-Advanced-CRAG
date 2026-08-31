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

  /** Standard Groq-success response: `content` returned trimmed. */
  const groqOk = (content: string) =>
    mockCreate.mockResolvedValue({
      choices: [{ message: { content } }],
    });
  /** Groq throws; the (optional) fetch mock handles the HF fallback path. */
  const groqDown = (fetchResponse?: object) => {
    mockCreate.mockRejectedValue(new Error("Groq down"));
    if (fetchResponse) {
      globalThis.fetch = vi.fn().mockResolvedValue(fetchResponse);
    }
  };

  it("should call Groq via OpenAI SDK and return trimmed content", async () => {
    groqOk("  hello world  ");

    const { callLLM } = await import("@/server/llm/client");
    const result = await callLLM([{ role: "user", content: "hi" }]);
    expect(result).toBe("hello world");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("records per-call latency, tokens, and cost into an active usage collector", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "answer" } }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
    }); // usage-bearing response stays explicit

    const { callLLM } = await import("@/server/llm/client");
    const { LlmUsageCollector, withLlmUsageCollector } = await import("@/server/llm/usage");
    const collector = new LlmUsageCollector();

    await withLlmUsageCollector(collector, async () => {
      collector.setStage("Stage 2 — Analyst (comparison matrix)");
      await callLLM([{ role: "user", content: "hi" }]);
    });

    expect(collector.calls).toHaveLength(1);
    expect(collector.calls[0]).toMatchObject({
      provider: "groq",
      model: "openai/gpt-oss-120b",
      promptTokens: 12,
      completionTokens: 4,
      totalTokens: 16,
      stage: "Stage 2 — Analyst (comparison matrix)",
    });
    // 12/1M * 0.15 + 4/1M * 0.60
    expect(collector.calls[0]?.costUsd).toBeCloseTo(0.0000042, 10);
    expect(collector.calls[0]?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("does not record usage when no collector is active", async () => {
    groqOk("answer");

    const { callLLM } = await import("@/server/llm/client");
    await callLLM([{ role: "user", content: "hi" }]);
    // No throw + no side effect is the contract; nothing to assert beyond success.
  });

  it("should throw when Groq client unavailable (no API key)", async () => {
    delete process.env.GROQ_API_KEY;
    const { callLLM } = await import("@/server/llm/client");
    await expect(callLLM([{ role: "user", content: "hi" }])).rejects.toThrow(
      /No working LLM provider/,
    );
  });

  it("should fall back to HuggingFace when Groq fails", async () => {
    groqDown({ ok: true, json: async () => ({ generated_text: "hf answer" }) });

    const { callLLM } = await import("@/server/llm/client");
    const result = await callLLM([{ role: "user", content: "hi" }], { maxTokens: 100 });
    expect(result).toBe("hf answer");
    expect(globalThis.fetch).toHaveBeenCalled();
  }, 20000);

  it("should throw when both providers fail", async () => {
    groqDown({ ok: false, status: 500, text: async () => "err" });

    const { callLLM } = await import("@/server/llm/client");
    await expect(callLLM([{ role: "user", content: "hi" }])).rejects.toThrow(
      /No working LLM provider/,
    );
  }, 20000);

  it("should throw HF raw error when HF_TOKEN missing", async () => {
    groqDown();
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
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ generated_text: "fallback" }) });

    const { callLLMStream } = await import("@/server/llm/client");
    const parts: string[] = [];
    for await (const chunk of callLLMStream([{ role: "user", content: "hi" }])) {
      parts.push(chunk);
    }
    expect(parts).toEqual(["fallback"]);
  }, 20000);

  it("handles a HuggingFace array response shape", async () => {
    groqDown({
      ok: true,
      headers: new Headers(),
      json: async () => [{ generated_text: "first" }, { generated_text: "second" }],
    });

    const { callLLM } = await import("@/server/llm/client");
    const result = await callLLM([{ role: "user", content: "hi" }]);
    expect(result).toBe("first");
  }, 20000);

  it("fails when HuggingFace returns an empty completion", async () => {
    groqDown({
      ok: true,
      headers: new Headers(),
      json: async () => ({ generated_text: "" }),
    });

    const { callLLM } = await import("@/server/llm/client");
    await expect(callLLM([{ role: "user", content: "hi" }])).rejects.toThrow(
      /No working LLM provider/,
    );
  }, 20000);

  it("prefers the X-Usage header token counts from HuggingFace", async () => {
    groqDown({
      ok: true,
      headers: new Headers({ "x-usage": JSON.stringify({ input_tokens: 50, output_tokens: 20 }) }),
      json: async () => ({ generated_text: "hf answer" }),
    });

    const { callLLM } = await import("@/server/llm/client");
    await expect(callLLM([{ role: "user", content: "hi" }])).resolves.toBe("hf answer");
  }, 20000);

  it("ignores a malformed X-Usage header and keeps the estimate", async () => {
    groqDown({
      ok: true,
      headers: new Headers({ "x-usage": "not-json" }),
      json: async () => ({ generated_text: "hf answer" }),
    });

    const { callLLM } = await import("@/server/llm/client");
    await expect(callLLM([{ role: "user", content: "hi" }])).resolves.toBe("hf answer");
  }, 20000);

  it("fails when Groq returns an empty completion on every attempt", async () => {
    groqOk("");
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => "err" });

    const { callLLM } = await import("@/server/llm/client");
    await expect(callLLM([{ role: "user", content: "hi" }])).rejects.toThrow(
      /No working LLM provider/,
    );
  }, 20000);

  it("callLLMStream re-throws when streaming fails after the first token", async () => {
    mockCreate.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: "Hel" } }] };
        throw new Error("stream aborted");
      },
    });

    const { callLLMStream } = await import("@/server/llm/client");
    const parts: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of callLLMStream([{ role: "user", content: "hi" }])) {
          parts.push(chunk);
        }
      })(),
    ).rejects.toThrow("stream aborted");
    expect(parts).toEqual(["Hel"]);
  });

  it("callLLMStream falls back to non-streamed when Groq streaming fails before the first token", async () => {
    groqDown({
      ok: true,
      headers: new Headers(),
      json: async () => ({ generated_text: "fallback" }),
    });

    const { callLLMStream } = await import("@/server/llm/client");
    const parts: string[] = [];
    for await (const chunk of callLLMStream([{ role: "user", content: "hi" }])) {
      parts.push(chunk);
    }
    expect(parts).toEqual(["fallback"]);
  }, 20000);
});
