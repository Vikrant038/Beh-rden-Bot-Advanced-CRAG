import { vi, describe, it, expect, beforeEach } from "vitest";
import type { ResearchResult } from "@/server/rag/agents/research";
import type { AnalystMatrix } from "@/server/rag/agents/analyst";

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

/** Groq streaming responses are async-iterable chunks of choice deltas. */
function groqStream(deltas: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const content of deltas) {
        yield { choices: [{ delta: { content } }] };
      }
    },
  };
}

/** Emits `deltas`, then throws — the mid-stream failure case. */
function groqStreamThatFails(deltas: string[], error: Error) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const content of deltas) {
        yield { choices: [{ delta: { content } }] };
      }
      throw error;
    },
  };
}

const RESEARCH: ResearchResult = {
  combinedContext: "APS verifies Indian academic documents.",
  sources: [],
  researchSteps: [],
  toolCalls: [],
} as unknown as ResearchResult;

const MATRIX: AnalystMatrix = {
  summary: "Analyst summary text.",
  structured_table: "| A | B |\n|---|---|",
  key_insights: ["insight"],
  verified_facts: ["fact"],
};

describe("writer agent streaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
    process.env.GROQ_API_KEY = "test-groq-key";
    vi.resetModules();
  });

  it("emits each delta live and returns the joined answer", async () => {
    mockCreate.mockResolvedValue(groqStream(["## Answer\n", "APS is ", "required."]));

    const { agentWriterSynthesis } = await import("@/server/rag/agents/analyst");
    const seen: string[] = [];
    const answer = await agentWriterSynthesis("Is APS mandatory?", RESEARCH, MATRIX, (delta) =>
      seen.push(delta),
    );

    expect(seen).toEqual(["## Answer\n", "APS is ", "required."]);
    expect(answer).toBe("## Answer\nAPS is required.");
    // The streamed deltas must reconstruct exactly the persisted answer,
    // otherwise the browser shows different text than what is saved.
    expect(seen.join("").trim()).toBe(answer);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true }),
      expect.anything(),
    );
  });

  it("uses the buffered call and emits nothing when no onToken is given", async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "buffered answer" } }] });

    const { agentWriterSynthesis } = await import("@/server/rag/agents/analyst");
    const answer = await agentWriterSynthesis("q", RESEARCH, MATRIX);

    expect(answer).toBe("buffered answer");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({ stream: true }),
      expect.anything(),
    );
  });

  it("keeps the partial answer when the stream dies mid-flight", async () => {
    mockCreate.mockResolvedValue(
      groqStreamThatFails(["## Partial\n", "text so far"], new Error("connection reset")),
    );

    const { agentWriterSynthesis } = await import("@/server/rag/agents/analyst");
    const seen: string[] = [];
    const answer = await agentWriterSynthesis("q", RESEARCH, MATRIX, (delta) => seen.push(delta));

    // Those deltas are already rendered in the browser, so the returned answer
    // must match them rather than swapping in the analyst-summary fallback.
    expect(answer).toBe("## Partial\ntext so far");
    expect(seen.join("").trim()).toBe(answer);
    expect(answer).not.toContain("Analyst summary text.");
  });

  it("falls back to the analyst summary when the stream fails before any token", async () => {
    // No HF_TOKEN: the buffered retry path exhausts both providers quickly
    // instead of waiting out the HuggingFace backoff.
    delete process.env.HF_TOKEN;
    mockCreate.mockRejectedValue(new Error("groq unavailable"));

    const { agentWriterSynthesis } = await import("@/server/rag/agents/analyst");
    const seen: string[] = [];
    const answer = await agentWriterSynthesis("q", RESEARCH, MATRIX, (delta) => seen.push(delta));

    expect(seen).toEqual([]);
    expect(answer).toContain("Analyst summary text.");
  }, 30_000);

  it("falls back to the analyst summary when the stream ends without content", async () => {
    mockCreate.mockResolvedValue(groqStream([]));

    const { agentWriterSynthesis } = await import("@/server/rag/agents/analyst");
    const answer = await agentWriterSynthesis("q", RESEARCH, MATRIX, () => {});

    expect(answer).toContain("Analyst summary text.");
  });

  it("returns the fallback matrix when the analyst response fails schema validation", async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: "{}" } }] });

    const { agentAnalystEvaluation } = await import("@/server/rag/agents/analyst");
    const result = await agentAnalystEvaluation("Is APS mandatory?", RESEARCH);

    expect(result.summary).toContain("Analysis completed");
    expect(result.structured_table).toContain("General Info");
  });

  it("returns the parsed matrix when the analyst response passes schema validation", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "APS is mandatory for Indian applicants.",
              structured_table: "| A | B |",
              key_insights: ["insight-1"],
              verified_facts: ["fact-1"],
            }),
          },
        },
      ],
    });

    const { agentAnalystEvaluation } = await import("@/server/rag/agents/analyst");
    const result = await agentAnalystEvaluation("Is APS mandatory?", RESEARCH);

    expect(result.summary).toBe("APS is mandatory for Indian applicants.");
    expect(result.key_insights).toEqual(["insight-1"]);
    expect(result.verified_facts).toEqual(["fact-1"]);
  });
});

describe("callLLMStream fallback safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...env };
    process.env.GROQ_API_KEY = "test-groq-key";
    process.env.HF_TOKEN = "test-hf-token";
    vi.resetModules();
  });

  it("does not replay the whole answer after a mid-stream failure", async () => {
    mockCreate.mockResolvedValue(groqStreamThatFails(["partial "], new Error("stream broke")));

    const { callLLMStream } = await import("@/server/llm/client");
    const chunks: string[] = [];
    await expect(async () => {
      for await (const delta of callLLMStream([{ role: "user", content: "hi" }])) {
        chunks.push(delta);
      }
    }).rejects.toThrow("stream broke");

    // Falling back here would re-yield the full answer on top of "partial ",
    // duplicating text that is already on screen.
    expect(chunks).toEqual(["partial "]);
  });

  it("falls back to a buffered call when streaming fails before the first token", async () => {
    mockCreate
      .mockRejectedValueOnce(new Error("stream unsupported"))
      .mockResolvedValue({ choices: [{ message: { content: "buffered fallback" } }] });

    const { callLLMStream } = await import("@/server/llm/client");
    const chunks: string[] = [];
    for await (const delta of callLLMStream([{ role: "user", content: "hi" }])) {
      chunks.push(delta);
    }

    expect(chunks).toEqual(["buffered fallback"]);
  });
});
