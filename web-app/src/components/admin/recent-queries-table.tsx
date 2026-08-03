"use client";

import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, GitFork, XCircle } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface RecentQueryRow {
  id: string;
  conversationId: string;
  query: string;
  createdAt: string;
  mode: string;
  latencyMs: number;
  isCached: boolean;
  retrievalPath: string | null;
}

interface RecentQueriesTableProps {
  queries: RecentQueryRow[];
  loading: boolean;
}

export function RecentQueriesTable({ queries, loading }: RecentQueriesTableProps) {
  const router = useRouter();

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold">Recent queries</h3>
        <div className="mt-4 space-y-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </div>
    );
  }

  if (queries.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold">Recent queries</h3>
        <p className="mt-4 text-sm text-muted">No queries recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold">Recent queries</h3>
      <p className="mb-3 text-xs text-muted">
        Latest user questions with pipeline outcome — click a row to open it.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-4 font-medium">Query</th>
              <th className="py-2 pr-4 font-medium">Mode</th>
              <th className="py-2 pr-4 font-medium">Latency</th>
              <th className="py-2 pr-4 font-medium">Cached</th>
              <th className="py-2 pr-4 font-medium">Path</th>
              <th className="py-2 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {queries.map((query) => (
              <tr
                key={query.id}
                onClick={() => router.push(`/chat/${query.conversationId}`)}
                className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-hover/60"
              >
                <td className="max-w-[220px] py-2.5 pr-4">
                  <p className="truncate">{query.query}</p>
                </td>
                <td className="py-2.5 pr-4">
                  <span className="inline-flex items-center gap-1 text-xs">
                    <GitFork className="h-3 w-3 text-muted" />
                    {query.mode.toUpperCase()}
                  </span>
                </td>
                <td className="py-2.5 pr-4">
                  <span className="inline-flex items-center gap-1 text-xs tabular-nums">
                    <Clock className="h-3 w-3 text-muted" />
                    {Math.round(query.latencyMs)}ms
                  </span>
                </td>
                <td className="py-2.5 pr-4">
                  {query.isCached ? (
                    <span className="inline-flex items-center gap-1 text-xs text-success">
                      <CheckCircle2 className="h-3 w-3" /> yes
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-muted">
                      <XCircle className="h-3 w-3" /> no
                    </span>
                  )}
                </td>
                <td className="max-w-[160px] py-2.5 pr-4">
                  <p className="truncate text-xs text-muted">{query.retrievalPath ?? "—"}</p>
                </td>
                <td className="whitespace-nowrap py-2.5 text-xs text-muted">
                  {formatRelativeTime(query.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
