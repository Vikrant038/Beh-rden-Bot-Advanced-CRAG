"use client";

import { BadgeEuro, Bot, Globe } from "lucide-react";
import type { LlmCallRecord } from "@/server/llm/usage";
import { formatUsd } from "@/lib/utils";

interface LlmCostPanelProps {
  calls: LlmCallRecord[];
  totalCostUsd: number;
}

function providerLabel(provider: LlmCallRecord["provider"]): string {
  return provider === "groq" ? "Groq" : "Hugging Face";
}

/**
 * Per-LLM-call telemetry card for the pipeline tracer: each call shows its own
 * latency, token usage (in/out), and estimated cost, with a summed total.
 */
export function LlmCostPanel({ calls, totalCostUsd }: LlmCostPanelProps) {
  if (calls.length === 0) {
    return (
      <div className="rounded-xl border border-glass-border bg-surface/60 px-3 py-2 text-xs text-muted">
        No LLM calls were made — this trace was served without a model call (e.g. cache hit or
        short-circuit).
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-glass-border bg-surface/60 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Bot className="h-3.5 w-3.5 text-accent" />
          LLM calls &amp; cost
        </p>
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
          {calls.length} call{calls.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 font-mono text-xs text-foreground">
          <BadgeEuro className="h-3.5 w-3.5 text-success" />≈ {formatUsd(totalCostUsd)} total
        </span>
      </div>

      <p className="mb-2 text-[10px] text-muted">
        Latency is wall-clock time per logical call — if a provider retried or the call fell back to
        Hugging Face, it includes that overhead.
      </p>

      <ul className="space-y-1.5">
        {calls.map((call, index) => (
          <li
            key={`${call.stage}-${call.model}-${index}`}
            className="grid gap-x-3 gap-y-1 rounded-lg border border-glass-border bg-surface px-3 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                {call.provider === "groq" ? (
                  <Bot className="h-3 w-3" />
                ) : (
                  <Globe className="h-3 w-3" />
                )}
              </span>
              <span className="font-medium text-foreground">{call.stage}</span>
              <span className="rounded-full bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {providerLabel(call.provider)}
              </span>
              <span className="min-w-0 truncate font-mono text-[10px] text-muted">
                {call.model}
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px] text-muted">
              <span className="inline-flex items-center gap-1">
                <span className="text-foreground">{call.latencyMs}ms</span>
              </span>
              <span className="whitespace-nowrap">
                {call.promptTokens} in · {call.completionTokens} out
              </span>
              <span className="whitespace-nowrap text-foreground">≈ {formatUsd(call.costUsd)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
