"use client";

import { useMemo } from "react";
import {
  FileSearch,
  Fingerprint,
  ShieldCheck,
  ShieldX,
  Table2,
  TerminalSquare,
  Timer,
  Zap,
} from "lucide-react";
import type { AgenticRagResponse } from "@/server/rag/agents/orchestrator";
import type { StandardRagTrace } from "@/server/rag/pipeline";
import type { AgentCostTelemetry, Source } from "@/server/rag/types";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/chat/markdown";
import { StageNode, type StageStatus } from "@/components/admin/pipeline/stage-node";
import { ReactStep } from "@/components/admin/pipeline/react-step";
import { SourcePanel } from "@/components/admin/pipeline/source-panel";
import { LlmCostPanel } from "@/components/admin/pipeline/llm-cost-panel";
import { formatUsd } from "@/lib/utils";

type Retrieval = NonNullable<StandardRagTrace["retrievalTelemetry"]>;
type PreProcessing = NonNullable<StandardRagTrace["preProcessing"]>;
type PostProcessing = NonNullable<StandardRagTrace["postProcessing"]>;
type Disambiguation = NonNullable<StandardRagTrace["disambiguation"]>;
type Guardrail = StandardRagTrace["guardrail"];

interface Stage {
  title: string;
  status: StageStatus;
  durationMs: number | undefined;
  body: React.ReactNode;
}

/** `1234ms`, or an em-dash when the measurement is missing. */
function ms(value?: number | null): string {
  return value === undefined || value === null ? "—" : `${Math.round(value)}ms`;
}

/** One `label … value … duration` row inside a stage body. */
function TraceRow({
  icon,
  label,
  children,
  pill,
  right,
}: {
  icon: React.ReactNode;
  label: string;
  children?: React.ReactNode;
  /** Renders a HIT/MISS-style pill instead of a plain value. */
  pill?: { text: string; on: boolean };
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-accent">{icon}</span>
        <span className="text-muted">{label}</span>
        {pill ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-mono text-[10px] font-medium",
              pill.on ? "bg-success/10 text-success" : "bg-surface-hover text-muted",
            )}
          >
            {pill.text}
          </span>
        ) : (
          <span className="font-medium text-foreground">{children}</span>
        )}
      </div>
      <span className="font-mono text-[10px] text-muted">{right}</span>
    </div>
  );
}

function MetricTile({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-glass-border bg-surface p-3">
      <span className="mb-1 block text-xs font-medium text-foreground">{title}</span>
      <span className="font-mono text-xs text-muted">{value}</span>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md bg-surface-hover px-2 py-1 font-mono text-[10px] text-muted">
      {children}
    </span>
  );
}

function preProcessingBody(maskedQuery: string, cacheHit: boolean, pre?: PreProcessing) {
  return (
    <div className="space-y-2">
      <TraceRow
        icon={<Fingerprint className="h-4 w-4" />}
        label="PII redaction:"
        right={ms(pre?.piiMaskingDurationMs)}
      >
        {maskedQuery}
      </TraceRow>
      <TraceRow
        icon={<Zap className="h-4 w-4" />}
        label="Semantic cache lookup:"
        pill={{ text: cacheHit ? "HIT" : "MISS", on: cacheHit }}
        right={ms(pre?.cacheLookupDurationMs)}
      />
    </div>
  );
}

function disambiguationBody(disambiguation?: Disambiguation) {
  return (
    <TraceRow
      icon={<ShieldCheck className="h-4 w-4" />}
      label="Disambiguation check:"
      right={ms(disambiguation?.durationMs)}
    >
      {disambiguation?.isAmbiguous ? "AMBIGUOUS" : "CLEAR"}
    </TraceRow>
  );
}

function guardrailBody(guardrail: Guardrail, fallbackMs: number) {
  const blocked = !guardrail.passed;
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-lg border px-3 py-2 text-xs",
        blocked ? "border-warning/40 bg-warning/10" : "border-success/40 bg-success/10",
      )}
    >
      <div className="flex items-center gap-2">
        {blocked ? (
          <ShieldX className="h-4 w-4 shrink-0 text-warning" />
        ) : (
          <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
        )}
        <span className="font-medium text-foreground">
          Guardrail: {blocked ? "BLOCKED" : "PASSED"}
        </span>
        {guardrail.reason ? <span className="text-muted">— {guardrail.reason}</span> : null}
      </div>
      <span className="font-mono text-[10px] text-muted">
        {ms(guardrail.durationMs ?? fallbackMs)}
      </span>
    </div>
  );
}

const retrievalMs = (telemetry?: Retrieval): number | undefined =>
  telemetry
    ? Math.round(
        telemetry.queryExpansionDurationMs +
          telemetry.denseDurationMs +
          telemetry.sparseBm25DurationMs +
          telemetry.rrfFusionDurationMs +
          telemetry.rerankDurationMs,
      )
    : undefined;

