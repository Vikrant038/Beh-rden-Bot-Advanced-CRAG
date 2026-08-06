"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Eye, ExternalLink, GitFork, Loader2, XCircle } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/lib/trpc/client";

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
  /** True when another page of results is available. */
  hasMore?: boolean;
  /** Requests the next page of results (cursor pagination). */
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

/**
 * 9.12 — Drill-in drawer for a single query: full latency/source breakdown via
 * `admin.queryDetail` instead of only navigating to the conversation.
 */
function QueryDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = api.admin.queryDetail.useQuery({ id });
  const data = detail.data;

  const metadata = (data?.userMessage?.metadata as Record<string, unknown> | null) ?? null;
  const latencyMs = Number(metadata?.latencyMs ?? 0);
  const isCached = Boolean(metadata?.isCached);
  const mode = String(metadata?.mode ?? "standard");
  const retrievalPath = metadata?.retrievalPath ? String(metadata.retrievalPath) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">Query details</DialogTitle>
          <DialogDescription className="text-xs">
            Pipeline outcome for this user query.
          </DialogDescription>
        </DialogHeader>

        {detail.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !data ? (
          <p className="py-6 text-center text-sm text-muted">Query not found.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-accent">Query</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                {data.userMessage.content}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-border p-2.5">
                <p className="text-[10px] text-muted">Mode</p>
                <p className="mt-0.5 flex items-center gap-1 text-sm font-medium capitalize">
                  <GitFork className="h-3 w-3 text-muted" /> {mode}
                </p>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <p className="text-[10px] text-muted">Latency</p>
                <p className="mt-0.5 flex items-center gap-1 text-sm font-medium tabular-nums">
                  <Clock className="h-3 w-3 text-muted" /> {Math.round(latencyMs)}ms
                </p>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <p className="text-[10px] text-muted">Cached</p>
                <p
                  className={`mt-0.5 flex items-center gap-1 text-sm font-medium ${
                    isCached ? "text-success" : ""
                  }`}
                >
                  {isCached ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <XCircle className="h-3 w-3 text-muted" />
                  )}
                  {isCached ? "yes" : "no"}
                </p>
              </div>
              <div className="rounded-lg border border-border p-2.5">
                <p className="text-[10px] text-muted">When</p>
                <p className="mt-0.5 text-sm font-medium">
                  {formatRelativeTime(data.userMessage.createdAt)}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-border p-2.5">
              <p className="text-[10px] text-muted">Retrieval path</p>
              <p className="mt-0.5 break-words font-mono text-xs">{retrievalPath ?? "—"}</p>
            </div>

            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                Response
              </p>
              {data.assistantResponse ? (
                <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-sm leading-relaxed">
                  {data.assistantResponse.content}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted">No assistant response recorded.</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RecentQueriesTable({
  queries,
  loading,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
}: RecentQueriesTableProps) {
  const router = useRouter();
  const [detailId, setDetailId] = useState<string | null>(null);

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
        Latest user questions with pipeline outcome — click a row to open it, or use the details
        button for a full breakdown.
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
              <th className="py-2 pr-4 font-medium">When</th>
              <th className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {queries.map((query) => (
              <tr
                key={query.id}
                role="button"
                tabIndex={0}
                aria-label={`Open conversation for query: ${query.query}`}
                onClick={() => router.push(`/chat/${query.conversationId}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    router.push(`/chat/${query.conversationId}`);
                  }
                }}
                className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <td className="min-w-[160px] max-w-[220px] py-2.5 pr-4">
                  <p className="line-clamp-2 break-words">{query.query}</p>
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
                <td className="py-2.5">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`View details for query: ${query.query}`}
                      title="View details"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDetailId(query.id);
                      }}
                      className="grid min-h-11 min-w-11 place-items-center rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-foreground"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Open conversation for query: ${query.query}`}
                      title="Open conversation"
                      onClick={(event) => {
                        event.stopPropagation();
                        router.push(`/chat/${query.conversationId}`);
                      }}
                      className="grid min-h-11 min-w-11 place-items-center rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-foreground"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs text-muted transition hover:bg-surface-hover hover:text-foreground disabled:opacity-60"
        >
          {loadingMore ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </>
          ) : (
            "Load more"
          )}
        </button>
      ) : null}

      {detailId ? <QueryDetailDrawer id={detailId} onClose={() => setDetailId(null)} /> : null}
    </div>
  );
}
