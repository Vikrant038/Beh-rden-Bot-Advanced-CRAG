import type { AgentCostTelemetry } from "@/server/rag/types";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-call LLM telemetry for the pipeline tracer (admin pipeline-tester).
 *
 * The collector records one entry per LLM call made while active so the
 * pipeline trace can show *unique* timings for each call plus an estimated
 * cost, instead of reusing the pipeline total for every stage.
 *
 * It is propagated through AsyncLocalStorage (same pattern as `tracing.ts`)
 * so `callLLM` can record into it without threading a collector through every
 * agent signature. When no collector is active the recording is a no-op and
 * the app behaves exactly as before.
 */

export type LlmProvider = "groq" | "huggingface";

export interface LlmCallRecord {
  /** Stage label the call belongs to (e.g. "Stage 2 — Analyst"). */
  stage: string;
  provider: LlmProvider;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface ModelPrice {
  /** USD per 1M input tokens. */
  inputPer1M: number;
  /** USD per 1M output tokens. */
  outputPer1M: number;
}

/**
 * Public list prices (USD per 1M tokens), kept as a small lookup so the trace
 * can surface "≈$0.0004" style estimates per call. HF Inference API has no
 * per-token list price (serverless/free tier), so HF calls are priced at $0
 * and the UI labels them "no list price".
 */
export const GROQ_PRICES: Record<string, ModelPrice> = {
  // https://groq.com/pricing (llama-3.1-8b-instant)
  "llama-3.1-8b-instant": { inputPer1M: 0.05, outputPer1M: 0.08 },
  "llama-3.3-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79 },
  "llama-3.1-70b-versatile": { inputPer1M: 0.59, outputPer1M: 0.79 },
};

const DEFAULT_GROQ_PRICE: ModelPrice = { inputPer1M: 0.05, outputPer1M: 0.08 };
const HF_PRICE: ModelPrice = { inputPer1M: 0, outputPer1M: 0 };

export function estimateLlmCostUsd(
  provider: LlmProvider,
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const price = provider === "groq" ? (GROQ_PRICES[model] ?? DEFAULT_GROQ_PRICE) : HF_PRICE;
  return (
    (promptTokens / 1_000_000) * price.inputPer1M +
    (completionTokens / 1_000_000) * price.outputPer1M
  );
}

/**
 * Fallback token estimation when a provider does not return usage metadata.
 * ~4 chars per token is the standard heuristic.
 */
export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export class LlmUsageCollector {
  readonly calls: LlmCallRecord[] = [];

  private stageLabel = "Unattributed";

  setStage(stage: string): void {
    this.stageLabel = stage;
  }

  get totalCostUsd(): number {
    return this.calls.reduce((sum, call) => sum + call.costUsd, 0);
  }

  get totalLatencyMs(): number {
    return this.calls.reduce((sum, call) => sum + call.latencyMs, 0);
  }

  record(call: Omit<LlmCallRecord, "stage">): void {
    this.calls.push({ ...call, stage: this.stageLabel });
  }
}

/**
 * Aggregates per-call LLM telemetry into per-agent totals for the pipeline
 * trace. Call records are attributed to an agent by their stage label (set via
 * `collector.setStage` in the orchestrator). Unattributed calls are skipped.
 */
export function aggregateAgentCosts(calls: LlmCallRecord[]): AgentCostTelemetry[] {
  const byAgent = new Map<AgentCostTelemetry["agent"], AgentCostTelemetry>();

  for (const call of calls) {
    const agent = agentFromStage(call.stage);
    if (!agent) {
      continue;
    }
    const current = byAgent.get(agent) ?? {
      agent,
      callCount: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      costUsd: 0,
    };
    current.callCount += 1;
    current.promptTokens += call.promptTokens;
    current.completionTokens += call.completionTokens;
    current.totalTokens += call.totalTokens;
    current.latencyMs += call.latencyMs;
    current.costUsd += call.costUsd;
    byAgent.set(agent, current);
  }

  const agents: AgentCostTelemetry["agent"][] = ["research", "analyst", "writer"];
  return agents.filter((agent) => byAgent.has(agent)).map((agent) => byAgent.get(agent)!);
}

/** Maps a stage label to its owning agent, or null for unattributed calls. */
function agentFromStage(stage: string): AgentCostTelemetry["agent"] | null {
  const lower = stage.toLowerCase();
  if (lower.includes("research")) {
    return "research";
  }
  if (lower.includes("analyst")) {
    return "analyst";
  }
  if (lower.includes("writer")) {
    return "writer";
  }
  return null;
}

const collectorStorage = new AsyncLocalStorage<LlmUsageCollector | null>();

/**
 * Runs `fn` with an LLM usage collector active on this async chain. All
 * `callLLM` invocations made inside (including via `callLLMJson`) record into
 * the collector with the stage label set through `collector.setStage()`.
 */
export async function withLlmUsageCollector<T>(
  collector: LlmUsageCollector,
  fn: () => Promise<T>,
): Promise<T> {
  return collectorStorage.run(collector, fn);
}

/** Returns the active collector on this async chain, or null. */
export function getActiveLlmUsageCollector(): LlmUsageCollector | null {
  return collectorStorage.getStore() ?? null;
}
