"use client";

import { Check } from "lucide-react";
import type { PipelineStage } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

const STAGES: Array<{ keys: PipelineStage[]; label: string; primaryKey: string }> = [
  { keys: ["disambiguation"], label: "Disambiguation", primaryKey: "disambiguation" },
  { keys: ["guardrail"], label: "Guardrail", primaryKey: "guardrail" },
  { keys: ["query_expansion"], label: "Query Expansion", primaryKey: "query_expansion" },
  {
    keys: ["dense_retrieval", "bm25_retrieval", "rrf_fusion", "rerank", "crag_gate", "retrieving"],
    label: "Dense/BM25 Search",
    primaryKey: "dense_retrieval",
  },
  { keys: ["research", "tool_calls"], label: "Research Tools", primaryKey: "research" },
  { keys: ["analyst"], label: "Analyst", primaryKey: "analyst" },
  { keys: ["writer"], label: "Writer", primaryKey: "writer" },
];

export function PipelineStatus({ status }: { status: PipelineStage }) {
  if (status === "idle" || status === "done") {
    return null;
  }

  const currentIndex = STAGES.findIndex((stage) => stage.keys.includes(status));
  const activeIndex = currentIndex === -1 ? 0 : currentIndex;
  // If we are at 'done', progress would be 100, but we return null early.
  const progress = ((activeIndex + 1) / STAGES.length) * 100;

  return (
    <div className="px-1 py-2" aria-live="polite">
      <div className="flex items-center gap-3">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-xs text-muted">{Math.round(progress)}%</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {STAGES.map((stage, index) => {
          const isActive = stage.keys.includes(status);
          const isComplete = activeIndex > index;
          return (
            <div key={stage.primaryKey} className="flex items-center gap-1.5">
              {isComplete ? (
                <Check className="h-3 w-3 text-success" aria-hidden="true" />
              ) : (
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    isActive && "status-pulse bg-primary",
                    !isActive && !isComplete && "bg-border",
                  )}
                />
              )}
              <span
                className={cn(
                  isActive && "font-medium text-foreground",
                  isComplete && "text-muted",
                  !isActive && !isComplete && "text-muted/60",
                )}
              >
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
