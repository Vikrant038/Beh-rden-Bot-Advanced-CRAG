import { vi, describe, it, expect, beforeEach } from "vitest";
import { runChatStream, chunkText } from "@/server/rag/chat-pipeline";
import type { ChatStreamEvent } from "@/lib/chat/types";

vi.mock("@/server/db", () => ({
  prisma: {
    conversation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    message: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/server/rag/disambiguation", () => ({
  disambiguateQuery: vi.fn(),
}));
vi.mock("@/server/rag/guardrail", () => ({
  isQueryOutOfDomain: vi.fn(),
  OUT_OF_DOMAIN_MESSAGE:
    "**Out of Domain Detected:** I am a specialized assistant for German immigration, " +
    "student visas, and university admissions. I cannot help with general queries such as " +
    "programming, sports, or other out-of-scope topics.",
}));
vi.mock("@/server/rag/pipeline", () => ({
  runStandardCrag: vi.fn(),
}));
vi.mock("@/server/rag/agents/orchestrator", () => ({
  runAgenticRag: vi.fn(),
}));
vi.mock("@/server/rag/cache/semantic-cache", () => ({
  semanticCache: { checkCache: vi.fn(async () => null), addToCache: vi.fn(async () => undefined) },
}));
vi.mock("@/server/rag/memory/summary-buffer", () => ({
  createMemory: vi.fn(() => ({
    addTurn: vi.fn(async () => undefined),
    getContextFormatted: vi.fn(async () => ""),
    ensureLoaded: vi.fn(async () => undefined),
  })),
}));
vi.mock("@/server/rag/instance", () => ({
  getHybridRetriever: vi.fn(() => ({ embedQuery: vi.fn(), retrieve: vi.fn() })),
}));
vi.mock("@/server/pii/masker", () => ({
  maskPii: vi.fn((query: string) => ({
    text: query,
    originalChars: query.length,
    maskedChars: query.length,
  })),
}));

import { prisma } from "@/server/db";
import type { MockPrisma } from "../helpers/mock-prisma";
import { runStandardCrag } from "@/server/rag/pipeline";
import { runAgenticRag } from "@/server/rag/agents/orchestrator";
import { disambiguateQuery } from "@/server/rag/disambiguation";
import { isQueryOutOfDomain } from "@/server/rag/guardrail";
import type { AgenticRagResponse } from "@/server/rag/agents/orchestrator";

const prismaMock = prisma as unknown as MockPrisma;
const mockedStandard = vi.mocked(runStandardCrag);
const mockedAgentic = vi.mocked(runAgenticRag);
const mockedDisambiguation = vi.mocked(disambiguateQuery);
const mockedGuardrail = vi.mocked(isQueryOutOfDomain);

const standardResult = {
  question: "q",
  answer: "Blocked account total is EUR 11904 for 2026.",
  sources: [{ name: "doc", url: "https://example.com", score: 0.9, documentId: "d1" }],
  retrievalPath: "HYBRID_RRF_CROSS_ENCODER",
  latencyMs: 120,
  isGrounded: true,
  isCached: false,
};

const agenticResult: AgenticRagResponse = {
  userQuery: "q",
  maskedQuery: "q",
  guardrail: { passed: true, reason: "In-domain" },
  finalAnswer: "## Answer\n\n### Actionable Next Steps\n\n1. Step one.",
  researchSteps: [{ iteration: 1, thought: "t", action: "a", observation: "o" }],
  analysisMatrix: { summary: "s", structured_table: "", key_insights: [], verified_facts: [] },
  sources: [{ name: "doc", url: "https://example.com", score: 0.8, documentId: "d1" }],
  totalLatencyMs: 500,
  toolCalls: [],
  stages: [
    { index: 0, name: "Query disambiguation & guardrail", durationMs: 80, status: "executed" },
    { index: 1, name: "Research agent (ReAct)", durationMs: 120, status: "executed" },
    { index: 2, name: "Analyst (comparison matrix)", durationMs: 150, status: "executed" },
    { index: 3, name: "Writer (markdown synthesis)", durationMs: 150, status: "executed" },
  ],
  llmCalls: [
    {
      stage: "Stage 2 — Analyst (comparison matrix)",
      provider: "groq",
      model: "openai/gpt-oss-120b",
      latencyMs: 150,
      promptTokens: 900,
      completionTokens: 220,
      totalTokens: 1120,
      costUsd: 0.0000626,
    },
  ],
  totalCostUsd: 0.0000626,
};

async function collect(input: Parameters<typeof runChatStream>[0]): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of runChatStream(input)) {
    events.push(event);
  }
  return events;
}

