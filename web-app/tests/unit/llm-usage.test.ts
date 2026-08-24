import { describe, it, expect } from "vitest";
import {
  LlmUsageCollector,
  aggregateAgentCosts,
  estimateLlmCostUsd,
  estimateTokensFromText,
  withLlmUsageCollector,
} from "@/server/llm/usage";

describe("LlmUsageCollector", () => {
  it("records calls with the current stage label", async () => {
    const collector = new LlmUsageCollector();

    await withLlmUsageCollector(collector, async () => {
      collector.setStage("Stage 2 — Analyst (comparison matrix)");
      collector.record({
        provider: "groq",
        model: "openai/gpt-oss-120b",
        latencyMs: 500,
        promptTokens: 900,
        completionTokens: 220,
        totalTokens: 1120,
        costUsd: 0.0000626,
      });
    });

    expect(collector.calls).toHaveLength(1);
    expect(collector.calls[0]).toMatchObject({
      stage: "Stage 2 — Analyst (comparison matrix)",
      provider: "groq",
      latencyMs: 500,
      totalTokens: 1120,
    });
    expect(collector.totalLatencyMs).toBe(500);
    expect(collector.totalCostUsd).toBeCloseTo(0.0000626, 10);
  });

  it("accumulates totals across multiple calls", async () => {
    const collector = new LlmUsageCollector();
    collector.setStage("Stage 3 — Writer (markdown synthesis)");
    collector.record({
      provider: "groq",
      model: "openai/gpt-oss-120b",
      latencyMs: 300,
      promptTokens: 700,
      completionTokens: 480,
      totalTokens: 1180,
      costUsd: 0.0000734,
    });
    collector.record({
      provider: "groq",
      model: "openai/gpt-oss-120b",
      latencyMs: 200,
      promptTokens: 300,
      completionTokens: 100,
      totalTokens: 400,
      costUsd: 0.000023,
    });
    expect(collector.calls).toHaveLength(2);
    expect(collector.totalLatencyMs).toBe(500);
    expect(collector.totalCostUsd).toBeCloseTo(0.0000964, 10);
  });

  it("stage label is a no-op default outside a stage", () => {
    const collector = new LlmUsageCollector();
    collector.record({
      provider: "groq",
      model: "openai/gpt-oss-120b",
      latencyMs: 1,
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      costUsd: 0,
    });
    expect(collector.calls[0]?.stage).toBe("Unattributed");
  });

  it("withLlmUsageCollector returns the wrapped value and clears context after", async () => {
    const collector = new LlmUsageCollector();
    const result = await withLlmUsageCollector(collector, async () => 42);
    expect(result).toBe(42);
  });
});

describe("estimateLlmCostUsd", () => {
  it("prices Groq GPT OSS 120B at $0.15/M in and $0.60/M out", () => {
    // 1000 prompt tokens * 0.15/1M + 1000 completion * 0.60/1M
    expect(estimateLlmCostUsd("groq", "openai/gpt-oss-120b", 1000, 1000)).toBeCloseTo(0.00075, 10);
  });

  it("uses the default groq price for unknown models", () => {
    expect(estimateLlmCostUsd("groq", "some-future-model", 1_000_000, 1_000_000)).toBeCloseTo(
      0.75,
      10,
    );
  });

  it("prices HuggingFace calls at $0 (no list price)", () => {
    expect(estimateLlmCostUsd("huggingface", "meta-llama/Llama-3.1-8B-Instruct", 5000, 5000)).toBe(
      0,
    );
  });
});

describe("estimateTokensFromText", () => {
  it("estimates ~4 chars per token with a minimum of 1", () => {
    expect(estimateTokensFromText("hello world this is a test")).toBe(Math.ceil(27 / 4));
    expect(estimateTokensFromText("")).toBe(1);
  });
});

describe("aggregateAgentCosts", () => {
  it("groups per-call telemetry into per-agent totals by stage label", () => {
    const calls = [
      {
        stage: "Stage 2 — Analyst (comparison matrix)",
        provider: "groq" as const,
        model: "openai/gpt-oss-120b",
        latencyMs: 500,
        promptTokens: 900,
        completionTokens: 220,
        totalTokens: 1120,
        costUsd: 0.0000626,
      },
      {
        stage: "Stage 2 — Analyst (comparison matrix)",
        provider: "groq" as const,
        model: "openai/gpt-oss-120b",
        latencyMs: 100,
        promptTokens: 100,
        completionTokens: 80,
        totalTokens: 180,
        costUsd: 0.00001,
      },
      {
        stage: "Stage 3 — Writer (markdown synthesis)",
        provider: "groq" as const,
        model: "openai/gpt-oss-120b",
        latencyMs: 300,
        promptTokens: 700,
        completionTokens: 480,
        totalTokens: 1180,
        costUsd: 0.0000734,
      },
    ];

    const result = aggregateAgentCosts(calls);
    expect(result).toHaveLength(2);

    const analyst = result.find((c) => c.agent === "analyst");
    expect(analyst).toMatchObject({
      agent: "analyst",
      callCount: 2,
      promptTokens: 1000,
      completionTokens: 300,
      totalTokens: 1300,
      latencyMs: 600,
      costUsd: 0.0000726,
    });

    const writer = result.find((c) => c.agent === "writer");
    expect(writer).toMatchObject({
      agent: "writer",
      callCount: 1,
      promptTokens: 700,
      completionTokens: 480,
      totalTokens: 1180,
    });
  });

  it("returns agents in research → analyst → writer order", () => {
    const calls = [
      {
        stage: "Stage 2 — Analyst (comparison matrix)",
        provider: "groq" as const,
        model: "m",
        latencyMs: 1,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        costUsd: 0,
      },
      {
        stage: "Stage 1 — Research agent (ReAct)",
        provider: "groq" as const,
        model: "m",
        latencyMs: 1,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        costUsd: 0,
      },
      {
        stage: "Stage 3 — Writer (markdown synthesis)",
        provider: "groq" as const,
        model: "m",
        latencyMs: 1,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        costUsd: 0,
      },
    ];
    expect(aggregateAgentCosts(calls).map((c) => c.agent)).toEqual([
      "research",
      "analyst",
      "writer",
    ]);
  });

  it("skips unattributed calls and returns an empty array when none match", () => {
    const calls = [
      {
        stage: "Unattributed",
        provider: "groq" as const,
        model: "m",
        latencyMs: 1,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        costUsd: 0,
      },
    ];
    expect(aggregateAgentCosts(calls)).toEqual([]);
  });
});
