"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/router";
import { useDebouncedValue } from "@/hooks/use-debounce";
import { useToast } from "@/lib/toast";

export type ModeFilter = "all" | "standard" | "agentic";
export type DateRange = "all" | "7d" | "30d";
export type SortKey = "updated" | "created" | "title";

type RouterOutputs = inferRouterOutputs<AppRouter>;

/** Exported for consumers (history-list); inferred from the tRPC list page shape. */
export type ConversationItem = RouterOutputs["conversation"]["list"]["items"][number];

function withinRange(iso: string, range: DateRange): boolean {
  if (range === "all") {
    return true;
  }
  const days = range === "7d" ? 7 : 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(iso).getTime() >= cutoff;
}

function downloadMarkdown(markdown: string, filename: string) {
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const base = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
  const sanitized = base
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  link.download = `${sanitized || "export"}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

interface UseHistoryListReturn {
  // State
  searchInput: string;
  setSearchInput: (value: string) => void;
  search: string;
  modeFilter: ModeFilter;
  setModeFilter: (value: ModeFilter) => void;
  dateRange: DateRange;
  setDateRange: (value: DateRange) => void;
  sort: SortKey;
  setSort: (value: SortKey) => void;
  selectMode: boolean;
  setSelectMode: (value: boolean | ((current: boolean) => boolean)) => void;
  selected: Set<string>;
  setSelected: (value: Set<string> | ((current: Set<string>) => Set<string>)) => void;
  toggleSelect: (id: string) => void;
  isAllSelected: boolean;
  confirmClearAll: boolean;
  setConfirmClearAll: (value: boolean) => void;
  previewId: string | null;
  setPreviewId: (id: string | null) => void;
  loaderRef: React.RefObject<HTMLDivElement | null>;

  // Data
  items: ConversationItem[];
  selectedItems: ConversationItem[];
  stats: { isLoading: boolean; data: RouterOutputs["conversation"]["stats"] | undefined };
  conversations: {
    isLoading: boolean;
    isFetchingNextPage: boolean;
    hasNextPage: boolean;
    fetchNextPage: () => Promise<unknown>;
  };
  preview: { isLoading: boolean; data: RouterOutputs["conversation"]["getById"] | undefined };

  // Mutations
  deleteMutation: { mutateAsync: (args: { id: string }) => Promise<unknown>; isPending: boolean };
  deleteManyMutation: {
    mutate: (args: { ids: string[] }, options?: { onSuccess?: () => void }) => void;
    isPending: boolean;
  };
  clearAllMutation: {
    mutate: (
      args: { search?: string; mode?: "standard" | "agentic" | undefined; ids?: string[] },
      options?: { onSuccess?: (data: { deleted: number }) => void },
    ) => void;
    isPending: boolean;
  };
  restoreMutation: { mutate: (args: { id: string }, options?: { onSuccess?: () => void }) => void };

  // Actions
  refresh: () => void;
  deleteWithUndo: (conversation: { id: string; title: string | null }) => Promise<void>;
  deleteSelected: () => void;
  handleClearAll: () => void;
  handleExport: (id: string, title: string | null) => Promise<void>;
  exportSelected: () => Promise<void>;
}

export function useHistoryList(): UseHistoryListReturn {
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
  const [previewId, setPreviewId] = useState<string | null>(null);
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

  const refresh = useCallback(() => {
    void utils.conversation.list.invalidate();
    void utils.conversation.getById.invalidate();
  }, [utils]);

  const deleteWithUndo = useCallback(
    async (conversation: { id: string; title: string | null }) => {
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
    },
    [deleteMutation, refresh, restoreMutation, router, toast],
  );

  const deleteSelected = useCallback(() => {
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
  }, [selected, deleteManyMutation, refresh, setSelected, setSelectMode, toast]);

  const handleClearAll = useCallback(() => {
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
  }, [confirmClearAll, search, modeFilter, clearAllMutation, refresh, setConfirmClearAll, toast]);

  const handleExport = useCallback(
    async (id: string, title: string | null) => {
      try {
        const { markdown } = await utils.conversation.export.fetch({ id });
        downloadMarkdown(markdown, `${title ?? "conversation"}.md`);
      } catch {
        toast({ title: "Export failed", variant: "error" });
      }
    },
    [utils, toast],
  );

  const exportSelected = useCallback(async () => {
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
  }, [selectedItems, utils, toast]);

  const toggleSelect = useCallback(
    (id: string) => {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [setSelected],
  );

  return {
    // State
    searchInput,
    setSearchInput,
    search,
    modeFilter,
    setModeFilter,
    dateRange,
    setDateRange,
    sort,
    setSort,
    selectMode,
    setSelectMode,
    selected,
    setSelected,
    toggleSelect,
    isAllSelected,
    confirmClearAll,
    setConfirmClearAll,
    previewId,
    setPreviewId,
    loaderRef,

    // Data
    items,
    selectedItems,
    stats,
    conversations: {
      isLoading: conversations.isLoading,
      isFetchingNextPage: conversations.isFetchingNextPage,
      hasNextPage: conversations.hasNextPage,
      fetchNextPage: conversations.fetchNextPage,
    },
    preview: {
      isLoading: preview.isLoading,
      data: preview.data,
    },

    // Mutations
    deleteMutation,
    deleteManyMutation,
    clearAllMutation,
    restoreMutation,

    // Actions
    refresh,
    deleteWithUndo,
    deleteSelected,
    handleClearAll,
    handleExport,
    exportSelected,
  };
}
