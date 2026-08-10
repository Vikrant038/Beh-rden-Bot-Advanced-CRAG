"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Eye,
  FileText,
  Link as LinkIcon,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
  UploadCloud,
} from "lucide-react";
import { api } from "@/lib/trpc/client";
import { formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/lib/toast";
type DocumentStatus = "PENDING" | "INGESTING" | "SYNCED" | "FAILED";

/**
 * `pdf://<hash>/<file>` pseudo-URLs have no resolvable host — a browser cannot
 * navigate to them, so they must never be rendered as a link. Only real
 * `http(s)://` URLs are clickable.
 */
function isLinkableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

interface DocumentItem {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
  status: DocumentStatus;
}

type SortKey = "updated" | "title" | "chunks";

const MAX_UI_PDF_MB = 4;
const POLL_INTERVAL_MS = 2500;

function IndeterminateBar({ label }: { label: string }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
        <div className="progress-indeterminate h-full w-1/3 rounded-full bg-primary" />
      </div>
    </div>
  );
}

function useChunkNavigator(count: number) {
  const [index, setIndex] = useState(0);
  return {
    index,
    // Clamp into [0, max(0, count - 1)] so an empty list never yields -1.
    clamp: (next: number) => setIndex(Math.min(Math.max(0, next), Math.max(0, count - 1))),
    select: setIndex,
  };
}

/**
 * 10.3 — Detail modal for a document: title/url/status plus its first chunks.
 */
