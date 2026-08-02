"use client";

import { Search, Calculator, Globe, MousePointerClick } from "lucide-react";
import type { ResearchStep } from "@/server/rag/agents/research";

interface ReactStepProps {
  step: ResearchStep;
}

function actionIcon(action: string): React.ReactNode {
  const key = action.toLowerCase();
  if (key.includes("web_search") || key.includes("ddg")) {
    return <Globe className="h-3.5 w-3.5" />;
  }
  if (key.includes("visa") || key.includes("calculator")) {
    return <Calculator className="h-3.5 w-3.5" />;
  }
  if (key.includes("sub_query")) {
    return <MousePointerClick className="h-3.5 w-3.5" />;
  }
  return <Search className="h-3.5 w-3.5" />;
}

export function ReactStep({ step }: ReactStepProps) {
  return (
    <div className="rounded-xl border border-glass-border bg-surface/60 p-3">
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-primary/10 text-primary">
          {actionIcon(step.action)}
        </span>
        <p className="font-mono text-xs font-medium text-foreground">{step.action}</p>
        <span className="ml-auto shrink-0 rounded-full bg-surface-hover px-2 py-0.5 font-mono text-[10px] text-muted">
          iteration {step.iteration}
        </span>
      </div>

      <dl className="mt-2 space-y-1.5 text-xs">
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 font-mono uppercase tracking-wide text-muted">Thought</dt>
          <dd className="min-w-0 flex-1 text-foreground/90">{step.thought}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 font-mono uppercase tracking-wide text-muted">
            Observation
          </dt>
          <dd className="min-w-0 flex-1 text-foreground/90">{step.observation}</dd>
        </div>
      </dl>
    </div>
  );
}
