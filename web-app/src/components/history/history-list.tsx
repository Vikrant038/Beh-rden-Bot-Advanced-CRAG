"use client";

import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils";
import { useHistoryList, type ConversationItem, type ModeFilter } from "@/hooks/use-history-list";
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
import { SkeletonList } from "@/components/ui/skeleton";
import { RadioGroup } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function HistoryList() {
  const {
    searchInput,
    setSearchInput,
    modeFilter,
    setModeFilter,
    dateRange,
    setDateRange,
    sort,
    setSort,
    selectMode,
    setSelectMode,
    setSelected,
    toggleSelect,
    isAllSelected,
    confirmClearAll,
    previewId,
    setPreviewId,
    loaderRef,
    items,
    selectedItems,
    stats,
    conversations,
    preview,
    deleteManyMutation,
    clearAllMutation,
    deleteWithUndo,
    deleteSelected,
    handleClearAll,
    handleExport,
    exportSelected,
  } = useHistoryList();

  const MODE_FILTERS = [
    { value: "all" as const, label: "All" },
    { value: "agentic" as const, label: "Agentic" },
    { value: "standard" as const, label: "Standard" },
  ];

  const DATE_RANGES = [
    { value: "all" as const, label: "All time" },
    { value: "7d" as const, label: "Last 7 days" },
    { value: "30d" as const, label: "Last 30 days" },
  ];

  const previewConversation = preview.data;

  const statCards = [
    { icon: MessageSquare, label: "Conversations", value: stats.data?.totalConversations },
    { icon: MessagesSquare, label: "Messages", value: stats.data?.totalMessages },
    { icon: Pin, label: "Pinned", value: stats.data?.pinnedConversations },
    { icon: Trash2, label: "Deleted", value: stats.data?.deletedConversations },
  ];

  return (
    <div className="mt-6">
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statCards.map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-xl border border-border bg-surface p-3.5">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              <Icon className="h-3.5 w-3.5" /> {label}
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
              {stats.isLoading ? "…" : (value ?? 0)}
            </p>
          </div>
        ))}
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
          <RadioGroup
            label="Filter by engine mode"
            value={modeFilter}
            onValueChange={setModeFilter}
            className="w-full sm:w-auto"
            buttonClassName="min-h-11 flex-1 px-3 py-1.5 sm:flex-none"
            options={MODE_FILTERS.map((option) => ({
              value: option.value as ModeFilter,
              label: option.label,
            }))}
          />

          <label className="sr-only" htmlFor="history-date-range">
            Date range
          </label>
          <select
            id="history-date-range"
            value={dateRange}
            onChange={(event) => setDateRange(event.target.value as "all" | "7d" | "30d")}
            className="min-h-11 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-xs outline-none transition focus:border-primary sm:flex-none"
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
            onChange={(event) => setSort(event.target.value as "updated" | "created" | "title")}
            className="min-h-11 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-xs outline-none transition focus:border-primary sm:flex-none"
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
            : `${items.length} conversation${items.length === 1 ? "" : "s"}${searchInput ? " matching your search" : ""}`}
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
            {searchInput || modeFilter !== "all" || dateRange !== "all"
              ? "No conversations match your filters"
              : "No conversations yet"}
          </p>
          <p className="mt-1 text-sm text-muted">
            {searchInput || modeFilter !== "all" || dateRange !== "all"
              ? "Try adjusting the filters."
              : "Start your first conversation to see it here."}
          </p>
          <button
            type="button"
            onClick={() => (window.location.href = "/chat")}
            className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
          >
            Start a conversation
          </button>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((conversation) => (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              selectMode={selectMode}
              selected={selectedItems.some((item) => item.id === conversation.id)}
              onToggleSelect={() => toggleSelect(conversation.id)}
              onClick={() => (window.location.href = `/chat/${conversation.id}`)}
              onPreview={() => setPreviewId(conversation.id)}
              onExport={() => void handleExport(conversation.id, conversation.title)}
              onDelete={() => void deleteWithUndo(conversation)}
            />
          ))}
        </ul>
      )}

      <div ref={loaderRef} className={cn("h-1 pb-2", !conversations.hasNextPage && "hidden")} />

      {conversations.isFetchingNextPage && (
        <p className="py-4 text-center text-xs text-muted">Loading more…</p>
      )}

      {deleteManyMutation.isPending || clearAllMutation.isPending ? (
        <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted">
          <Loader2 className="h-3 w-3 animate-spin" />
          Deleting…
        </div>
      ) : null}

      {/* Quick-preview modal (no navigation required). */}
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
              <p className="py-8 text-center text-sm text-muted">
                No messages in this conversation.
              </p>
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
                  window.location.href = `/chat/${id}`;
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

function ConversationListItem({
  conversation,
  selectMode,
  selected,
  onToggleSelect,
  onClick,
  onPreview,
  onExport,
  onDelete,
}: {
  conversation: ConversationItem;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
  onPreview: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      role="button"
      tabIndex={0}
      aria-label={`Open conversation: ${conversation.title ?? "Untitled conversation"}`}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        selected && "border-primary/50 bg-primary/5",
      )}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      {selectMode ? (
        <button
          type="button"
          aria-label={selected ? "Deselect" : "Select"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect();
          }}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border text-muted transition hover:border-primary"
        >
          {selected ? <CheckSquare className="h-4 w-4 text-primary" /> : null}
        </button>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{conversation.title ?? "Untitled conversation"}</p>
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
        <div className="flex shrink-0 items-center gap-1 opacity-100 transition group-hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          {(
            [
              {
                label: "Preview conversation",
                title: "Quick preview",
                icon: Eye,
                action: onPreview,
                danger: false,
              },
              {
                label: "Export conversation",
                title: "Export as Markdown",
                icon: Download,
                action: onExport,
                danger: false,
              },
              {
                label: "Delete conversation",
                title: "Delete",
                icon: Trash2,
                action: onDelete,
                danger: true,
              },
            ] as const
          ).map(({ label, title, icon: Icon, action, danger }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              title={title}
              onClick={(event) => {
                event.stopPropagation();
                action();
              }}
              className={cn(
                "grid min-h-11 min-w-11 place-items-center rounded-lg p-2 text-muted transition hover:bg-surface-hover",
                danger ? "hover:text-destructive" : "hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      ) : null}
    </li>
  );
}