function DocumentPreviewModal({
  document,
  onClose,
}: {
  document: DocumentItem;
  onClose: () => void;
}) {
  const chunks = api.source.getChunks.useInfiniteQuery(
    { documentId: document.id, limit: 10 },
    { getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined },
  );
  const items = chunks.data?.pages.flatMap((page) => page.items) ?? [];
  const [chunkViewMode, setChunkViewMode] = useState<"list" | "paginated">("list");
  const chunkNavigator = useChunkNavigator(items.length);

  useEffect(() => {
    if (chunkNavigator.index > Math.max(0, items.length - 1)) {
      chunkNavigator.select(Math.max(0, items.length - 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate">{document.title}</DialogTitle>
          <DialogDescription className="truncate">
            {isLinkableUrl(document.url) ? (
              <a
                href={document.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline-offset-2 hover:underline"
              >
                {document.url}
              </a>
            ) : (
              <span className="text-accent">{document.url || "no URL"}</span>
            )}
            {" · "}
            {document.chunkCount} child chunks · updated {formatRelativeTime(document.updatedAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-end gap-2">
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

        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {chunks.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              This document has no indexed chunks yet.
            </p>
          ) : (
            (chunkViewMode === "paginated" && items[chunkNavigator.index]
              ? [items[chunkNavigator.index]]
              : items
            ).map((chunk) => (
              <div
                key={chunk.id}
                id={`modal-chunk-${chunk.id}`}
                className="rounded-xl border border-border bg-background p-3"
              >
                <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed">
                  {chunk.text}
                </p>
                <p className="mt-1.5 text-[10px] text-muted">#{chunk.id}</p>
              </div>
            ))
          )}
        </div>
        {items.length > 1 ? (
          <div className="flex items-center justify-between gap-2 mt-2">
            <p className="text-xs text-muted" aria-live="polite">
              Chunk {chunkNavigator.index + 1} of {items.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const nextIndex = chunkNavigator.index - 1;
                  chunkNavigator.clamp(nextIndex);
                  if (chunkViewMode === "list" && items[Math.max(0, nextIndex)]) {
                    const el = window.document.getElementById(
                      `modal-chunk-${items[Math.max(0, nextIndex)].id}`,
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
                  if (chunkViewMode === "list" && items[Math.min(items.length - 1, nextIndex)]) {
                    const el = window.document.getElementById(
                      `modal-chunk-${items[Math.min(items.length - 1, nextIndex)].id}`,
                    );
                    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  }
                }}
                disabled={chunkNavigator.index >= items.length - 1}
                aria-label="Next chunk"
                className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-border text-muted transition hover:bg-surface-hover disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}
        {chunks.hasNextPage && (
          <button
            type="button"
            onClick={() => void chunks.fetchNextPage()}
            disabled={chunks.isFetchingNextPage}
            className="mt-3 w-full rounded-lg border border-border py-2 text-xs text-muted transition hover:bg-surface-hover disabled:opacity-60"
          >
            {chunks.isFetchingNextPage ? "Loading…" : "Load more chunks"}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DocumentManager() {
  const utils = api.useUtils();
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [ingestFeedback, setIngestFeedback] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfTitle, setPdfTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pdfFeedback, setPdfFeedback] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("updated");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocumentItem | null>(null);
  const [confirmClearCache, setConfirmClearCache] = useState(false);
  /** Job id being polled after a URL/PDF enqueue (null = not polling). */
  const [pollJobId, setPollJobId] = useState<string | null>(null);
  /** True while a sync-all is draining in the background queue. */
  const [syncPolling, setSyncPolling] = useState(false);

  const documents = api.source.list.useQuery();
  const ingestMutation = api.document.ingestUrl.useMutation();
  const syncMutation = api.document.sync.useMutation();
  const deleteMutation = api.document.delete.useMutation();
  const deleteManyMutation = api.document.deleteMany.useMutation();
  const clearCacheMutation = api.admin.clearCache.useMutation();
  const jobGetQuery = api.document.jobGet.useQuery(
    { id: pollJobId ?? "" },
    { enabled: pollJobId !== null, refetchInterval: POLL_INTERVAL_MS },
  );
  const jobStatsQuery = api.document.jobStats.useQuery(undefined, {
    enabled: syncPolling,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const refresh = useCallback(() => {
    void utils.source.list.refetch();
    void utils.admin.metrics.invalidate();
    void utils.admin.dailyQueries.invalidate();
    void utils.admin.modeSplit.invalidate();
    void utils.admin.recentQueries.invalidate();
  }, [utils]);

  // Poll a single enqueued URL/PDF job until it settles, then refresh + report.
  useEffect(() => {
    const job = jobGetQuery.data;
    if (!job) {
      return;
    }
    if (job.status === "DONE") {
      setPollJobId(null);
      refresh();
      const result = job.result as
        { title?: string; status?: string; chunkCount?: number; error?: string } | undefined;
      const feedback =
        result?.status === "failed"
          ? `Ingest failed: ${result.error ?? "unknown error"}`
          : `Ingested ${result?.title ?? "document"} → ${result?.status ?? "done"} (${result?.chunkCount ?? "?"} child chunks)`;
      if (job.type === "PDF") {
        setPdfFeedback(feedback);
      } else {
        setIngestFeedback(feedback);
      }
    } else if (job.status === "FAILED") {
      setPollJobId(null);
      refresh();
      const feedback = `Ingest failed: ${job.error ?? "unknown error"}`;
      if (job.type === "PDF") {
        setPdfFeedback(feedback);
      } else {
        setIngestFeedback(feedback);
      }
    }
  }, [jobGetQuery.data, refresh]);

  // A pruned job (completed >24 h ago) reads as NOT_FOUND — treat as done.
  // Transient errors (network blips) keep polling instead of abandoning.
  useEffect(() => {
    if (pollJobId === null || !jobGetQuery.isError) {
      return;
    }
    const code = (jobGetQuery.error as { data?: { code?: string } } | null)?.data?.code;
    if (code === "NOT_FOUND") {
      setPollJobId(null);
      refresh();
    }
  }, [pollJobId, jobGetQuery.isError, jobGetQuery.error, refresh]);

  // While a sync-all drains, poll queue depth and refresh once it is empty.
  useEffect(() => {
    if (!syncPolling) {
      return;
    }
    const stats = jobStatsQuery.data;
    if (stats && stats.queued === 0 && stats.running === 0) {
      setSyncPolling(false);
      refresh();
      setIngestFeedback("Sync finished — all queued documents processed.");
    }
  }, [syncPolling, jobStatsQuery.data, refresh]);

  const filtered = useMemo(() => {
    const base = documents.data ?? [];
    const searched = base.filter((document) =>
      document.title.toLowerCase().includes(search.trim().toLowerCase()),
    );
    return [...searched].sort((a, b) => {
      if (sort === "title") {
        return a.title.localeCompare(b.title);
      }
      if (sort === "chunks") {
        return b.chunkCount - a.chunkCount;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [documents.data, search, sort]);

  const isAllSelected = filtered.length > 0 && filtered.every((doc) => selected.has(doc.id));

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

  const toggleSelectAll = () => {
    setSelected(isAllSelected ? new Set() : new Set(filtered.map((doc) => doc.id)));
  };

  const handleIngest = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      return;
    }
    setIngestFeedback(null);
    ingestMutation.mutate(
      { url: trimmed, title: urlTitle.trim() || undefined },
      {
        onSuccess: (result) => {
          setUrl("");
          setUrlTitle("");
          setPollJobId(result.jobId);
          setIngestFeedback(
            result.queued
              ? "Enqueued — scraping & embedding in the background…"
              : "Already pending — watching the existing job…",
          );
        },
        onError: (error) => {
          setIngestFeedback(`Error: ${error.message}`);
        },
      },
    );
  };

  const handleSync = () => {
    syncMutation.mutate(
      { force: false },
      {
        onSuccess: (result) => {
          setIngestFeedback(
            result.enqueued > 0
              ? `Sync started: ${result.enqueued} jobs enqueued` +
                  (result.alreadyPending > 0 ? ` (${result.alreadyPending} already pending)` : "") +
                  "."
              : "Nothing to do: every document already has a pending job.",
          );
          setSyncPolling(true);
        },
      },
    );
  };

  const handleDelete = (document: DocumentItem) => {
    deleteMutation.mutate(
      { id: document.id },
      {
        onSuccess: () => {
          setSelected((current) => {
            const next = new Set(current);
            next.delete(document.id);
            return next;
          });
          refresh();
        },
      },
    );
  };

  const handleBulkDelete = () => {
    const ids = [...selected];
    if (ids.length === 0) {
      return;
    }
    deleteManyMutation.mutate(
      { ids },
      {
        onSuccess: () => {
          setSelected(new Set());
          setConfirmBulkDelete(false);
          toast({ title: `${ids.length} documents deleted`, variant: "success" });
          refresh();
        },
        onError: (error) => {
          toast({ title: `Could not delete: ${error.message}`, variant: "error" });
        },
      },
    );
  };

  const handleClearCache = () => {
    clearCacheMutation.mutate(undefined, {
      onSuccess: () => {
        setConfirmClearCache(false);
        toast({ title: "Semantic cache cleared", variant: "success" });
        refresh();
      },
      onError: () => toast({ title: "Could not clear cache", variant: "error" }),
    });
  };

  const acceptPdf = (file: File | undefined | null): boolean => {
    if (!file) {
      return false;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setPdfFeedback("Only .pdf files are accepted.");
      return false;
    }
    if (file.size === 0) {
      setPdfFeedback("File is empty.");
      return false;
    }
    if (file.size > MAX_UI_PDF_MB * 1024 * 1024) {
      setPdfFeedback(`File exceeds the ${MAX_UI_PDF_MB} MB limit.`);
      return false;
    }
    setPdfFile(file);
    setPdfFeedback(null);
    return true;
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    acceptPdf(event.dataTransfer.files?.[0]);
  };

  const uploadPdf = () => {
    if (!pdfFile || uploading) {
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setPdfFeedback(null);
    const body = new FormData();
    body.append("file", pdfFile);
    if (pdfTitle.trim()) {
      body.append("title", pdfTitle.trim().slice(0, 200));
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/documents/upload");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        setUploadProgress(Math.round((event.loaded / event.total) * 90));
      }
    });
    xhr.addEventListener("load", () => {
      let json: { jobId?: string; status?: string; error?: string } = {};
      try {
        json = JSON.parse(xhr.responseText) as typeof json;
      } catch {
        json = {};
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        setPdfFeedback(`Upload failed: ${json.error ?? xhr.statusText}`);
        setUploading(false);
        setUploadProgress(0);
        return;
      }
      if (json.jobId) {
        setUploadProgress(100);
        setPdfFeedback("Uploaded — parsing & embedding in the background…");
        setPdfFile(null);
        setPdfTitle("");
        setUploading(false);
        window.setTimeout(() => setUploadProgress(0), 1200);
        setPollJobId(json.jobId);
      } else {
        setPdfFeedback(`Unexpected response from server (${xhr.status}).`);
        setUploading(false);
        setUploadProgress(0);
      }
    });
    xhr.addEventListener("error", () => {
      setPdfFeedback("Network error during upload. Please retry.");
      setUploading(false);
      setUploadProgress(0);
    });
    xhr.send(body);
  };

  const busy = ingestMutation.isPending || syncMutation.isPending || deleteMutation.isPending;
  const syncPending = syncMutation.isPending || syncPolling;
  const uploadPercentLabel =
    uploadProgress >= 100 ? "100%" : uploadProgress > 0 ? `${uploadProgress}%` : null;

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Ingest a URL</h2>
        <p className="mb-3 text-xs text-muted">
          Scrape, parent-child chunk (2000/200 parents, 200/50 children), embed, and store a
          document into the knowledge base.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <LinkIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleIngest();
                }
              }}
              placeholder="https://www.uni-assist.de/…"
              className="min-h-12 w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-4 text-sm outline-none transition placeholder:text-muted focus:border-primary focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <button
            type="button"
            onClick={handleIngest}
            disabled={busy || !url.trim()}
            className="min-h-12 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
          >
            Ingest
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={busy}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm transition hover:bg-surface-hover active:scale-[0.98] disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${syncPending ? "animate-spin" : ""}`} />
            {syncPending ? "Syncing…" : "Sync all"}
          </button>
        </div>
        <input
          type="text"
          value={urlTitle}
          onChange={(event) => setUrlTitle(event.target.value)}
          placeholder="Display name (optional) — defaults to the page title"
          aria-label="Optional display name"
          className="mt-2 min-h-11 w-full rounded-xl border border-border bg-background px-4 py-2 text-sm outline-none transition placeholder:text-muted focus:border-primary focus-visible:ring-2 focus-visible:ring-primary"
        />
        {syncPending ? <IndeterminateBar label="Syncing all documents…" /> : null}
        {/* 10.2 — URL ingest now shows a progress bar while its job is polled. */}
        {ingestMutation.isPending || pollJobId !== null ? (
          <IndeterminateBar label="Ingesting URL…" />
        ) : null}
        {ingestFeedback && (
          <p
            className={cn(
              "mt-3 text-xs",
              ingestFeedback.startsWith("Failed") ||
                ingestFeedback.startsWith("Unsupported") ||
                ingestFeedback.startsWith("Error")
                ? "text-destructive"
                : "text-muted",
            )}
          >
            {ingestFeedback}
          </p>
        )}
        {ingestMutation.isError && (
          <p className="mt-3 text-xs text-destructive">{ingestMutation.error.message}</p>
        )}
      </div>

      <div className="glass-card rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Upload a PDF</h2>
        <p className="mb-3 text-xs text-muted">
          ADMIN-only. Parse, parent-child chunk, embed, and store a text-based PDF into the
          knowledge base.
        </p>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "relative flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition",
            dragging
              ? "border-primary/70 bg-primary/5"
              : "border-glass-border hover:border-primary/60",
          )}
        >
          <UploadCloud className="h-8 w-8 text-muted" />
          <p className="text-sm font-medium">Drag & drop a PDF here</p>
          <p className="text-xs text-muted">or</p>
          <label className="cursor-pointer rounded-xl bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover">
            Browse files
            <input
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(event) => acceptPdf(event.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-xs text-muted">
            Up to 4 MB — text-based PDFs only (scanned pages cannot be read)
          </p>
          {pdfFile && !uploading && (
            <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={pdfTitle}
                onChange={(event) => setPdfTitle(event.target.value)}
                placeholder="Display name (optional)"
                aria-label="Optional display name"
                className="w-full flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none transition placeholder:text-muted focus:border-primary"
              />
              <button
                type="button"
                onClick={uploadPdf}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover active:scale-[0.98]"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                Upload {pdfFile.name}
              </button>
            </div>
          )}
          {uploading ? (
            <div className="w-full max-w-xs">
              <div className="flex items-center justify-between text-[10px] text-muted">
                <span>Uploading…</span>
                <span className="tabular-nums">{uploadPercentLabel ?? "…"}</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-150"
                  style={{ width: `${Math.max(4, uploadProgress)}%` }}
                />
              </div>
            </div>
          ) : null}
          {pdfFeedback && (
            <p
              className={cn(
                "text-xs",
                pdfFeedback.startsWith("Ingested") ? "text-muted" : "text-destructive",
              )}
            >
              {pdfFeedback}
            </p>
          )}

          {/* 10.8 — Full drag & drop overlay */}
          {dragging ? (
            <div
              className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-primary bg-background/80 backdrop-blur-sm"
              aria-hidden="true"
            >
              <UploadCloud className="h-10 w-10 text-primary" />
              <p className="text-sm font-semibold">Drop to upload</p>
              <p className="text-xs text-muted">PDF up to 4 MB</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <h2 className="shrink-0 text-sm font-semibold">
            Knowledge base ({filtered.length}/{documents.data?.length ?? 0} documents)
          </h2>
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter documents…"
              aria-label="Filter documents"
              className="w-full rounded-xl border border-border bg-background py-2 pl-8 pr-3 text-sm outline-none transition placeholder:text-muted focus:border-primary"
            />
          </div>
          {/* 10.6 — Sort control */}
          <label className="sr-only" htmlFor="document-sort">
            Sort documents
          </label>
          <select
            id="document-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="rounded-xl border border-border bg-background px-3 py-2 text-xs outline-none transition focus:border-primary"
          >
            <option value="updated">Sort: recently updated</option>
            <option value="title">Sort: title</option>
            <option value="chunks">Sort: most chunks</option>
          </select>
        </div>
        <div className="flex items-center gap-3">
          {/* 10.4 — Bulk delete entry point */}
          {selected.size > 0 ? (
            <button
              type="button"
              onClick={() => setConfirmBulkDelete(true)}
              disabled={deleteManyMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-destructive/15 px-3 py-2 text-xs font-medium text-destructive transition hover:bg-destructive/25 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete selected ({selected.size})
            </button>
          ) : null}
          {/* 10.9 — Clear cache via confirmation dialog (replaces two-click inline) */}
          <button
            type="button"
            onClick={() => setConfirmClearCache(true)}
            disabled={clearCacheMutation.isPending}
            className="text-xs text-muted underline-offset-2 transition hover:text-destructive hover:underline"
          >
            {clearCacheMutation.isPending ? "Clearing…" : "Clear semantic cache"}
          </button>
        </div>
      </div>

      {documents.isLoading ? (
        <p className="animate-pulse text-sm text-muted">Loading documents…</p>
      ) : documents.data?.length === 0 ? (
        <div className="glass-card flex flex-col items-center rounded-2xl border border-dashed py-12 text-center">
          <FileText className="h-8 w-8 text-muted" />
          <p className="mt-2 text-sm font-medium">No documents ingested yet</p>
          <p className="mt-1 text-xs text-muted">
            Add a URL or upload a PDF above to seed the knowledge base.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-card flex flex-col items-center rounded-2xl border border-dashed py-12 text-center">
          <Search className="h-8 w-8 text-muted" />
          <p className="mt-2 text-sm font-medium">No documents match your filter</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((document) => {
            const checked = selected.has(document.id);
            return (
              <li
                key={document.id}
                className={cn(
                  "glass-card group flex flex-wrap items-center gap-3 rounded-xl px-4 py-3",
                  checked && "border-primary/50",
                )}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={`Select ${document.title}`}
                  onClick={() => toggleSelect(document.id)}
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-md border transition",
                    checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:border-primary",
                  )}
                >
                  {checked ? <CheckCircle2 className="h-4 w-4" /> : null}
                </button>
                <FileText className="h-4 w-4 shrink-0 text-accent" />
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex items-center gap-2">
                    <p className="line-clamp-2 font-medium">{document.title}</p>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        document.status === "SYNCED" && "bg-success/10 text-success",
                        document.status === "FAILED" && "bg-destructive/10 text-destructive",
                        (document.status === "INGESTING" || document.status === "PENDING") &&
                          "bg-warning/10 text-warning",
                      )}
                    >
                      {document.status === "SYNCED" ? (
                        <CheckCircle2 className="h-2.5 w-2.5" />
                      ) : document.status === "FAILED" ? (
                        <TriangleAlert className="h-2.5 w-2.5" />
                      ) : (
                        <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                      )}
                      {document.status === "SYNCED"
                        ? "synced"
                        : document.status === "FAILED"
                          ? "failed"
                          : "ingesting"}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted">
                    {isLinkableUrl(document.url) ? (
                      <a
                        href={document.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {document.url}
                      </a>
                    ) : (
                      <span>{document.url || "no URL"}</span>
                    )}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-3 text-xs text-muted sm:gap-4">
                  <span className="tabular-nums">{document.chunkCount} child chunks</span>
                  <span className="hidden sm:inline">{formatRelativeTime(document.updatedAt)}</span>
                  <button
                    type="button"
                    aria-label={`Preview ${document.title}`}
                    title="Preview chunks"
                    onClick={() => setPreviewDoc(document)}
                    className="grid min-h-11 min-w-11 place-items-center rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-foreground"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${document.title}`}
                    onClick={() => handleDelete(document)}
                    disabled={deleteMutation.isPending}
                    className="grid min-h-11 min-w-11 place-items-center rounded-lg p-2 text-muted transition hover:bg-surface-hover hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {selected.size > 0 ? `${selected.size} selected` : `${filtered.length} documents`}
        </span>
        {filtered.length > 0 ? (
          <button
            type="button"
            onClick={toggleSelectAll}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 transition hover:bg-surface-hover"
          >
            {isAllSelected ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {isAllSelected ? "Clear all" : "Select all"}
          </button>
        ) : null}
      </div>

      {/* 10.4 — Bulk delete confirmation */}
      <ConfirmDialog
        open={confirmBulkDelete}
        onOpenChange={setConfirmBulkDelete}
        title={`Delete ${selected.size} documents?`}
        description="The documents and all their chunks will be permanently removed and the semantic cache invalidated. This cannot be undone."
        confirmLabel={`Delete ${selected.size}`}
        isPending={deleteManyMutation.isPending}
        onConfirm={handleBulkDelete}
      />

      {/* 10.9 — Clear cache confirmation */}
      <ConfirmDialog
        open={confirmClearCache}
        onOpenChange={setConfirmClearCache}
        title="Clear semantic cache?"
        description="All cached answers will be evicted and the next matching queries will run the full pipeline again. This cannot be undone."
        confirmLabel="Clear cache"
        isPending={clearCacheMutation.isPending}
        onConfirm={handleClearCache}
      />

      {previewDoc ? (
        <DocumentPreviewModal document={previewDoc} onClose={() => setPreviewDoc(null)} />
      ) : null}
    </div>
  );
}
