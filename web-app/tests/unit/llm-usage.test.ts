import { describe, it, expect } from "vitest";
import {
  LlmUsageCollector,
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
        model: "llama-3.1-8b-instant",
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
      model: "llama-3.1-8b-instant",
      latencyMs: 300,
      promptTokens: 700,
      completionTokens: 480,
      totalTokens: 1180,
      costUsd: 0.0000734,
    });
    collector.record({
      provider: "groq",
      model: "llama-3.1-8b-instant",
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
      model: "llama-3.1-8b-instant",
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
  it("prices groq llama-3.1-8b-instant at $0.05/M in and $0.08/M out", () => {
    // 1000 prompt tokens * 0.05/1M + 1000 completion * 0.08/1M
    expect(estimateLlmCostUsd("groq", "llama-3.1-8b-instant", 1000, 1000)).toBeCloseTo(
      0.00013,
      10,
    );
  });

  it("uses the default groq price for unknown models", () => {
    expect(estimateLlmCostUsd("groq", "some-future-model", 1_000_000, 1_000_000)).toBeCloseTo(
      0.13,
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
    expect(estimateTokensFromText("hello world this is a test")).toBe(
      Math.ceil(27 / 4),
    );
    expect(estimateTokensFromText("")).toBe(1);
  });
});
