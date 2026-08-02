"use client";

import { useState } from "react";
import { FileText, Link as LinkIcon, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { api } from "@/lib/trpc/client";
import { formatRelativeTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface DocumentItem {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  chunkCount: number;
}

const MAX_UI_PDF_MB = 4;

export function DocumentManager() {
  const utils = api.useUtils();
  const [url, setUrl] = useState("");
  const [ingestFeedback, setIngestFeedback] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pdfFeedback, setPdfFeedback] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const documents = api.source.list.useQuery();
  const ingestMutation = api.document.ingestUrl.useMutation();
  const syncMutation = api.document.sync.useMutation();
  const deleteMutation = api.document.delete.useMutation();
  const clearCacheMutation = api.admin.clearCache.useMutation();

  const refresh = () => {
    void utils.source.list.invalidate();
    void utils.admin.metrics.invalidate();
    void utils.admin.dailyQueries.invalidate();
    void utils.admin.modeSplit.invalidate();
    void utils.admin.recentQueries.invalidate();
  };

  const handleIngest = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      return;
    }
    setIngestFeedback(null);
    ingestMutation.mutate(
      { url: trimmed },
      {
        onSuccess: (result) => {
          setUrl("");
          const isContentType = result.error?.toLowerCase().includes("content type");
          setIngestFeedback(
            result.status === "failed"
              ? isContentType
                ? "Unsupported file type — only HTML or plain-text URLs can be ingested."
                : `Failed: ${result.error ?? "unknown error"}`
              : `${result.title} → ${result.status} (${result.chunkCount} child chunks${result.parentCount ? `, ${result.parentCount} parents` : ""})`,
          );
          refresh();
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
          const skipped = result.results.filter((r) => r.status === "skipped").length;
          setIngestFeedback(`Sync complete: ${result.failed} failed, ${skipped} unchanged.`);
          refresh();
        },
      },
    );
  };

  const handleDelete = (document: DocumentItem) => {
    deleteMutation.mutate(
      { id: document.id },
      {
        onSuccess: () => refresh(),
      },
    );
  };

  const handleClearCache = () => {
    clearCacheMutation.mutate(undefined, {
      onSuccess: () => refresh(),
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

  const uploadPdf = async () => {
    if (!pdfFile || uploading) {
      return;
    }
    setUploading(true);
    setPdfFeedback(null);
    const body = new FormData();
    body.append("file", pdfFile);
    try {
      const res = await fetch("/api/admin/documents/upload", { method: "POST", body });
      const json = (await res.json()) as { status?: string; error?: string; chunkCount?: number };
      if (!res.ok) {
        setPdfFeedback(`Upload failed: ${json.error ?? res.statusText}`);
        return;
      }
      setPdfFeedback(
        json.status === "failed"
          ? `Ingest failed: ${json.error ?? "unknown error"}`
          : `Ingested ${pdfFile.name} → ${json.status} (${json.chunkCount ?? "?"} child chunks)`,
      );
      setPdfFile(null);
      refresh();
    } catch {
      setPdfFeedback("Network error during upload. Please retry.");
    } finally {
      setUploading(false);
    }
  };

  const busy = ingestMutation.isPending || syncMutation.isPending || deleteMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-2xl p-5">
        <h2 className="text-sm font-semibold">Ingest a URL</h2>
        <p className="mb-3 text-xs text-muted">
          Scrape, parent-child chunk (2000/200 parents, 200/50 children), embed, and store a
          document into the knowledge base.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
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
              className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-4 text-sm outline-none transition placeholder:text-muted focus:border-primary focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>
          <button
            type="button"
            onClick={handleIngest}
            disabled={busy || !url.trim()}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
          >
            Ingest
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm transition hover:bg-surface-hover active:scale-[0.98] disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            Sync all
          </button>
        </div>
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
            "flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition",
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
          {pdfFile && (
            <button
              type="button"
              onClick={uploadPdf}
              disabled={uploading}
              className="text-xs text-accent underline-offset-2 hover:underline"
            >
              {uploading ? "Uploading & embedding…" : `Upload ${pdfFile.name}`}
            </button>
          )}
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
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Knowledge base ({documents.data?.length ?? 0} documents)
        </h2>
        <button
          type="button"
          onClick={handleClearCache}
          disabled={clearCacheMutation.isPending}
          className="text-xs text-muted underline-offset-2 transition hover:text-destructive hover:underline"
        >
          Clear semantic cache
        </button>
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
      ) : (
        <ul className="space-y-2">
          {documents.data?.map((document) => (
            <li
              key={document.id}
              className="glass-card group flex items-center gap-3 rounded-xl px-4 py-3"
            >
              <FileText className="h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{document.title}</p>
                <p className="truncate text-xs text-muted">
                  <a
                    href={document.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {document.url || "no URL"}
                  </a>
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-4 text-xs text-muted">
                <span className="tabular-nums">{document.chunkCount} child chunks</span>
                <span className="hidden sm:inline">{formatRelativeTime(document.updatedAt)}</span>
                <button
                  type="button"
                  aria-label={`Delete ${document.title}`}
                  onClick={() => handleDelete(document)}
                  disabled={deleteMutation.isPending}
                  className="rounded-lg p-1.5 text-muted transition hover:bg-surface-hover hover:text-destructive focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
