"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";

interface FailedQuery {
  id: string;
  conversationId: string;
  query: string;
  createdAt: string;
}

interface FailedQueriesCardProps {
  queries: FailedQuery[];
  loading: boolean;
}

export function FailedQueriesCard({ queries, loading }: FailedQueriesCardProps) {
  const router = useRouter();

  return (
    <div className="rounded-2xl border border-warning/30 bg-warning/5 p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-warning" />
          Unanswered queries
        </h3>
        <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
          {loading ? "…" : queries.length}
        </span>
      </div>
      <p className="mb-3 mt-1 text-xs text-muted">
        User questions with no assistant response in the last 14 days.
      </p>

      {loading ? (
        <p className="animate-pulse py-3 text-sm text-muted">Loading…</p>
      ) : queries.length === 0 ? (
        <p className="py-3 text-sm text-success">No unanswered queries — all caught.</p>
      ) : (
        <ul className="space-y-1.5">
          {queries.slice(0, 5).map((query) => (
            <li key={query.id}>
              <button
                type="button"
                onClick={() => router.push(`/chat/${query.conversationId}`)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-hover"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{query.query}</span>
                <span className="shrink-0 text-[10px] text-muted">
                  {formatRelativeTime(query.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
