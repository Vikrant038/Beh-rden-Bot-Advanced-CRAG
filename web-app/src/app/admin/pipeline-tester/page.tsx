"use client";

import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  FlaskConical,
  GraduationCap,
  History,
  Landmark,
  Play,
  Scale,
  XCircle,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "@/lib/trpc/client";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PipelineVisualizer } from "@/components/admin/pipeline/pipeline-visualizer";
import { useToast } from "@/lib/toast";
import { formatRelativeTime, formatUsd } from "@/lib/utils";
import type { AgenticRagResponse } from "@/server/rag/agents/orchestrator";

/**
 * True when the tRPC error came from a broken HTTP transport rather than the
 * pipeline itself — e.g. `Unexpected token 'A', "An error o"... is not valid
 * JSON` (serverless function killed mid-response → non-JSON body) or a plain
 * network drop. These need a different debugging path than a real pipeline
 * failure.
 */
function isTransportError(message: string): boolean {
  return (
    message.includes("is not valid JSON") ||
    message.includes("Unexpected token") ||
    message.includes("Failed to fetch") ||
    message.includes("Network request failed")
  );
}

/**
 * After this long in RUNNING the background worker has outlived the platform
 * ceiling (Vercel Hobby maxDuration = 300s), so the run will never reach a
 * terminal state on its own. Stop polling and show a warning instead.
 */
const RUN_STALL_MS = 360_000;
const POLL_INTERVAL_MS = 2_000;

const EXAMPLES: Array<{ label: string; prompt: string; icon: LucideIcon }> = [
  {
    label: "Compare study costs",
    prompt: "Compare the cost of studying in Germany vs the Netherlands",
    icon: Scale,
  },
  {
    label: "Student visa documents",
    prompt: "What documents are required for a student visa at a German embassy?",
    icon: GraduationCap,
  },
  {
    label: "APS for Indian students",
    prompt: "Is the APS certificate mandatory for Indian students applying to German universities?",
    icon: Landmark,
  },
];

