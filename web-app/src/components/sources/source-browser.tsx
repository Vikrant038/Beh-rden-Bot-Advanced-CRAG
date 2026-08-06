"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Globe,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/trpc/client";
import { formatRelativeTime } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/lib/toast";

interface SourceListItem {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
}

type DocType = "all" | "pdf" | "web";
type ViewMode = "list" | "grid";

function documentType(url: string): "pdf" | "web" {
  return url.startsWith("pdf://") || /\.pdf($|\?)/i.test(url) ? "pdf" : "web";
}

function highlightMatches(text: string, terms: string): React.ReactNode {
  const query = terms.trim();
  if (!query) {
    return text;
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp — query is regex-escaped above, so the pattern is a literal (linear-time, no ReDoS); see semgrep-backlog.md.
  const parts = text.split(new RegExp(`(${escaped})`, "ig"));
  return parts.map((part, index) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={index} className="rounded-sm bg-warning/25 px-0.5 text-foreground">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 8.11 — Honest relevance score for a chunk against the active within-document
 * search. There is no persisted retrieval score on DocumentChunk rows, so when
 * a search is active we derive a deterministic relevance score from term
 * coverage (weighted) plus a proximity bonus for matches near the chunk start.
 * Returns 0 when there is no query.
 */
function chunkRelevanceScore(text: string, query: string): number | null {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return null;
  }
  const lower = text.toLowerCase();
  const matching = terms.filter((term) => lower.includes(term));
  const coverage = matching.length / terms.length;
  const firstHit = matching.length
    ? Math.min(...matching.map((term) => lower.indexOf(term)))
    : lower.length;
  const position = lower.length > 0 ? 1 - firstHit / Math.max(1, lower.length) : 0;
  // Coverage dominates; position breaks ties so earlier matches win.
  return Math.min(1, coverage * 0.7 + position * 0.3);
}

/**
 * 8.5 — Step through individual chunks of the selected document.
 */
function useChunkNavigator(count: number) {
  const [index, setIndex] = useState(0);
  return {
    index,
    // Clamp into [0, max(0, count - 1)] so an empty list never yields -1.
    clamp: (next: number) => setIndex(Math.min(Math.max(0, next), Math.max(0, count - 1))),
    select: setIndex,
  };
}

export function SourceBrowser() {
  const router = useRouter();
  const { data: session } = useSession();
  const utils = api.useUtils();
  const { toast } = useToast();
  const [selected, setSelected] = useState<SourceListItem | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<DocType>("all");
  const [view, setView] = useState<ViewMode>("list");
  const [chunkSearch, setChunkSearch] = useState("");
  const [chunkViewMode, setChunkViewMode] = useState<"list" | "paginated">("list");
  const documents = api.source.list.useQuery();
  const chunks = api.source.getChunks.useInfiniteQuery(
    { documentId: selected?.id ?? "", limit: 20 },
    {
      enabled: Boolean(selected),
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );

  const items = useMemo(
    () =>
      (documents.data ?? []).filter((document) => {
        if (typeFilter !== "all" && documentType(document.url) !== typeFilter) {
          return false;
        }
        return document.title.toLowerCase().includes(search.toLowerCase());
      }),
    [documents.data, search, typeFilter],
  );

  const selectedIndex = selected ? items.findIndex((item) => item.id === selected.id) : -1;
  const lastSynced = useMemo(() => {
    const docs = documents.data ?? [];
    if (docs.length === 0) return null;
    let maxMs = 0;
    let latestIso = "";
    for (const doc of docs) {
      const ms = new Date(doc.updatedAt).getTime();
      if (ms > maxMs) {
        maxMs = ms;
        latestIso = doc.updatedAt;
      }
    }
    return latestIso || null;
  }, [documents.data]);
  const totalChunks = documents.data?.reduce((sum, doc) => sum + doc.chunkCount, 0) ?? 0;

  const allChunks = chunks.data?.pages.flatMap((page) => page.items) ?? [];
  const visibleChunks = allChunks.filter((chunk) =>
    chunk.text.toLowerCase().includes(chunkSearch.trim().toLowerCase()),
  );
  const chunkNavigator = useChunkNavigator(visibleChunks.length);
  // Keep the navigator in bounds when search/filtering shrinks the list.
  useEffect(() => {
    if (chunkNavigator.index > Math.max(0, visibleChunks.length - 1)) {
      chunkNavigator.select(Math.max(0, visibleChunks.length - 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleChunks.length]);

  const scoredChunks = useMemo(
    () =>
      visibleChunks.map((chunk) => ({
        chunk,
        score: chunkRelevanceScore(chunk.text, chunkSearch),
      })),
    [visibleChunks, chunkSearch],
  );

  const refresh = () => {
    void utils.source.list.invalidate();
    void utils.source.getChunks.invalidate();
  };

  const goToDocument = (id: string) => {
    const next = documents.data?.find((document) => document.id === id) ?? null;
    setSelected(next);
  };

  const handleCopyUrl = async (url: string) => {
    const ok = await copyText(url);
    toast({
      title: ok ? "URL copied" : "Could not copy URL",
      variant: ok ? "success" : "error",
    });
  };

  const handleCopyChunk = async (text: string) => {
    const ok = await copyText(text);
    toast({
      title: ok ? "Chunk copied" : "Could not copy chunk",
      variant: ok ? "success" : "error",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search documents…"
            aria-label="Search documents"
            className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-4 text-sm outline-none transition placeholder:text-muted focus:border-primary"
          />
        </div>

        <div
          role="radiogroup"
          aria-label="Filter by document type"
          className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface p-1"
        >
          {(["all", "pdf", "web"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={typeFilter === option}
              onClick={() => setTypeFilter(option)}
              className={`rounded-lg px-3 py-1.5 text-xs capitalize transition focus-visible:ring-2 focus-visible:ring-primary ${
                typeFilter === option
                  ? "bg-primary text-primary-foreground"
                  : "text-muted hover:bg-surface-hover hover:text-foreground"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <div
          role="radiogroup"
          aria-label="View mode"
          className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface p-1"
        >
          <button
            type="button"
            role="radio"
            aria-checked={view === "list"}
            onClick={() => setView("list")}
            aria-label="List view"
            className={`rounded-lg p-2 transition ${
              view === "list"
                ? "bg-primary text-primary-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={view === "grid"}
            onClick={() => setView("grid")}
            aria-label="Grid view"
            className={`rounded-lg p-2 transition ${
              view === "grid"
                ? "bg-primary text-primary-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh knowledge base"
          title="Refresh"
          className="grid h-10 w-10 place-items-center rounded-xl border border-border text-muted transition hover:bg-surface-hover hover:text-foreground"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>{documents.data?.length ?? 0} documents</span>
        <span>{totalChunks} chunks</span>
        {lastSynced ? <span>Last synced {formatRelativeTime(lastSynced)}</span> : null}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,340px)_1fr]">
        <div className="space-y-3">
          {documents.isLoading ? (
            <div className="space-y-2 px-1">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              title="No documents found"
              description={
                documents.data?.length
                  ? "No documents match your filters."
                  : "Nothing indexed yet. Add documents from the admin panel."
              }
              icon={FileText}
              action={
                session?.user?.role === "ADMIN" && !documents.data?.length ? (
                  <button
                    type="button"
                    onClick={() => router.push("/admin/documents")}
                    className="mt-1 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Add documents in the admin panel
                  </button>
                ) : undefined
              }
              className="py-8"
            />
          ) : view === "grid" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((document) => {
                const type = documentType(document.url);
                const TypeIcon = type === "pdf" ? FileText : Globe;
                return (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => setSelected(document)}
                    className={`flex flex-col gap-2 rounded-xl border p-3 text-left text-sm transition ${
                      selected?.id === document.id
                        ? "border-primary/60 bg-primary/10"
                        : "border-border bg-surface hover:border-primary/40 hover:bg-surface-hover"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <TypeIcon className="h-4 w-4 shrink-0 text-accent" />
                      <span className="min-w-0 flex-1 truncate">{document.title}</span>
                    </span>
                    <span className="text-xs text-muted">
                      {document.chunkCount} chunks · {type}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <ul className="space-y-1">
              {items.map((document) => {
                const type = documentType(document.url);
                const TypeIcon = type === "pdf" ? FileText : Globe;
                return (
                  <li key={document.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(document)}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                        selected?.id === document.id
                          ? "bg-primary/10 text-foreground"
                          : "text-muted hover:bg-surface-hover hover:text-foreground"
                      }`}
                    >
                      <TypeIcon className="h-4 w-4 shrink-0 text-accent" />
                      <span className="min-w-0 flex-1 truncate">{document.title}</span>
                      <span className="shrink-0 text-xs tabular-nums">{document.chunkCount}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-surface p-5">
          {!selected ? (
            <EmptyState
              title="Select a document"
              description="Browse its indexed chunks from the list on the left."
              icon={FileText}
            />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-lg font-semibold">{selected.title}</h2>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-medium text-muted">
                      {documentType(selected.url) === "pdf" ? (
                        <FileText className="h-2.5 w-2.5" />
                      ) : (
                        <Globe className="h-2.5 w-2.5" />
                      )}
                      {documentType(selected.url)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">
                    {selected.chunkCount} chunks · updated {formatRelativeTime(selected.updatedAt)}
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleCopyUrl(selected.url)}
                    className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-accent underline-offset-2 hover:underline"
                    title="Copy source URL"
                  >
                    <Copy className="h-3 w-3 shrink-0" />
                    <span className="truncate">{selected.url}</span>
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedIndex > 0 && items[selectedIndex - 1]) {
                        goToDocument(items[selectedIndex - 1].id);
                      }
                    }}
                    disabled={selectedIndex <= 0}
                    aria-label="Previous document"
                    className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-border text-muted transition hover:bg-surface-hover disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedIndex >= 0 && items[selectedIndex + 1]) {
                        goToDocument(items[selectedIndex + 1].id);
                      }
                    }}
                    disabled={selectedIndex < 0 || selectedIndex >= items.length - 1}
                    aria-label="Next document"
                    className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-border text-muted transition hover:bg-surface-hover disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mb-3 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                  <input
                    type="search"
                    value={chunkSearch}
                    onChange={(event) => setChunkSearch(event.target.value)}
                    placeholder="Search within this document…"
                    aria-label="Search within this document"
                    className="w-full rounded-xl border border-border bg-background py-2 pl-8 pr-3 text-sm outline-none transition placeholder:text-muted focus:border-primary"
                  />
                </div>
                <div
                  role="radiogroup"
                  aria-label="Chunk view mode"
                  className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-border bg-surface p-1"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chunkViewMode === "list"}
                    onClick={() => setChunkViewMode("list")}
                    className={`rounded-lg px-2.5 py-1.5 text-xs transition ${
                      chunkViewMode === "list"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted hover:bg-surface-hover hover:text-foreground"
                    }`}
                  >
                    List
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chunkViewMode === "paginated"}
                    onClick={() => setChunkViewMode("paginated")}
                    className={`rounded-lg px-2.5 py-1.5 text-xs transition ${
                      chunkViewMode === "paginated"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted hover:bg-surface-hover hover:text-foreground"
                    }`}
                  >
                    Paginated
                  </button>
                </div>
              </div>

              {chunks.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : visibleChunks.length === 0 ? (
                <EmptyState
                  title={chunkSearch ? "No matching chunks" : "No chunks"}
                  description={
                    chunkSearch
                      ? "No chunks match your search within this document."
                      : "This document has no indexed chunks yet."
                  }
                  icon={FileText}
                  className="py-10"
                />
              ) : (
                <>
                  <ul className="space-y-3">
                    {(chunkViewMode === "paginated" && scoredChunks[chunkNavigator.index]
                      ? [scoredChunks[chunkNavigator.index]]
                      : scoredChunks
                    ).map(({ chunk, score }, mappedIndex) => {
                      const listIndex =
                        chunkViewMode === "paginated" ? chunkNavigator.index : mappedIndex;
                      return (
                        <li
                          key={chunk.id}
                          id={`chunk-item-${chunk.id}`}
                          className={`group rounded-xl border p-4 transition ${
                            listIndex === chunkNavigator.index
                              ? "border-primary/60 bg-primary/5"
                              : "border-border bg-background"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm leading-relaxed">
                              {highlightMatches(chunk.text, chunkSearch)}
                            </p>
                            <button
                              type="button"
                              onClick={() => void handleCopyChunk(chunk.text)}
                              aria-label={`Copy chunk #${chunk.id}`}
                              className="shrink-0 rounded-lg p-2 text-muted opacity-0 transition group-hover:opacity-100 hover:bg-surface-hover hover:text-foreground"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <p className="text-[10px] text-muted">#{chunk.id}</p>
                            {score !== null ? (
                              <div className="flex flex-1 items-center gap-1.5">
                                <span
                                  className="h-1 flex-1 overflow-hidden rounded-full bg-border"
                                  role="img"
                                  aria-label={`Relevance ${Math.round(score * 100)}%`}
                                >
                                  <span
                                    className="block h-full rounded-full bg-accent"
                                    style={{ width: `${Math.round(score * 100)}%` }}
                                  />
                                </span>
                                <span className="font-mono text-[10px] text-muted tabular-nums">
                                  {Math.round(score * 100)}%
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {scoredChunks.length > 1 ? (
                    <div className="mt-4 flex items-center justify-between gap-2">
                      <p className="text-xs text-muted" aria-live="polite">
                        Chunk {chunkNavigator.index + 1} of {scoredChunks.length}
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const nextIndex = chunkNavigator.index - 1;
                            chunkNavigator.clamp(nextIndex);
                            if (chunkViewMode === "list" && scoredChunks[Math.max(0, nextIndex)]) {
                              const el = document.getElementById(
                                `chunk-item-${scoredChunks[Math.max(0, nextIndex)].chunk.id}`,
                              );
                              el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                            }
                          }}
                          disabled={chunkNavigator.index <= 0}
                          aria-label="Previous chunk"
                          className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-border text-muted transition hover:bg-surface-hover disabled:opacity-40"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const nextIndex = chunkNavigator.index + 1;
                            chunkNavigator.clamp(nextIndex);
                            if (
                              chunkViewMode === "list" &&
                              scoredChunks[Math.min(scoredChunks.length - 1, nextIndex)]
                            ) {
                              const el = document.getElementById(
                                `chunk-item-${scoredChunks[Math.min(scoredChunks.length - 1, nextIndex)].chunk.id}`,
                              );
                              el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                            }
                          }}
                          disabled={chunkNavigator.index >= scoredChunks.length - 1}
                          aria-label="Next chunk"
                          className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-border text-muted transition hover:bg-surface-hover disabled:opacity-40"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
              {chunks.hasNextPage && (
                <button
                  type="button"
                  onClick={() => void chunks.fetchNextPage()}
                  disabled={chunks.isFetchingNextPage}
                  className="mt-4 w-full rounded-xl border border-border py-2 text-sm text-muted transition hover:bg-surface-hover disabled:opacity-60"
                >
                  {chunks.isFetchingNextPage ? "Loading…" : "Load more chunks"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
