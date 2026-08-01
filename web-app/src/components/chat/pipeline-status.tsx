"use client";

import type { PipelineStage } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

const STAGES: Array<{ key: PipelineStage; label: string }> = [
  { key: "guardrail", label: "Guardrail" },
  { key: "retrieving", label: "Retrieving" },
  { key: "research", label: "Research" },
  { key: "analyst", label: "Analysis" },
  { key: "writer", label: "Writing" },
];

export function PipelineStatus({ status }: { status: PipelineStage }) {
  if (status === "idle" || status === "done") {
    return null;
  }

  const currentIndex = STAGES.findIndex((stage) => stage.key === status);

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2 text-xs text-muted"
      aria-live="polite"
    >
      {STAGES.map((stage) => {
        const index = STAGES.findIndex((s) => s.key === stage.key);
        const isActive = stage.key === status;
        const isComplete = currentIndex > index;
        return (
          <div key={stage.key} className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isActive && "status-pulse bg-primary",
                !isActive && isComplete && "bg-success",
                !isActive && !isComplete && "bg-border",
              )}
            />
            <span
              className={cn(
                isActive && "font-medium text-foreground",
                !isActive && isComplete && "text-muted",
                !isActive && !isComplete && "text-muted/60",
              )}
            >
              {stage.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
