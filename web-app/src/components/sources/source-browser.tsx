"use client";

import { useState } from "react";
import { ChevronRight, FileText, Search } from "lucide-react";
import { api } from "@/lib/trpc/client";
import { formatRelativeTime } from "@/lib/utils";

interface SourceListItem {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
}

export function SourceBrowser() {
  const [selected, setSelected] = useState<SourceListItem | null>(null);
  const [search, setSearch] = useState("");

  const documents = api.source.list.useQuery();
  const chunks = api.source.getChunks.useInfiniteQuery(
    { documentId: selected?.id ?? "", limit: 20 },
    {
      enabled: Boolean(selected),
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    },
  );

  const items =
    documents.data?.filter((document) =>
      document.title.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,320px)_1fr]">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search documents…"
            className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-4 text-sm outline-none transition placeholder:text-muted focus:border-primary"
          />
        </div>

        {documents.isLoading ? (
          <p className="animate-pulse px-2 text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-2 text-sm text-muted">No documents found.</p>
        ) : (
          <ul className="space-y-1">
            {items.map((document) => (
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
                  <FileText className="h-4 w-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate">{document.title}</span>
                  <span className="shrink-0 text-xs tabular-nums">{document.chunkCount}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        {!selected ? (
          <p className="py-16 text-center text-sm text-muted">
            Select a document to browse its indexed chunks.
          </p>
        ) : (
          <>
            <div className="mb-4">
              <h2 className="text-lg font-semibold">{selected.title}</h2>
              <p className="text-xs text-muted">
                {selected.chunkCount} chunks · updated {formatRelativeTime(selected.updatedAt)}
              </p>
            </div>
            {chunks.isLoading ? (
              <p className="animate-pulse text-sm text-muted">Loading chunks…</p>
            ) : (
              <ul className="space-y-3">
                {chunks.data?.pages
                  .flatMap((page) => page.items)
                  .map((chunk) => (
                    <li
                      key={chunk.id}
                      className="rounded-xl border border-border bg-background p-4"
                    >
                      <p className="text-sm leading-relaxed">{chunk.text}</p>
                      <p className="mt-2 text-[10px] text-muted">#{chunk.id}</p>
                    </li>
                  ))}
              </ul>
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
  );
}
