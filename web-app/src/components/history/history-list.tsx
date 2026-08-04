"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  CheckSquare,
  Download,
  Eye,
  FileDown,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Pin,
  Search,
  Trash2,
  Zap,
} from "lucide-react";
import { api } from "@/lib/trpc/client";
import { formatRelativeTime, cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/use-debounce";
import { SkeletonList } from "@/components/ui/skeleton";
import { useToast } from "@/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ModeFilter = "all" | "standard" | "agentic";
type DateRange = "all" | "7d" | "30d";
type SortKey = "updated" | "created" | "title";

const MODE_FILTERS: Array<{ value: ModeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "agentic", label: "Agentic" },
  { value: "standard", label: "Standard" },
];

const DATE_RANGES: Array<{ value: DateRange; label: string }> = [
  { value: "all", label: "All time" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

function withinRange(iso: string, range: DateRange): boolean {
  if (range === "all") {
    return true;
  }
  const days = range === "7d" ? 7 : 30;
  return Date.now() - new Date(iso).getTime() <= days * 86_400_000;
}

export function HistoryList() {
  const router = useRouter();
  const utils = api.useUtils();
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 300);
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [sort, setSort] = useState<SortKey>("updated");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const loaderRef = useRef<HTMLDivElement>(null);

  const deleteMutation = api.conversation.delete.useMutation();
  const deleteManyMutation = api.conversation.deleteMany.useMutation();
  const clearAllMutation = api.conversation.clearAll.useMutation();
  const restoreMutation = api.conversation.restore.useMutation();

  const conversations = api.conversation.list.useInfiniteQuery(
    { limit: 15, search: search || undefined, mode: modeFilter === "all" ? undefined : modeFilter },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );
  const stats = api.conversation.stats.useQuery();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = api.conversation.getById.useQuery(
    { id: previewId ?? "" },
    { enabled: Boolean(previewId) },
  );

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      if (
        entries[0]?.isIntersecting &&
        conversations.hasNextPage &&
        !conversations.isFetchingNextPage
      ) {
        void conversations.fetchNextPage();
      }
    });
    if (loaderRef.current) {
      observer.observe(loaderRef.current);
    }
    return () => observer.disconnect();
  }, [conversations]);

  const items = useMemo(() => {
    const all = conversations.data?.pages.flatMap((page) => page.items) ?? [];
    const filtered = all.filter((item) => withinRange(item.updatedAt, dateRange));
    const sorted = [...filtered].sort((a, b) => {
      if (sort === "title") {
        return (a.title ?? "").localeCompare(b.title ?? "");
      }
      const key = sort === "created" ? "createdAt" : "updatedAt";
      return new Date(b[key]).getTime() - new Date(a[key]).getTime();
    });
    return sorted;
  }, [conversations.data, dateRange, sort]);

  const selectedItems = items.filter((item) => selected.has(item.id));
  const isAllSelected = items.length > 0 && selectedItems.length === items.length;

  const refresh = () => {
    void utils.conversation.list.invalidate();
    void utils.conversation.getById.invalidate();
  };

  const deleteWithUndo = async (conversation: {
    id: string;
    title: string | null;
  }) => {
    try {
      await deleteMutation.mutateAsync({ id: conversation.id });
      refresh();
      toast({
        title: "Conversation deleted",
        description: conversation.title ?? "Untitled conversation",
        variant: "info",
        action: {
          label: "Undo",
          onClick: () => {
            restoreMutation.mutate(
              { id: conversation.id },
              {
                onSuccess: () => {
                  refresh();
                  router.push(`/chat/${conversation.id}`);
                },
              },
            );
          },
        },
      });
    } catch {
      toast({ title: "Could not delete conversation", variant: "error" });
    }
  };

  const deleteSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) {
      return;
    }
    deleteManyMutation.mutate(
      { ids },
      {
        onSuccess: () => {
          setSelected(new Set());
          setSelectMode(false);
          refresh();
          toast({ title: `${ids.length} conversations deleted`, variant: "success" });
        },
      },
    );
  };

  const handleClearAll = () => {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      window.setTimeout(() => setConfirmClearAll(false), 4000);
      return;
    }
    const hasFilters = search || modeFilter !== "all";
    clearAllMutation.mutate(
      {
        search: search || undefined,
        mode: modeFilter === "all" ? undefined : modeFilter,
      },
      {
        onSuccess: (data) => {
          setConfirmClearAll(false);
          refresh();
          toast({
            title: hasFilters
              ? `${data.deleted} matching conversation${data.deleted === 1 ? "" : "s"} deleted`
              : "All conversations deleted",
            variant: "success",
          });
        },
      },
    );
  };

  const handleExport = async (id: string, title: string | null) => {
    try {
      const { markdown } = await utils.conversation.export.fetch({ id });
      downloadMarkdown(markdown, `${title ?? "conversation"}.md`);
    } catch {
      toast({ title: "Export failed", variant: "error" });
    }
  };

  const exportSelected = async () => {
    if (selectedItems.length === 0) {
      return;
    }
    try {
      const parts: string[] = [];
      for (const item of selectedItems) {
        const { markdown } = await utils.conversation.export.fetch({ id: item.id });
        parts.push(markdown);
      }
      const combined = parts.join("\n\n---\n\n");
      downloadMarkdown(combined, `behoerden-bot-history-${Date.now()}.md`);
      toast({ title: `Exported ${selectedItems.length} conversations`, variant: "success" });
    } catch {
      toast({ title: "Export failed", variant: "error" });
    }
  };

  const downloadMarkdown = (markdown: string, filename: string) => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const base = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
    const sanitized = base.replace(/[^a-z0-9-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    link.download = `${sanitized || "export"}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const previewConversation = preview.data;

  return (
    <div className="mt-6">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            <MessageSquare className="h-3.5 w-3.5" /> Conversations
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {stats.isLoading ? "…" : stats.data?.totalConversations ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            <MessagesSquare className="h-3.5 w-3.5" /> Messages
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {stats.isLoading ? "…" : stats.data?.totalMessages ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            <Pin className="h-3.5 w-3.5" /> Pinned
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {stats.isLoading ? "…" : stats.data?.pinnedConversations ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            <Trash2 className="h-3.5 w-3.5" /> Deleted
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {stats.isLoading ? "…" : stats.data?.deletedConversations ?? 0}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-4 text-sm outline-none transition placeholder:text-muted focus:border-primary"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Filter by engine mode"
            className="inline-flex items-center gap-1 rounded-xl border border-border bg-surface p-1"
          >
            {MODE_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={modeFilter === option.value}
                onClick={() => setModeFilter(option.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs transition focus-visible:ring-2 focus-visible:ring-primary",
                  modeFilter === option.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="sr-only" htmlFor="history-date-range">
            Date range
          </label>
          <select
            id="history-date-range"
            value={dateRange}
            onChange={(event) => setDateRange(event.target.value as DateRange)}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-xs outline-none transition focus:border-primary"
          >
            {DATE_RANGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="history-sort">
            Sort by
          </label>
          <select
            id="history-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="rounded-xl border border-border bg-surface px-3 py-2 text-xs outline-none transition focus:border-primary"
          >
            <option value="updated">Sort: recently updated</option>
            <option value="created">Sort: recently created</option>
            <option value="title">Sort: title</option>
          </select>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectMode((current) => !current);
                setSelected(new Set());
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs transition hover:bg-surface-hover",
                selectMode && "border-primary/50 bg-primary/5 text-foreground",
              )}
              aria-pressed={selectMode}
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {selectMode ? "Done" : "Select"}
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={clearAllMutation.isPending || items.length === 0}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs transition hover:bg-surface-hover disabled:opacity-50",
                confirmClearAll && "border-destructive/50 bg-destructive/10 text-destructive",
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmClearAll ? "Confirm delete all?" : "Delete all"}
            </button>
          </div>
        </div>

        {selectMode ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
            <p className="text-sm font-medium">
              {selectedItems.length} selected{items.length > 0 ? ` of ${items.length} shown` : ""}
            </p>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setSelected(isAllSelected ? new Set() : new Set(items.map((item) => item.id)))
                }
                className="rounded-lg px-2.5 py-1.5 text-xs transition hover:bg-surface-hover"
              >
                {isAllSelected ? "Clear all" : "Select all shown"}
              </button>
              <button
                type="button"
                onClick={() => void exportSelected()}
                disabled={selectedItems.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs transition hover:bg-surface-hover disabled:opacity-50"
              >
                <FileDown className="h-3.5 w-3.5" />
                Export
              </button>
              <button
                type="button"
                onClick={deleteSelected}
                disabled={deleteManyMutation.isPending || selectedItems.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/15 px-2.5 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/25 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          </div>
        ) : null}

        <p className="text-xs text-muted" aria-live="polite">
          {conversations.isLoading
            ? "Loading…"
            : `${items.length} conversation${items.length === 1 ? "" : "s"}${
                search ? " matching your search" : ""
              }`}
        </p>
      </div>

      {conversations.isLoading ? (
        <div className="mt-4">
          <SkeletonList rows={4} />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-8 flex flex-col items-center text-center">
          <MessageSquare className="h-10 w-10 text-muted" />
          <p className="mt-3 font-medium">
            {search || modeFilter !== "all" || dateRange !== "all"
              ? "No conversations match your filters"
              : "No conversations yet"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {search || modeFilter !== "all" || dateRange !== "all"
              ? "Try adjusting the filters."
              : "Start your first conversation to see it here."}
          </p>
          <button
            type="button"
            onClick={() => router.push("/chat")}
            className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
          >
            Start a conversation
          </button>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((conversation) => (
            <li
              key={conversation.id}
              role="button"
              tabIndex={0}
              aria-label={`Open conversation: ${conversation.title ?? "Untitled conversation"}`}
              className={cn(
                "group flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                selected.has(conversation.id) && "border-primary/50 bg-primary/5",
              )}
              onClick={() => {
                if (selectMode) {
                  toggleSelect(conversation.id);
                } else {
                  router.push(`/chat/${conversation.id}`);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  if (selectMode) {
                    toggleSelect(conversation.id);
                  } else {
                    router.push(`/chat/${conversation.id}`);
                  }
                }
              }}
            >
              {selectMode ? (
                <button
                  type="button"
                  aria-label={selected.has(conversation.id) ? "Deselect" : "Select"}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleSelect(conversation.id);
                  }}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border text-muted transition hover:border-primary"
                >
                  {selected.has(conversation.id) ? (
                    <CheckSquare className="h-4 w-4 text-primary" />
                  ) : null}
                </button>
              ) : null}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">
                    {conversation.title ?? "Untitled conversation"}
                  </p>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      conversation.mode === "AGENTIC"
                        ? "bg-accent/10 text-accent"
                        : "bg-surface-hover text-muted",
                    )}
                  >
                    {conversation.mode === "AGENTIC" ? (
                      <Zap className="h-2.5 w-2.5" />
                    ) : (
                      <BookOpen className="h-2.5 w-2.5" />
                    )}
                    {conversation.mode}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                  {conversation.preview || "No messages"}
                </p>
                <p className="mt-1 text-[10px] text-muted">
                  {formatRelativeTime(conversation.updatedAt)} · {conversation.messageCount}{" "}
                  {conversation.messageCount === 1 ? "message" : "messages"}
                </p>
              </div>

              {!selectMode ? (
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    type="button"
                    aria-label="Preview conversation"
                    title="Quick preview"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPreviewId(conversation.id);
                    }}
                    className="grid min-h-11 min-w-11 place-items-center rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-foreground"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Export conversation"
                    title="Export as Markdown"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleExport(conversation.id, conversation.title);
                    }}
                    className="grid min-h-11 min-w-11 place-items-center rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-foreground"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete conversation"
                    title="Delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteWithUndo(conversation);
                    }}
                    className="grid min-h-11 min-w-11 place-items-center rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div ref={loaderRef} className={cn("h-1", !conversations.hasNextPage && "hidden")} />

      {conversations.isFetchingNextPage && (
        <p className="py-4 text-center text-xs text-muted">Loading more…</p>
      )}

      {deleteManyMutation.isPending || clearAllMutation.isPending ? (
        <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          Deleting…
        </div>
      ) : null}

      {/* 7.5 — Quick-preview modal (no navigation required). */}
      <Dialog open={Boolean(previewId)} onOpenChange={(open) => !open && setPreviewId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate">
              {previewConversation?.title ?? "Untitled conversation"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {previewConversation
                ? `${previewConversation.mode} · ${previewConversation.messages.length} message${
                    previewConversation.messages.length === 1 ? "" : "s"
                  } · updated ${formatRelativeTime(previewConversation.updatedAt)}`
                : "Loading…"}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {preview.isLoading ? (
              <p className="py-8 text-center text-sm text-muted">Loading messages…</p>
            ) : previewConversation && previewConversation.messages.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">No messages in this conversation.</p>
            ) : (
              previewConversation?.messages.map((message) => (
                <div key={message.id} className="rounded-xl border border-border bg-background p-3">
                  <p
                    className={cn(
                      "mb-1 text-[10px] font-semibold uppercase tracking-wide",
                      message.role === "USER" ? "text-accent" : "text-primary",
                    )}
                  >
                    {message.role === "USER" ? "You" : "Behörden-Bot"}
                  </p>
                  <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed">
                    {message.content}
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              size="md"
              disabled={preview.isLoading || !previewConversation}
              onClick={() =>
                void handleExport(previewConversation?.id ?? "", previewConversation?.title ?? null)
              }
            >
              <Download className="mr-1.5 h-4 w-4" />
              Export
            </Button>
            <Button
              size="md"
              onClick={() => {
                const id = previewId;
                setPreviewId(null);
                if (id) {
                  router.push(`/chat/${id}`);
                }
              }}
            >
              Open conversation
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
