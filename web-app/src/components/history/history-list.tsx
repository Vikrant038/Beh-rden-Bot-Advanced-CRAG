"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, MessageSquare, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/trpc/client";
import { formatRelativeTime, cn } from "@/lib/utils";

export function HistoryList() {
  const router = useRouter();
  const utils = api.useUtils();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const loaderRef = useRef<HTMLDivElement>(null);

  const deleteMutation = api.conversation.delete.useMutation();

  const conversations = api.conversation.list.useInfiniteQuery(
    { limit: 15, search: search || undefined },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
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

  const items = conversations.data?.pages.flatMap((page) => page.items) ?? [];

  const remove = (id: string) => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          void utils.conversation.list.invalidate();
        },
      },
    );
  };

  const handleExport = (id: string, title: string | null) => {
    void utils.conversation.export
      .fetch({ id })
      .then(({ markdown }) => {
        const blob = new Blob([markdown], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${title ?? "conversation"}.md`.replace(/[^a-z0-9-]+/gi, "-");
        link.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => {
        // Export failures are surfaced via react-query error state.
      });
  };

  return (
    <div className="mt-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setSearch(searchInput.trim());
            }
          }}
          placeholder="Search conversations…"
          className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-4 text-sm outline-none transition placeholder:text-muted focus:border-primary"
        />
      </div>

      {items.length === 0 && !conversations.isLoading ? (
        <div className="mt-16 flex flex-col items-center text-center">
          <MessageSquare className="h-10 w-10 text-muted" />
          <p className="mt-3 font-medium">No conversations found</p>
          <p className="mt-1 text-sm text-muted">
            {search
              ? "Try a different search term."
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
              className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition hover:border-primary/40"
              onClick={() => router.push(`/chat/${conversation.id}`)}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {conversation.title ?? "Untitled conversation"}
                </p>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                  {conversation.preview || "No messages"}
                </p>
                <p className="mt-1 text-[10px] text-muted">
                  {formatRelativeTime(conversation.updatedAt)} · {conversation.mode}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                <button
                  type="button"
                  aria-label="Export conversation"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleExport(conversation.id, conversation.title);
                  }}
                  className="rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-foreground"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Delete conversation"
                  onClick={(event) => {
                    event.stopPropagation();
                    remove(conversation.id);
                  }}
                  className="rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div ref={loaderRef} className={cn("h-1", !conversations.hasNextPage && "hidden")} />

      {conversations.isFetchingNextPage && (
        <p className="py-4 text-center text-xs text-muted">Loading more…</p>
      )}
    </div>
  );
}
