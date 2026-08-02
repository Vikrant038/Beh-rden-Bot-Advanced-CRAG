"use client";

import { useState } from "react";
import { FlaskConical, Play } from "lucide-react";
import { api } from "@/lib/trpc/client";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PipelineVisualizer } from "@/components/admin/pipeline/pipeline-visualizer";

const EXAMPLES = [
  "Compare the cost of studying in Germany vs the Netherlands",
  "What documents are required for a student visa at a German embassy?",
  "Is the APS certificate mandatory for Indian students applying to German universities?",
];

export default function AdminPipelineTesterPage() {
  const [prompt, setPrompt] = useState("");
  const testPipeline = api.admin.testPipeline.useMutation({
    retry: false,
  });

  const run = () => {
    const trimmed = prompt.trim();
    if (!trimmed || testPipeline.isPending) {
      return;
    }
    testPipeline.mutate({ prompt: trimmed });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pipeline tester</h1>
        <p className="mt-1 text-sm text-muted">
          Run a single glass-box trace through the 3-agent ReAct pipeline and inspect every stage —
          including parent-child chunk expansion.
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
            disabled={testPipeline.isPending || !prompt.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
          >
            <Play className={`h-4 w-4 ${testPipeline.isPending ? "animate-pulse" : ""}`} />
            {testPipeline.isPending ? "Running…" : "Run trace"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setPrompt(example);
                testPipeline.reset();
              }}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted transition hover:border-primary/60 hover:text-foreground"
            >
              {example}
            </button>
          ))}
        </div>

        <p className="mt-3 text-xs text-muted">
          Queries run with PII masking, no conversation memory, and bypass the semantic cache so
          every stage executes live.
        </p>
      </div>

      {testPipeline.isPending ? (
        <div className="glass-card flex items-center gap-3 rounded-2xl p-4">
          <span className="status-pulse h-2.5 w-2.5 rounded-full bg-primary" />
          <p className="text-sm text-muted">
            Running research → analyst → writer (3–5 sequential LLM calls)…
          </p>
        </div>
      ) : null}

      {testPipeline.isError ? (
        <ErrorState
          message={testPipeline.error.message}
          code={testPipeline.error.data?.code}
          retry={run}
        />
      ) : null}

      {testPipeline.isSuccess && testPipeline.data ? (
        <PipelineVisualizer trace={testPipeline.data} />
      ) : null}

      {!testPipeline.isPending && !testPipeline.isError && !testPipeline.isSuccess ? (
        <EmptyState
          icon={FlaskConical}
          title="No trace yet"
          description="Type a query above and run a trace to inspect every pipeline stage."
        />
      ) : null}
    </div>
  );
}