function setupDefaults(): void {
  prismaMock.conversation.findUnique.mockResolvedValue({
    id: "conv-1",
    userId: "user-1",
    title: "My chat",
    mode: "STANDARD",
  } as never);
  prismaMock.message.findFirst.mockResolvedValue(null as never);
  prismaMock.message.create.mockImplementation((({ data }: { data: { role: string } }) =>
    Promise.resolve({ id: data.role === "USER" ? "user-msg-1" : "assistant-msg-1" })) as never);
  prismaMock.conversation.update.mockResolvedValue({ id: "conv-1" } as never);
  mockedDisambiguation.mockResolvedValue({ isAmbiguous: false, options: [] });
  mockedGuardrail.mockResolvedValue(false);
}

describe("runChatStream (SSE event generation)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupDefaults();
  });

  it("standard mode: emits statuses, tokens, and a done event with sources", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
      title: "New conversation",
      mode: "STANDARD",
    } as never);
    mockedStandard.mockResolvedValue(standardResult);

    const events = await collect({
      conversationId: "conv-1",
      userId: "user-1",
      query: "What is the blocked account total?",
      mode: "standard",
    });

    expect(mockedStandard).toHaveBeenCalledWith(
      "What is the blocked account total?",
      expect.objectContaining({ bypassCache: false }),
    );

    const stages = events.filter((event) => event.type === "status");
    expect(stages.map((event) => (event as { stage: string }).stage)).toContain("retrieving");

    const tokens = events.filter((event) => event.type === "token");
    expect(tokens.length).toBeGreaterThan(0);

    const done = events.find((event) => event.type === "done");
    expect(done).toBeDefined();
    if (done && done.type === "done") {
      expect(done.messageId).toBe("assistant-msg-1");
      expect(done.sources).toHaveLength(1);
      expect(done.metadata.retrievalPath).toBe("HYBRID_RRF_CROSS_ENCODER");
    }

    expect(prismaMock.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-1" },
        data: expect.objectContaining({ title: "What is the blocked account total?" }),
      }),
    );
    expect(prismaMock.message.create).toHaveBeenCalledTimes(2);
  });

  it("chunkText preserves spaces and newlines across chunk boundaries", () => {
    // Regression: chunks used to be re-joined with a space, dropping the
    // whitespace BETWEEN chunks ("ensure a" + "smooth…" → "ensure asmooth…")
    // and flattening markdown. Concatenating the streamed tokens must
    // reconstruct the source text exactly.
    const prose =
      "To ensure a smooth student visa application process, it's essential to prepare all " +
      "required documents and follow the correct application process.";
    expect(chunkText(prose).join("")).toBe(prose);

    const markdown = "## Answer\n\n### Actionable Next Steps\n\n1. Step one.";
    expect(chunkText(markdown).join("")).toBe(markdown);
  });

  it("agentic mode: emits agent stage statuses and the final answer tokens", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
      title: "My chat",
      mode: "AGENTIC",
    } as never);
    prismaMock.message.findFirst.mockResolvedValue({
      id: "user-msg-1",
      role: "USER",
      content: "Compare blocked account vs scholarship",
    } as never);
    mockedAgentic.mockResolvedValue(agenticResult);

    const events = await collect({
      conversationId: "conv-1",
      userId: "user-1",
      query: "Compare blocked account vs scholarship",
      mode: "agentic",
    });

    const stages = events.filter((event) => event.type === "status");
    // The legacy coarse "guardrail"/"agent_research" statuses were replaced by
    // granular stage_start/agent_start telemetry events (the orchestrator's
    // `agent_start: research` covers the research stage), so only the analyst
    // and writer coarse statuses remain.
    expect(stages.map((event) => (event as { stage: string }).stage)).toEqual([
      "agent_analyst",
      "agent_writer",
    ]);

    const fullText = events
      .filter((event) => event.type === "token")
      .map((event) => (event as { content: string }).content)
      .join("");
    expect(fullText).toContain("Actionable Next Steps");

    // user message was reused (findFirst matched) → only assistant is persisted
    expect(prismaMock.message.create).toHaveBeenCalledTimes(1);
    expect(mockedAgentic).toHaveBeenCalledWith(
      "Compare blocked account vs scholarship",
      expect.objectContaining({ bypassCache: false }),
    );
  });

  it("agentic mode: streams live tokens from onEvent and records cache hit metadata", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "user-1",
      title: "My chat",
      mode: "AGENTIC",
    } as never);
    prismaMock.message.findFirst.mockResolvedValue(null as never);
    mockedAgentic.mockImplementation(async (_query, options) => {
      options?.onEvent?.({ type: "token", value: "live-token-1 " } as never);
      options?.onEvent?.({ type: "token", value: "live-token-2" } as never);
      return {
        ...agenticResult,
        finalAnswer: "live-token-1 live-token-2",
        researchSteps: [{ action: "Semantic Cache Hit" } as never],
      };
    });

    const events = await collect({
      conversationId: "conv-1",
      userId: "user-1",
      query: "cached agentic query",
      mode: "agentic",
    });

    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done && done.type === "done") {
      expect(done.metadata.isCached).toBe(true);
      expect(done.metadata.isGrounded).toBe(true);
    }
  });

  it("disambiguation: emits clarifying options and stops without persisting an answer", async () => {
    prismaMock.message.findFirst.mockResolvedValue({
      id: "user-msg-1",
      role: "USER",
      content: "When I move to Germany...",
    } as never);
    mockedDisambiguation.mockResolvedValue({
      isAmbiguous: true,
      options: ["A", "B", "C"],
    });

    const events = await collect({
      conversationId: "conv-1",
      userId: "user-1",
      query: "When I move to Germany...",
      mode: "agentic",
    });

    const disambiguation = events.find((event) => event.type === "disambiguation");
    expect(disambiguation).toBeDefined();
    if (disambiguation && disambiguation.type === "disambiguation") {
      expect(disambiguation.options).toEqual(["A", "B", "C"]);
    }
    expect(events.some((event) => event.type === "done")).toBe(false);
    expect(mockedAgentic).not.toHaveBeenCalled();
    expect(mockedStandard).not.toHaveBeenCalled();
  });

  it("standard mode: guardrail blocks out-of-domain queries with a blocked done event", async () => {
    mockedGuardrail.mockResolvedValue(true);

    const events = await collect({
      conversationId: "conv-1",
      userId: "user-1",
      query: "cricket scores",
      mode: "standard",
    });

    const done = events.find((event) => event.type === "done");
    expect(done).toBeDefined();
    if (done && done.type === "done") {
      expect(done.metadata.blocked).toBe(true);
      expect(done.sources).toEqual([]);
    }
    expect(mockedStandard).not.toHaveBeenCalled();
  });

  it("persists a graceful error message when the pipeline throws", async () => {
    mockedStandard.mockRejectedValue(new Error("LLM provider down"));

    const events = await collect({
      conversationId: "conv-1",
      userId: "user-1",
      query: "will fail",
      mode: "standard",
    });

    const error = events.find((event) => event.type === "error");
    expect(error).toBeDefined();
    const done = events.find((event) => event.type === "done");
    expect(done).toBeDefined();
    if (done && done.type === "done") {
      expect(done.messageId).toBe("assistant-msg-1");
      expect(done.metadata.retrievalPath).toBe("PIPELINE_ERROR");
    }
  });

  it("throws NotFoundError when the conversation is not owned by the user", async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({
      id: "conv-1",
      userId: "someone-else",
      title: "Theirs",
      mode: "AGENTIC",
    } as never);

    const collectPromise = collect({
      conversationId: "conv-1",
      userId: "user-1",
      query: "hello",
      mode: "agentic",
    });
    await expect(collectPromise).rejects.toThrow("not found");
  });

  it("yields disambiguation options directly when query is ambiguous", async () => {
    mockedDisambiguation.mockResolvedValue({
      isAmbiguous: true,
      options: ["Apply for APS India", "Apply for Student Visa"],
    });

    const events = await collect({
      conversationId: "conv-1",
      userId: "user-1",
      query: "I need visa info",
      mode: "standard",
    });

    const disambigEvent = events.find((e) => e.type === "disambiguation");
    expect(disambigEvent).toBeDefined();
    if (disambigEvent && disambigEvent.type === "disambiguation") {
      expect(disambigEvent.options).toEqual(["Apply for APS India", "Apply for Student Visa"]);
    }
  });

  it("stops streaming tokens when AbortSignal is already aborted", async () => {
    mockedStandard.mockResolvedValue(standardResult as never);
    const controller = new AbortController();
    controller.abort();

    const events = await collect({
      conversationId: "conv-1",
      userId: "user-1",
      query: "student visa",
      mode: "standard",
      signal: controller.signal,
    });

    const tokens = events.filter((e) => e.type === "token");
    expect(tokens.length).toBe(0);
  });

  it("chunkText splits text preserving content", () => {
    expect(chunkText("")).toEqual([""]);
    const text = "First sentence. Second sentence!";
    expect(chunkText(text).join("")).toBe(text);
  });
});
