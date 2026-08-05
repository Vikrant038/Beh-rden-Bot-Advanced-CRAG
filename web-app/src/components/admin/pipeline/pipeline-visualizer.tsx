"use client";

import { useMemo } from "react";
import { FileSearch, ShieldCheck, ShieldX, Table2, TerminalSquare } from "lucide-react";
import type { AgenticRagResponse } from "@/server/rag/agents/orchestrator";
import { Markdown } from "@/components/chat/markdown";
import { StageNode, type StageStatus } from "@/components/admin/pipeline/stage-node";
import { ReactStep } from "@/components/admin/pipeline/react-step";
import { SourcePanel } from "@/components/admin/pipeline/source-panel";
import { LlmCostPanel } from "@/components/admin/pipeline/llm-cost-panel";
import { formatUsd } from "@/lib/utils";

interface PipelineVisualizerProps {
  trace: AgenticRagResponse;
}

export function PipelineVisualizer({ trace }: PipelineVisualizerProps) {
  const guardrailBlocked = !trace.guardrail.passed;
  const cacheHit = trace.researchSteps[0]?.action === "Semantic Cache Hit";

  const stages = useMemo(() => {
    // Fall back to the total for traces stored before per-stage timings existed.
    const stageDuration = (index: number): number =>
      trace.stages?.[index]?.durationMs ?? Math.max(0, trace.totalLatencyMs);
    const stages: Array<{
      title: string;
      status: StageStatus;
      durationMs: number;
      body: React.ReactNode;
    }> = [
      {
        title: "Stage 0 — Query disambiguation & guardrail",
        status: guardrailBlocked ? "warning" : "done",
        durationMs: stageDuration(0),
        body: (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-xs">
              <ShieldCheck className="h-4 w-4 shrink-0 text-accent" />
              <span className="text-muted">Masked query:</span>
              <code className="min-w-0 flex-1 truncate rounded bg-surface-hover px-1.5 py-0.5 text-foreground">
                {trace.maskedQuery}
              </code>
            </div>
            <div
              className={
                guardrailBlocked
                  ? "flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
                  : "flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs"
              }
            >
              {guardrailBlocked ? (
                <ShieldX className="h-4 w-4 shrink-0 text-warning" />
              ) : (
                <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
              )}
              <span className="font-medium text-foreground">
                Guardrail: {guardrailBlocked ? "BLOCKED" : "PASSED"}
              </span>
              {trace.guardrail.reason ? (
                <span className="text-muted">— {trace.guardrail.reason}</span>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        title: "Stage 1 — Research agent (ReAct)",
        status: guardrailBlocked ? "skipped" : trace.sources.length > 0 ? "done" : "warning",
        durationMs: stageDuration(1),
        body: (
          <div className="space-y-2">
            <div className="space-y-2">
              {trace.researchSteps.map((step, index) => (
                <ReactStep key={`${step.iteration}-${index}`} step={step} />
              ))}
            </div>
            <div className="flex items-center gap-1.5 px-1 pt-1 text-xs font-medium text-muted">
              <FileSearch className="h-3.5 w-3.5" />
              Sources ({trace.sources.length}) — child snippet → expanded parent
            </div>
            {trace.sources.length > 0 ? (
              <div className="space-y-1.5">
                {trace.sources.map((source, index) => (
                  <SourcePanel key={`${source.url}-${index}`} source={source} index={index} />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-glass-border bg-surface/60 px-3 py-2 text-xs text-muted">
                No local chunks passed the CRAG threshold — the research agent fell back to web
                search.
              </p>
            )}
          </div>
        ),
      },
      {
        title: "Stage 2 — Analyst (comparison matrix)",
        status: guardrailBlocked ? "skipped" : "done",
        durationMs: stageDuration(2),
        body: (
          <div className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-xs">
              <Table2 className="h-4 w-4 shrink-0 text-accent" />
              <span className="font-medium text-foreground">{trace.analysisMatrix.summary}</span>
            </div>
            {trace.analysisMatrix.structured_table ? (
              <div className="markdown-body overflow-x-auto rounded-lg border border-glass-border bg-surface/60 px-3 py-2">
                <Markdown content={trace.analysisMatrix.structured_table} />
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {trace.analysisMatrix.key_insights.length > 0 ? (
                <div className="rounded-lg border border-glass-border bg-surface/60 p-2">
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted">
                    Key insights
                  </p>
                  <ul className="space-y-1 text-xs text-foreground/80">
                    {trace.analysisMatrix.key_insights.map((insight) => (
                      <li key={insight}>• {insight}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {trace.analysisMatrix.verified_facts.length > 0 ? (
                <div className="rounded-lg border border-glass-border bg-surface/60 p-2">
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted">
                    Verified facts
                  </p>
                  <ul className="space-y-1 text-xs text-foreground/80">
                    {trace.analysisMatrix.verified_facts.map((fact) => (
                      <li key={fact}>• {fact}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        title: "Stage 3 — Writer (markdown synthesis)",
        status: guardrailBlocked ? "skipped" : "done",
        durationMs: stageDuration(3),
        body: (
          <div className="rounded-lg border border-glass-border bg-surface/60 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
              <TerminalSquare className="h-3.5 w-3.5" />
              Final answer
            </div>
            <div className="markdown-body">
              <Markdown content={trace.finalAnswer} />
            </div>
          </div>
        ),
      },
    ];

    if (guardrailBlocked) {
      stages[1].body = (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 px-1 pt-1 text-xs font-medium text-muted">
            <FileSearch className="h-3.5 w-3.5" />
            Sources ({trace.sources.length}) — child snippet → expanded parent
          </div>
          <p className="rounded-lg border border-glass-border bg-surface/60 px-3 py-2 text-xs text-muted">
            Pipeline short-circuited — downstream agents never ran.
          </p>
        </div>
      );
      stages[2].body = null;
      stages[3].body = null;
    }

    return stages;
  }, [trace, guardrailBlocked]);

  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-glass-border pb-3">
        <p className="text-sm font-semibold text-foreground">Pipeline trace</p>
        <span className="font-mono text-xs text-muted">{trace.totalLatencyMs}ms total</span>
        <span className="font-mono text-xs text-muted">≈ {formatUsd(trace.totalCostUsd ?? 0)}</span>
        <span className="font-mono text-xs text-muted">{trace.sources.length} sources</span>
        {cacheHit ? (
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
            cache hit
          </span>
        ) : null}
        {guardrailBlocked ? (
          <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
            out of domain
          </span>
        ) : null}
      </div>

      <LlmCostPanel calls={trace.llmCalls ?? []} totalCostUsd={trace.totalCostUsd ?? 0} />

      <ol className="divide-y divide-glass-border">
        {stages.map((stage, index) => (
          <StageNode
            key={stage.title}
            index={index}
            title={stage.title}
            status={stage.status}
            durationMs={stage.durationMs}
          >
            {stage.body}
          </StageNode>
        ))}
      </ol>
    </div>
  );
}