/** Expansion queries + dense/sparse tiles + fusion chips — identical for both pipelines. */
function retrievalBody(telemetry?: Retrieval) {
  if (!telemetry) {
    return (
      <p className="rounded-lg border border-glass-border bg-surface/60 px-3 py-2 text-xs text-muted">
        Retrieval telemetry not available for this run.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-glass-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">Query Expansion</span>
          <span className="font-mono text-[10px] text-muted">
            {Math.round(telemetry.queryExpansionDurationMs)}ms
          </span>
        </div>
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
          {telemetry.expandedQueries.map((q, i) => (
            <li key={i} className="break-all">
              {q}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <MetricTile title="Dense Search (pgvector)" value={ms(telemetry.denseDurationMs)} />
        <MetricTile title="Sparse Search (BM25)" value={ms(telemetry.sparseBm25DurationMs)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Chip>{`RRF Fusion: ${Math.round(telemetry.rrfFusionDurationMs)}ms`}</Chip>
        <Chip>{`Cross-Encoder: ${Math.round(telemetry.rerankDurationMs)}ms`}</Chip>
        <Chip>{`Sparse engine: ${telemetry.sparseEngine}`}</Chip>
        <span
          className={cn(
            "rounded-md px-2 py-1 font-mono text-[10px] font-medium",
            telemetry.cragFallbackTriggered
              ? "bg-warning/10 text-warning"
              : "bg-success/10 text-success",
          )}
        >
          {`Score: ${telemetry.bestCrossScore.toFixed(2)} — ${
            telemetry.cragFallbackTriggered ? "FAIL (CRAG Fallback)" : "PASS"
          }`}
        </span>
      </div>
    </div>
  );
}

function postProcessingBody(post?: PostProcessing) {
  return (
    <div className="space-y-2">
      <TraceRow
        icon={<Zap className="h-4 w-4" />}
        label="Semantic cache write:"
        pill={{ text: post?.cacheWritten ? "WRITTEN" : "SKIPPED", on: Boolean(post?.cacheWritten) }}
        right={ms(post?.cacheWriteDurationMs)}
      />
      <TraceRow
        icon={<Timer className="h-4 w-4" />}
        label="Memory append:"
        right={ms(post?.memoryWriteDurationMs)}
      />
    </div>
  );
}

function finalAnswerBody(answer: string) {
  return (
    <div className="rounded-lg border border-glass-border bg-surface/60 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
        <TerminalSquare className="h-3.5 w-3.5" />
        Final answer
      </div>
      <div className="markdown-body">
        <Markdown content={answer} />
      </div>
    </div>
  );
}

function sourcesHeader(count: number) {
  return (
    <div className="flex items-center gap-1.5 px-1 pt-2 text-xs font-medium text-muted">
      <FileSearch className="h-3.5 w-3.5" />
      {`Sources (${count}) — child snippet → expanded parent`}
    </div>
  );
}

function sourcesBody(sources: Source[], emptyNotice: string) {
  return sources.length > 0 ? (
    <div className="space-y-1.5">
      {sources.map((source, index) => (
        <SourcePanel key={`${source.url}-${index}`} source={source} index={index} />
      ))}
    </div>
  ) : (
    <p className="rounded-lg border border-glass-border bg-surface/60 px-3 py-2 text-xs text-muted">
      {emptyNotice}
    </p>
  );
}

function TraceHeader({
  trace,
  badge,
  cacheHit,
  guardrailBlocked,
}: {
  trace: AgenticRagResponse | StandardRagTrace;
  badge?: React.ReactNode;
  cacheHit: boolean;
  guardrailBlocked: boolean;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-glass-border pb-3">
      <p className="text-sm font-semibold text-foreground">Pipeline trace</p>
      {badge}
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
  );
}

function StageList({ stages }: { stages: Stage[] }) {
  return (
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
  );
}

function AgentCostBadge({ cost }: { cost: AgentCostTelemetry }) {
  const label =
    cost.agent === "research" ? "Research" : cost.agent === "analyst" ? "Analyst" : "Writer";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-glass-border bg-surface px-3 py-2 text-xs">
      <span className="font-medium text-foreground">{label}</span>
      <span className="font-mono text-[10px] text-muted">
        {cost.callCount} call{cost.callCount === 1 ? "" : "s"}
      </span>
      <span className="font-mono text-[10px] text-muted">
        {cost.promptTokens} in · {cost.completionTokens} out
      </span>
      <span className="font-mono text-[10px] text-muted">{cost.latencyMs}ms</span>
      <span className="ml-auto font-mono text-[10px] text-foreground">
        ≈ {formatUsd(cost.costUsd)}
      </span>
    </div>
  );
}

function isStandardTrace(trace: AgenticRagResponse | StandardRagTrace): trace is StandardRagTrace {
  return (trace as StandardRagTrace).pipeline === "standard";
}

export function PipelineVisualizer({ trace }: { trace: AgenticRagResponse | StandardRagTrace }) {
  if (isStandardTrace(trace)) {
    return <StandardCragVisualizer trace={trace} />;
  }
  return <AgenticVisualizer trace={trace} />;
}

function AgenticVisualizer({ trace }: { trace: AgenticRagResponse }) {
  const guardrailBlocked = !trace.guardrail.passed;
  const cacheHit = trace.researchSteps[0]?.action === "Semantic Cache Hit";

  const stages = useMemo<Stage[]>(() => {
    // Fall back to the total for traces stored before per-stage timings existed.
    const stageDuration = (index: number): number =>
      trace.stages?.[index]?.durationMs ?? Math.max(0, trace.totalLatencyMs);
    const stages: Stage[] = [
      {
        title: "Pre-Processing — PII Masking & Cache Lookup",
        status: "done",
        durationMs: trace.preProcessing
          ? Math.round(
              (trace.preProcessing.piiMaskingDurationMs ?? 0) +
                (trace.preProcessing.cacheLookupDurationMs ?? 0),
            )
          : undefined,
        body: preProcessingBody(trace.maskedQuery, cacheHit, trace.preProcessing),
      },
      {
        title: "Stage 0A — Query Disambiguation",
        status: guardrailBlocked ? "skipped" : "done",
        durationMs: trace.disambiguation?.durationMs ?? undefined,
        body: disambiguationBody(trace.disambiguation),
      },
      {
        title: "Stage 0B — Domain Guardrail",
        status: guardrailBlocked ? "warning" : "done",
        durationMs: trace.guardrail.durationMs ?? stageDuration(0),
        body: guardrailBody(trace.guardrail, stageDuration(0)),
      },
      {
        title: "Stage 1A/B/C/D — Query Expansion & Hybrid Retrieval",
        status: guardrailBlocked ? "skipped" : trace.sources.length > 0 ? "done" : "warning",
        durationMs: retrievalMs(trace.retrievalTelemetry),
        body: retrievalBody(trace.retrievalTelemetry),
      },
      {
        title: "Stage 1E — Research Agent & Tool Calls",
        status: guardrailBlocked ? "skipped" : trace.sources.length > 0 ? "done" : "warning",
        durationMs: stageDuration(1),
        body: (
          <div className="space-y-3">
            {trace.toolCalls && trace.toolCalls.length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted">Tool Calls</span>
                <div className="space-y-1">
                  {trace.toolCalls.map((call, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between rounded-lg border border-glass-border bg-surface px-3 py-2 text-xs"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="shrink-0 font-mono font-medium text-accent">
                          {call.tool}
                        </span>
                        {call.query && (
                          <span className="min-w-0 max-w-full truncate text-muted sm:max-w-xs">
                            {call.query}
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-[10px] text-muted">
                        {Math.round(call.durationMs)}ms
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <span className="text-xs font-medium text-muted">ReAct Steps</span>
              {trace.researchSteps.map((step, index) => (
                <ReactStep key={`${step.iteration}-${index}`} step={step} />
              ))}
            </div>

            {sourcesHeader(trace.sources.length)}
            {sourcesBody(
              trace.sources,
              "No local chunks passed the CRAG threshold — the research agent fell back to web search.",
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
            {trace.agentCosts
              ?.filter((cost) => cost.agent === "analyst")
              .map((cost) => (
                <AgentCostBadge key={cost.agent} cost={cost} />
              ))}
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
          <div className="space-y-2">
            {trace.agentCosts
              ?.filter((cost) => cost.agent === "writer")
              .map((cost) => (
                <AgentCostBadge key={cost.agent} cost={cost} />
              ))}
            {finalAnswerBody(trace.finalAnswer)}
          </div>
        ),
      },
      {
        title: "Post-Processing — Cache Write & Memory",
        status: guardrailBlocked || cacheHit ? "skipped" : "done",
        durationMs: trace.postProcessing
          ? Math.round(
              (trace.postProcessing.cacheWriteDurationMs ?? 0) +
                (trace.postProcessing.memoryWriteDurationMs ?? 0),
            )
          : undefined,
        body: postProcessingBody(trace.postProcessing),
      },
    ];

    if (guardrailBlocked) {
      stages[3].body = (
        <div className="space-y-2">
          {sourcesHeader(trace.sources.length)}
          <p className="rounded-lg border border-glass-border bg-surface/60 px-3 py-2 text-xs text-muted">
            Pipeline short-circuited — downstream agents never ran.
          </p>
        </div>
      );
      stages[4].body = null;
      stages[5].body = null;
      stages[6].body = null;
    }

    return stages;
  }, [trace, guardrailBlocked, cacheHit]);

  return (
    <div className="glass-card rounded-2xl p-4">
      <TraceHeader trace={trace} cacheHit={cacheHit} guardrailBlocked={guardrailBlocked} />

      <LlmCostPanel calls={trace.llmCalls ?? []} totalCostUsd={trace.totalCostUsd ?? 0} />

      <StageList stages={stages} />
    </div>
  );
}

/**
 * Stage-by-stage view for a standard CRAG trace (single-shot corrected RAG:
 * cache check → sub-query expansion + hybrid retrieval → CRAG gate → grounded
 * generation → persist). Rendered when the stored trace is `pipeline: "standard"`.
 */
function StandardCragVisualizer({ trace }: { trace: StandardRagTrace }) {
  const guardrailBlocked = !trace.guardrail.passed;
  const cacheHit = trace.isCached;
  // Fall back to the total for traces stored without per-stage timings.
  const stageDuration = (index: number): number =>
    trace.stages?.[index]?.durationMs ?? Math.max(0, trace.totalLatencyMs);

  const stages: Stage[] = [
    {
      title: "Pre-Processing — PII Masking & Cache Lookup",
      status: "done",
      durationMs: trace.preProcessing
        ? Math.round(
            (trace.preProcessing.piiMaskingDurationMs ?? 0) +
              (trace.preProcessing.cacheLookupDurationMs ?? 0),
          )
        : undefined,
      body: preProcessingBody(trace.maskedQuery, cacheHit, trace.preProcessing),
    },
    {
      title: "Stage 0 — Query Disambiguation",
      status: "done",
      durationMs: trace.disambiguation?.durationMs ?? undefined,
      body: disambiguationBody(trace.disambiguation),
    },
    {
      title: "Stage 0B — Domain Guardrail",
      status: guardrailBlocked ? "warning" : "done",
      durationMs: trace.guardrail.durationMs ?? stageDuration(0),
      body: guardrailBody(trace.guardrail, stageDuration(0)),
    },
    {
      title: "Stage 1 — Sub-Query Expansion & Hybrid Retrieval",
      status:
        guardrailBlocked || cacheHit ? "skipped" : trace.sources.length > 0 ? "done" : "warning",
      durationMs: retrievalMs(trace.retrievalTelemetry),
      body: retrievalBody(trace.retrievalTelemetry),
    },
    {
      title: "Stage 2 — CRAG Gate (relevance grading)",
      status: guardrailBlocked || cacheHit ? "skipped" : trace.isGrounded ? "done" : "warning",
      durationMs: stageDuration(2),
      body: (
        <div className="space-y-2">
          <div
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs ${
              trace.isGrounded
                ? "border-success/40 bg-success/10"
                : "border-warning/40 bg-warning/10"
            }`}
          >
            <span className="font-medium text-foreground">
              Grounded answer: {trace.isGrounded ? "YES" : "NO"}
            </span>
            <span className="font-mono text-[10px] text-muted">{trace.retrievalPath}</span>
          </div>
          {sourcesHeader(trace.sources.length)}
          {sourcesBody(
            trace.sources,
            "No local chunks passed the CRAG threshold — the answer was not grounded.",
          )}
        </div>
      ),
    },
    {
      title: "Stage 3 — Grounded Generation (LLM)",
      status: guardrailBlocked || cacheHit ? "skipped" : "done",
      durationMs: stageDuration(3),
      body: finalAnswerBody(trace.finalAnswer),
    },
    {
      title: "Post-Processing — Cache Write & Memory",
      status: guardrailBlocked ? "skipped" : "done",
      durationMs: trace.postProcessing
        ? Math.round(
            (trace.postProcessing.cacheWriteDurationMs ?? 0) +
              (trace.postProcessing.memoryWriteDurationMs ?? 0),
          )
        : undefined,
      body: postProcessingBody(trace.postProcessing),
    },
  ];

  if (guardrailBlocked) {
    stages[4].body = null;
    stages[5].body = null;
    stages[6].body = null;
  } else if (cacheHit) {
    // Cache short-circuit: retrieval/gate/generation never ran, but the memory
    // append (post-processing) did.
    stages[4].body = null;
    stages[5].body = null;
  }

  return (
    <div className="glass-card rounded-2xl p-4">
      <TraceHeader
        trace={trace}
        badge={
          <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-medium text-muted">
            standard CRAG
          </span>
        }
        cacheHit={cacheHit}
        guardrailBlocked={guardrailBlocked}
      />

      <LlmCostPanel calls={trace.llmCalls ?? []} totalCostUsd={trace.totalCostUsd ?? 0} />

      <StageList stages={stages} />
    </div>
  );
}