export default function AdminPipelineTesterPage() {
  const { toast } = useToast();
  const utils = api.useUtils();
  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [bypassCache, setBypassCache] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  // A stored trace being inspected from the recent-runs list. When null the
  // visualizer shows the freshest completed run (activeRun.data.traceJson).
  const [selectedTrace, setSelectedTrace] = useState<AgenticRagResponse | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  // Id of the background run created by `testPipeline`. The client polls
  // `getTestRun` until the row reaches a terminal state (SUCCESS/FAILED).
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const testPipeline = api.admin.testPipeline.useMutation({
    retry: false,
    onSuccess: (data) => {
      setActiveRunId(data.runId);
      setSelectedRunId(null);
      setSelectedTrace(null);
      void utils.admin.listTestRuns.invalidate();
    },
  });

  const recentRuns = api.admin.listTestRuns.useQuery({ limit: 10 });
  const selectedRun = api.admin.getTestRun.useQuery(
    { id: selectedRunId ?? "" },
    { enabled: Boolean(selectedRunId) },
  );
  const activeRun = api.admin.getTestRun.useQuery(
    { id: activeRunId ?? "" },
    {
      enabled: Boolean(activeRunId),
      refetchInterval: (query) => {
        const data = query.state.data;
        if (!data || data.status !== "RUNNING") {
          return false;
        }
        const ageMs = Date.now() - new Date(data.createdAt).getTime();
        return ageMs > RUN_STALL_MS ? false : POLL_INTERVAL_MS;
      },
    },
  );

  useEffect(() => {
    if (selectedRun.data) {
      setSelectedTrace(selectedRun.data.traceJson as AgenticRagResponse);
    }
  }, [selectedRun.data]);

  const runStatus = activeRun.data?.status;
  const isRunning = runStatus === "RUNNING";
  const runStalled =
    isRunning &&
    activeRun.data !== undefined &&
    Date.now() - new Date(activeRun.data.createdAt).getTime() > RUN_STALL_MS;
  const runError = runStatus === "FAILED" ? (activeRun.data?.error ?? null) : null;
  const freshTrace =
    runStatus === "SUCCESS"
      ? (activeRun.data?.traceJson as AgenticRagResponse | undefined)
      : undefined;

  const run = () => {
    const trimmed = prompt.trim();
    if (!trimmed || testPipeline.isPending || isRunning) {
      return;
    }
    testPipeline.mutate({ prompt: trimmed, bypassCache, debug: debugMode });
  };

  const copyTrace = async () => {
    const trace = selectedTrace ?? freshTrace ?? null;
    if (!trace) {
      return;
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast({ title: "Trace copied to clipboard", variant: "success" });
    } catch {
      toast({ title: "Could not copy the trace", variant: "error" });
    }
  };

  const loadRun = (id: string) => {
    setSelectedRunId(id);
    // Clear the fresh trace immediately so the visualizer doesn't flicker
    // between the old run and the stored one.
    testPipeline.reset();
    setActiveRunId(null);
  };

  const displayedTrace = selectedTrace ?? freshTrace ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pipeline tester</h1>
        <p className="mt-1 text-sm text-muted">
          Run a single glass-box trace through the 3-agent ReAct pipeline and inspect every stage —
          including parent-child chunk expansion. Every run is stored so past traces can be
          revisited.
        </p>
      </div>

      <div className="glass-card rounded-2xl p-5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                run();
              }
            }}
            placeholder="e.g. What is the APS certificate and who needs it?"
            aria-label="Test pipeline query"
            className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none transition placeholder:text-muted focus:border-primary focus-visible:ring-2 focus-visible:ring-primary"
          />
          <button
            type="button"
            onClick={run}
            disabled={testPipeline.isPending || isRunning || !prompt.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
          >
            <Play
              className={`h-4 w-4 ${testPipeline.isPending || isRunning ? "animate-pulse" : ""}`}
            />
            {testPipeline.isPending || isRunning ? "Running…" : "Run trace"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example.label}
              type="button"
              onClick={() => {
                setPrompt(example.prompt);
                testPipeline.reset();
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted transition hover:border-primary/60 hover:text-foreground"
            >
              <example.icon className="h-3 w-3" />
              {example.label}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={debugMode}
                aria-label="Toggle developer mode"
                onClick={() => setDebugMode((v) => !v)}
                className={`relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-primary ${
                  debugMode ? "border-primary/50 bg-primary/15" : "border-border bg-surface-hover"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-foreground transition-transform ${
                    debugMode ? "translate-x-5" : "translate-x-1"
                  }`}
                />
              </button>
              <span
                className={`inline-flex items-center gap-1 text-xs ${debugMode ? "text-primary" : "text-muted"}`}
              >
                <FlaskConical className="h-3.5 w-3.5" />
                Developer mode
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={bypassCache}
                aria-label="Toggle cache bypass"
                onClick={() => setBypassCache((v) => !v)}
                className={`relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-primary ${
                  bypassCache ? "border-primary/50 bg-primary/15" : "border-border bg-surface-hover"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-foreground transition-transform ${
                    bypassCache ? "translate-x-5" : "translate-x-1"
                  }`}
                />
              </button>
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <Zap className={`h-3.5 w-3.5 ${bypassCache ? "text-warning" : ""}`} />
                Bypass cache
              </span>
            </div>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted">
          Queries run with PII masking, no conversation memory, and
          {bypassCache ? " bypass" : " use"} the semantic cache so every stage executes live.
          {debugMode
            ? " Developer mode surfaces full error details (stack + cause) on failure."
            : ""}
        </p>
      </div>

      {testPipeline.isPending || isRunning ? (
        <div className="glass-card flex items-center gap-3 rounded-2xl p-4">
          <span className="status-pulse h-2.5 w-2.5 rounded-full bg-primary" />
          <p className="text-sm text-muted">
            Running research → analyst → writer (3–5 sequential LLM calls)…
          </p>
          {runStalled ? (
            <span className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-1 text-xs text-warning">
              Run has been in progress over 6 minutes — the background worker may have been killed.
              Check Recent traces and retry.
            </span>
          ) : null}
        </div>
      ) : null}

      {testPipeline.isError ? (
        debugMode ? (
          <div className="glass-card space-y-3 rounded-2xl border-destructive/40 p-5">
            <p className="font-mono text-xs uppercase tracking-wide text-destructive">
              Pipeline error — developer mode
            </p>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-4 font-mono text-xs leading-relaxed text-foreground">
              {testPipeline.error.message}
            </pre>
            {isTransportError(testPipeline.error.message) ? (
              <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                This is a transport or queuing failure: the run request itself is meant to return in
                ~100ms (the pipeline executes in the background), so this error means the run could
                not be queued — likely a network drop or a database error. Check Recent traces
                below, then retry.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">
                Full error detail (name, message, cause, stack) — admin only. Copy it into the
                trace-persistence bug report if the pipeline keeps failing.
              </p>
              <button
                type="button"
                onClick={run}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-sm transition hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary"
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <ErrorState
            message={testPipeline.error.message}
            code={testPipeline.error.data?.code}
            retry={run}
          />
        )
      ) : runError ? (
        debugMode ? (
          <div className="glass-card space-y-3 rounded-2xl border-destructive/40 p-5">
            <p className="font-mono text-xs uppercase tracking-wide text-destructive">
              Pipeline error — developer mode
            </p>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-4 font-mono text-xs leading-relaxed text-foreground">
              {runError}
            </pre>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">
                Full error detail (name, message, cause, stack) recorded on the run — admin only.
                Copy it into the trace-persistence bug report if the pipeline keeps failing.
              </p>
              <button
                type="button"
                onClick={run}
                className="rounded-lg border border-border bg-surface px-4 py-2 text-sm transition hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary"
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <ErrorState message={runError} retry={run} />
        )
      ) : null}

      {displayedTrace ? (
        <div className="space-y-4">
          <div className="glass-card flex flex-wrap items-center gap-3 rounded-2xl p-4">
            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              {selectedRunId ? "Stored trace" : `Query: ${prompt}`}
            </p>
            {selectedRunId ? (
              <span className="rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-medium text-muted">
                {formatRelativeTime(selectedRun.data?.createdAt ?? "")}
              </span>
            ) : null}
            <span className="font-mono text-xs text-muted">
              {displayedTrace.totalLatencyMs}ms · ≈ {formatUsd(displayedTrace.totalCostUsd ?? 0)}
            </span>
            <span className="font-mono text-xs text-muted">
              {displayedTrace.sources.length} sources
            </span>
            <button
              type="button"
              onClick={() => void copyTrace()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition hover:bg-surface-hover"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy trace"}
            </button>
          </div>
          <PipelineVisualizer trace={displayedTrace} />
        </div>
      ) : null}

      {!testPipeline.isPending &&
      !isRunning &&
      !testPipeline.isError &&
      !runError &&
      !displayedTrace ? (
        <EmptyState
          icon={FlaskConical}
          title="No trace yet"
          description="Type a query above and run a trace to inspect every pipeline stage."
        />
      ) : null}

      <div className="glass-card rounded-2xl p-5">
        <div className="mb-3 flex items-center gap-2">
          <History className="h-4 w-4 text-muted" />
          <h2 className="text-sm font-semibold">Recent traces</h2>
        </div>
        {recentRuns.isLoading ? (
          <p className="text-xs text-muted">Loading past runs…</p>
        ) : recentRuns.data?.items.length ? (
          <ul className="divide-y divide-glass-border">
            {recentRuns.data.items.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <p className="min-w-0 flex-1 truncate text-sm">{run.prompt}</p>
                {run.status === "RUNNING" ? (
                  <span className="inline-flex items-center gap-1 text-xs text-primary">
                    <span className="status-pulse h-2 w-2 rounded-full bg-primary" /> running
                  </span>
                ) : run.status === "SUCCESS" ? (
                  <span className="inline-flex items-center gap-1 text-xs text-success">
                    <CheckCircle2 className="h-3 w-3" /> success
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 text-xs text-warning"
                    title={run.error ?? undefined}
                  >
                    <XCircle className="h-3 w-3" /> failed
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-xs text-muted">
                  <Clock className="h-3 w-3" /> {run.latencyMs}ms
                </span>
                <span className="text-xs text-muted">{formatRelativeTime(run.createdAt)}</span>
                <button
                  type="button"
                  onClick={() => loadRun(run.id)}
                  disabled={run.status !== "SUCCESS" || selectedRun.isFetching}
                  title={
                    run.status === "SUCCESS" ? undefined : "No trace stored for running/failed runs"
                  }
                  className="rounded-lg border border-border px-2.5 py-1 text-xs transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {selectedRunId === run.id && selectedRun.isFetching ? "Loading…" : "View"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">
            No stored runs yet — run a trace above and it will appear here.
          </p>
        )}
      </div>
    </div>
  );
}
