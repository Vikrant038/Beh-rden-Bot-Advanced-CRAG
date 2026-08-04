"use client";

import { TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface TopQuestionsProps {
  queries: Array<{ query: string; count: number }>;
  loading: boolean;
}

export function TopQuestions({ queries, loading }: TopQuestionsProps) {
  const maxCount = queries.length > 0 ? queries[0].count : 1;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Top questions</h3>
        <TrendingUp className="h-4 w-4 text-accent" />
      </div>
      <p className="mb-4 text-xs text-muted">Most-asked user questions in the selected period</p>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : queries.length === 0 ? (
        <p className="py-4 text-sm text-muted">No queries recorded yet.</p>
      ) : (
        <ol className="space-y-3">
          {queries.map((question, index) => (
            <li key={`${question.query}-${index}`} className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-xs font-medium tabular-nums text-muted">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{question.query}</span>
              <div className="hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-hover sm:block">
                <div
                  className="h-full rounded-full bg-accent/70"
                  style={{ width: `${Math.max(8, (question.count / maxCount) * 100)}%` }}
                />
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted">{question.count}×</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
