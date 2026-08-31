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
import { RadioGroup } from "@/components/ui/radio-group";
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

function typeIcon(type: "pdf" | "web") {
  return type === "pdf" ? FileText : Globe;
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

/** Shared stepper-button styling for the document and chunk chevrons. */
const STEP_BUTTON =
  "grid min-h-11 min-w-11 place-items-center rounded-lg border border-border text-muted transition hover:bg-surface-hover disabled:opacity-40";

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
  // ISO timestamps compare lexically, so max() picks the most recent sync.
  const lastSynced = useMemo(
    () =>
      (documents.data ?? []).reduce<string | null>(
        (latest, document) =>
          !latest || document.updatedAt > latest ? document.updatedAt : latest,
        null,
      ),
    [documents.data],
  );
  const totalChunks = documents.data?.reduce((sum, doc) => sum + doc.chunkCount, 0) ?? 0;

  const allChunks = useMemo(
    () => chunks.data?.pages.flatMap((page) => page.items) ?? [],
    [chunks.data],
  );
  const scoredChunks = useMemo(
    () =>
      allChunks
        .filter((chunk) => chunk.text.toLowerCase().includes(chunkSearch.trim().toLowerCase()))
        .map((chunk) => ({ chunk, score: chunkRelevanceScore(chunk.text, chunkSearch) })),
    [allChunks, chunkSearch],
  );
  const chunkNavigator = useChunkNavigator(scoredChunks.length);
  // Keep the navigator in bounds when search/filtering shrinks the list.
  useEffect(() => {
    if (chunkNavigator.index > Math.max(0, scoredChunks.length - 1)) {
      chunkNavigator.select(Math.max(0, scoredChunks.length - 1));
    }
  }, [scoredChunks.length, chunkNavigator]);

  const refresh = () => {
    void utils.source.list.invalidate();
    void utils.source.getChunks.invalidate();
  };

  const goToDocument = (id: string) => {
    const next = documents.data?.find((document) => document.id === id) ?? null;
    setSelected(next);
  };

  const copyWithToast = async (text: string, copied: string, failed: string) => {
    const ok = await copyText(text);
    toast({ title: ok ? copied : failed, variant: ok ? "success" : "error" });
  };

  /** Step to an adjacent chunk, smooth-scrolling to it in list view. */
  const goToChunk = (nextIndex: number) => {
    chunkNavigator.clamp(nextIndex);
    if (chunkViewMode !== "list") {
      return;
    }
    const clamped = Math.min(Math.max(0, nextIndex), Math.max(0, scoredChunks.length - 1));
    document
      .getElementById(`chunk-item-${scoredChunks[clamped]?.chunk.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const selectedType = selected ? documentType(selected.url) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="relative w-full sm:w-auto sm:min-w-0 sm:flex-1">
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

        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <RadioGroup
            label="Filter by document type"
            value={typeFilter}
            onValueChange={setTypeFilter}
            buttonClassName="min-h-11 px-3 py-1.5 capitalize"
            options={(["all", "pdf", "web"] as const).map((option) => ({
              value: option,
              label: option,
            }))}
          />

          <RadioGroup
            label="View mode"
            value={view}
            onValueChange={setView}
            buttonClassName="min-h-11 p-2"
            options={[
              { value: "list", label: <List className="h-4 w-4" />, ariaLabel: "List view" },
              { value: "grid", label: <LayoutGrid className="h-4 w-4" />, ariaLabel: "Grid view" },
            ]}
          />

          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh knowledge base"
            title="Refresh"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border text-muted transition hover:bg-surface-hover hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>{documents.data?.length ?? 0} documents</span>
        <span>{totalChunks} chunks</span>
        {lastSynced ? <span>Last synced {formatRelativeTime(lastSynced)}</span> : null}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,340px)_1fr]">
        <div className="space-y-3">
          {documents.isLoading ? (
            <div className="px-1">
              <Skeleton className="h-10 w-full" lines={3} />
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
                const TypeIcon = typeIcon(documentType(document.url));
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
                      {document.chunkCount} chunks · {documentType(document.url)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <ul className="space-y-1">
              {items.map((document) => {
                const TypeIcon = typeIcon(documentType(document.url));
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
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="mb-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted transition hover:bg-surface-hover md:hidden"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back to documents
              </button>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-lg font-semibold">{selected.title}</h2>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-[10px] font-medium text-muted">
                      {selectedType === "pdf" ? (
                        <FileText className="h-2.5 w-2.5" />
                      ) : (
                        <Globe className="h-2.5 w-2.5" />
                      )}
                      {selectedType}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">
                    {selected.chunkCount} chunks · updated {formatRelativeTime(selected.updatedAt)}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      void copyWithToast(selected.url, "URL copied", "Could not copy URL")
                    }
                    className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-accent underline-offset-2 hover:underline"
                    title="Copy source URL"
                  >
                    <Copy className="h-3 w-3 shrink-0" />
                    <span className="truncate">{selected.url}</span>
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  {([-1, 1] as const).map((delta) => {
                    const target = selectedIndex >= 0 ? items[selectedIndex + delta] : undefined;
                    return (
                      <button
                        key={delta}
                        type="button"
                        onClick={() => target && goToDocument(target.id)}
                        disabled={!target}
                        aria-label={delta < 0 ? "Previous document" : "Next document"}
                        className={STEP_BUTTON}
                      >
                        {delta < 0 ? (
                          <ChevronLeft className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    );
                  })}
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
                <RadioGroup
                  label="Chunk view mode"
                  value={chunkViewMode}
                  onValueChange={setChunkViewMode}
                  buttonClassName="px-2.5 py-1.5"
                  options={[
                    { value: "list", label: "List" },
                    { value: "paginated", label: "Paginated" },
                  ]}
                />
              </div>

              {chunks.isLoading ? (
                <Skeleton className="h-20 w-full" lines={3} />
              ) : scoredChunks.length === 0 ? (
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
                            <p className="break-words text-sm leading-relaxed">
                              {highlightMatches(chunk.text, chunkSearch)}
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                void copyWithToast(
                                  chunk.text,
                                  "Chunk copied",
                                  "Could not copy chunk",
                                )
                              }
                              aria-label={`Copy chunk #${chunk.id}`}
                              className="shrink-0 rounded-lg p-2 text-muted opacity-100 transition hover:bg-surface-hover hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
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
                        {([-1, 1] as const).map((delta) => (
                          <button
                            key={delta}
                            type="button"
                            onClick={() => goToChunk(chunkNavigator.index + delta)}
                            disabled={
                              delta < 0
                                ? chunkNavigator.index <= 0
                                : chunkNavigator.index >= scoredChunks.length - 1
                            }
                            aria-label={delta < 0 ? "Previous chunk" : "Next chunk"}
                            className={STEP_BUTTON}
                          >
                            {delta < 0 ? (
                              <ChevronLeft className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        ))}
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
