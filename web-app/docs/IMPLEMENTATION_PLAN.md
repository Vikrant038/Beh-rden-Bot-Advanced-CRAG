# Behoerden-Bot — Development Implementation Plan

> **Phase:** D/E — Global UI Overhaul, URL Validation Hardening, PDF Ingestion, Parent-Child Chunking, Pipeline Visualizer
> **Author:** Senior Full-Stack Architect review
> **Status:** IN EXECUTION
> **Stack (verified against codebase):** Next.js 15.5 (App Router, Turbopack), TypeScript, tRPC v11, Tailwind CSS v4 (CSS-first `@theme` tokens), Prisma + pgvector, NextAuth v5, pnpm.

---

## Execution Status (live)

| Phase | Scope | Status | Notes |
|-------|-------|--------|-------|
| Phase 0 | URL content-type validation, domain errors, tRPC plumbing | ✅ Done | Verified: typecheck/lint/tests green |
| Phase 1 | Parent-child chunking + PDF ingestion | ✅ Done | Migration handwritten, **unverified against real pgvector DB** (no DB in sandbox) |
| Phase 2 | Global UI overhaul (dual palettes, glass, mesh, landing, edge states) | ✅ Done | Verified: typecheck/lint/tests/build green (236 tests) |
| Phase 3 | Pipeline visualizer (`admin.testPipeline`, page, stage components) | ✅ Done | Verified: typecheck/lint/tests/build green (242 tests) |
| Phase 4 | Tests & CI hardening (unit + e2e) | ✅ Done | Verified: 280 tests / 41 files; e2e specs compile (21/6), execution pending live DB |

**Live progress doc:** `docs/status/phase-f-ui-pdf-chunking-visualizer.md`

---

## 0. Decisions on Open Questions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | PDF file size limit | **4 MiB (4,194,304 B) server cap; 4 MB client mirror** | Vercel serverless rejects request bodies > **4.5 MB** *before* your handler runs. 4 MiB is the largest Vercel-safe value. A single number everywhere — no 5 MB / 4 MiB split. See §4.1. |
| 2 | PDF ingestion users | **ADMIN-only** | Ingestion mutates the shared knowledge base (re-embeds, invalidates semantic cache + corpus). Standard users have no legitimate need; ADMIN-only removes a whole class of abuse / cost-amplification vectors. Escalate later via a `role` gate in the route handler only. |
| 3 | Chunking strategy | **True Parent-Child Chunking** (Document → ParentChunk 2000 ch → ChildChunk 200 ch) **with overlap at both levels**; requires a Prisma migration, a second (child-only) embedding pass, and parent-expansion join logic in retrieval | Child chunks (~200 ch) are embedded and searched for precision; on a child match the system fetches its parent (~2000 ch) and hands the *parent* to the LLM for context. This gives precise search + rich context. Full spec in §2.5. |
| 4 | UI aesthetic | **Two fully distinct palettes** — warm "paper & ink" light theme vs. deep "midnight" dark theme — glassmorphism + animated mesh in both, with a dedicated edge-case handling section | The current repo reuses the same hue family in both modes. We define two independent color systems (surfaces, accents, glass, shadows, mesh gradients) and explicitly design loading / empty / error / motion / contrast edge cases. §2.4. |

---

## 1. Phase Breakdown & Timeline

| Phase | Scope | Deliverables | Effort (dev-days) |
|-------|-------|--------------|-------------------|
| **Phase 0 — Foundation / Security** | Strict URL content-type validation, new domain errors, tRPC error plumbing | `InvalidContentTypeError`, hardened `scraper.ts`, UI error feedback | 0.5–1 |
| **Phase 1 — Parent-Child Chunking + PDF Ingestion** | Prisma migration, two-level chunker, child-only embedding pass, parent-expansion join, `pdf-parse` parser, upload route, dropzone | migration, `chunker.ts` v2, `retrieval/join.ts`, `pdf-parser.ts`, `ingestPdf()`, upload route, dropzone | 4–6 |
| **Phase 2 — UI Overhaul** | Two distinct light/dark palettes, glassmorphism system, animated mesh, micro-interactions, landing content sections, edge-case states | Updated `globals.css` (dual `@theme`), `app/page.tsx`, shared primitives, loading/empty/error components | 3–4 |
| **Phase 3 — Pipeline Visualizer** | `admin.testPipeline` tRPC endpoint, trace enrichment, GitHub-Actions-style page (child→parent expansion visible) | `pipeline-tester` page, stage components, admin nav item | 2–3 |
| **Phase 4 — Tests & CI hardening** | Unit tests (parser, chunker, join, scraper, router), e2e, docs | Tests + CI wiring | 1–2 |
| **Total** | | | **11–16 dev-days** |

Phase 0 and Phase 1 (data layer) land before Phase 3, because the visualizer must render the parent-expanded trace. Phase 2 (UI) can proceed in parallel with Phase 1 once the token system is settled.

---

## 2. Detailed Technical Specifications

### 2.1 Feature B — URL Content-Type Validation (Security)

**Current bug:** `src/server/ingest/scraper.ts:39-45` logs a warning on unexpected content types but continues to parse. A URL returning `application/octet-stream` or an HTML page that 302-redirects to a binary is still processed.

#### 2.1.1 Files to modify

| File | Change |
|------|--------|
| `src/server/lib/errors/codes.ts` | Add `INVALID_CONTENT_TYPE = "INVALID_CONTENT_TYPE"` + HTTP mapping `415` |
| `src/server/lib/errors/domain-error.ts` | Add `InvalidContentTypeError extends DomainError` |
| `src/server/ingest/scraper.ts` | Replace warn-and-continue with strict abort |
| `src/components/admin/document-manager.tsx` | Render typed error feedback |

#### 2.1.2 Code skeleton — error class

```ts
// src/server/lib/errors/domain-error.ts
export class InvalidContentTypeError extends DomainError {
  constructor(url: string, contentType: string) {
    super(
      `URL ${url} returned unsupported content type "${contentType}". ` +
        `Only text/html and text/plain documents can be ingested.`,
      ErrorCode.INVALID_CONTENT_TYPE,
    );
  }
}
```

```ts
// src/server/lib/errors/codes.ts — add to enum + status map
INVALID_CONTENT_TYPE = "INVALID_CONTENT_TYPE",

// errorStatusMap
[ErrorCode.INVALID_CONTENT_TYPE]: 415,
```

#### 2.1.3 Implementation logic — hardened fetch

```ts
const ALLOWED_CONTENT_TYPES = new Set(["text/html", "text/plain"]);

function assertSupportedContentType(url: string, contentType: string | null): void {
  const mime = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_CONTENT_TYPES.has(mime)) {
    throw new InvalidContentTypeError(url, contentType ?? "(missing)");
  }
}

// In scrapeWebPage(), replacing the warn block at lines 39-45:
const contentType = response.headers.get("content-type");
assertSupportedContentType(trimmedUrl, contentType);   // aborts immediately
```

Step-by-step pseudo-code for `scrapeWebPage`:

1. `trimmedUrl = rawUrl.trim()`; `await assertSafeUrl(trimmedUrl)` (SSRF guard — unchanged).
2. `fetchWithTimeout(trimmedUrl)` — unchanged (`redirect: "follow"`, 20 s timeout).
3. If `!response.ok` → `ExternalApiError` (unchanged).
4. **NEW:** `assertSupportedContentType()` → on failure throw `InvalidContentTypeError` (415). This rejects script, binaries, JSON, images, `application/pdf`, and missing headers.
5. **NEW:** post-redirect SSRF re-validation — `await assertSafeUrl(response.url)` (closes DNS-rebinding / redirect-to-internal-host gap, see §4.3).
6. Guard against content-length bombs: reject if `Content-Length > MAX_SCRAPE_BYTES` before calling `.text()`.
7. Extract, enforce `MIN_CONTENT_CHARS`, return `ScrapedDocument`.

**tRPC error plumbing (already works, no change needed):** `t.ts:8-18` `errorFormatter` reads `error.cause instanceof DomainError` and surfaces `code` as `data.code`. `ingestUrl` catches scrape errors and returns `{ status: "failed", error: message }`, which `document-manager.tsx` already renders via `result.error`.

#### 2.1.4 UI feedback

In `handleIngest`'s `onSuccess`, color the feedback line red when `result.status === "failed"` and inspect `result.error`; when the error string contains `content type`, render a friendly hint:

```tsx
const isContentType = result.error?.toLowerCase().includes("content type");
// feedback line:
<p className={cn("mt-3 text-xs", isContentType ? "text-destructive" : "text-muted")}>
  {isContentType ? "Unsupported file type — only HTML or plain-text URLs can be ingested." : feedback}
</p>
```

---

### 2.2 Feature C — PDF Ingestion Support

#### 2.2.1 Files to create / modify

| File | Action |
|------|--------|
| `src/server/ingest/pdf-parser.ts` | **Create** — raw-text extraction via `pdf-parse` |
| `src/server/ingest/pipeline.ts` | **Modify** — add `ingestPdf()`, route through parent-child chunking |
| `src/app/api/admin/documents/upload/route.ts` | **Create** — `multipart/form-data` upload endpoint |
| `src/components/admin/document-manager.tsx` | **Modify** — `.pdf` drag-and-drop zone |
| `next.config.ts` | **Modify** — `serverExternalPackages: ["pdf-parse"]` |

#### 2.2.2 PDF parser — `pdf-parser.ts`

```ts
// src/server/ingest/pdf-parser.ts
import { PdfParseError } from "@/server/lib/errors";

export const MAX_PDF_PAGES = 200;

export interface ParsedPdf {
  text: string;
  pages: number;
  metadata: Record<string, unknown>;
}

/**
 * Extracts raw text from an in-memory PDF buffer using pdf-parse.
 * Imported from the lib entry point to avoid the upstream module-load bug
 * where index.js tries to fs.readFile('test/data/05-versions-space.pdf').
 */
export async function parsePdf(buffer: Buffer): Promise<ParsedPdf> {
  if (buffer.length === 0) {
    throw new PdfParseError("Empty PDF buffer");
  }
  let pdfParse: (data: Buffer, opts?: unknown) => Promise<ParsedPdf>;
  try {
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    pdfParse = mod.default;
  } catch {
    throw new PdfParseError("pdf-parse failed to initialize (missing dependency?)");
  }

  try {
    const result = await pdfParse(buffer);
    if (!result.text || result.text.trim().length === 0) {
      throw new PdfParseError("PDF contains no extractable text (scanned/image-only?)");
    }
    if (result.pages > MAX_PDF_PAGES) {
      throw new PdfParseError(`PDF exceeds ${MAX_PDF_PAGES} pages`);
    }
    return result;
  } catch (error) {
    if (error instanceof PdfParseError) throw error;
    throw new PdfParseError(`PDF parse failed: ${String(error)}`);
  }
}
```

Add `PdfParseError` + `ErrorCode.PDF_PARSE_FAILED` (map to 422) alongside the Feature B error additions. **Gotcha:** `pdf-parse@1.1.1`'s `index.js` performs a top-level `fs.readFileSync` on a test fixture; importing `pdf-parse/lib/pdf-parse.js` bypasses it. This is required for the Next.js/Vercel serverless runtime.

#### 2.2.3 Pipeline — `ingestPdf()`

Refactor: extract the shared "clean → hash → idempotency → parent-child chunk → child-embed → store → invalidate" tail of `ingestUrlInner` into a private `persistIngested(sourceKey, title, cleaned, options)` helper, then:

```ts
// src/server/ingest/pipeline.ts
export interface PdfIngestResult extends IngestResult {
  filename: string;
}

export function pdfSourceKey(buffer: Buffer, filename: string): string {
  const digest = createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const safeName = filename.replace(/[^\w.\-]+/g, "_").toLowerCase();
  return `pdf://${digest}/${safeName}`;
}

export async function ingestPdf(
  buffer: Buffer,
  filename: string,
  options: IngestOptions = {},
): Promise<PdfIngestResult> {
  return runWithTrace(
    { name: "ingest-pdf", metadata: { filename }, input: filename },
    async () => {
      const parsed = await parsePdf(buffer);
      const cleaned = cleanText(parsed.text);
      const url = pdfSourceKey(buffer, filename);
      const result = await persistIngested(url, filename, cleaned, options);
      return { ...result, filename };
    },
  );
}
```

Step-by-step pseudo-code for `persistIngested` (uses the parent-child pipeline from §2.5):

1. `hash = sha256(cleaned)`.
2. `existing = prisma.document.findUnique({ where: { url } })`.
3. If `existing.hash === hash && !force` → return `status: "skipped"` (idempotent re-upload).
4. `structure = chunkParentChild(cleaned)` (see §2.5) — if no usable parents → `status: "failed"`.
5. `childTexts = structure.flatMap(p => p.children.map(c => c.text))`; embed **children only** (the second, precision pass).
6. `storeDocument(url, filename, hash, structure, vectors, existing?.id)` — transactional, inserts parents + children (see §2.5.4).
7. `semanticCache.invalidateForDocument(stored.id)`; `getCorpusProvider().invalidate()`.

**Why a synthetic `pdf://` URL:** `Document.url` is `@unique` and non-null. Deriving it from content hash + sanitized filename gives dedup for free. The *schema* migration required by parent-child chunking (§2.5) is independent of this.

#### 2.2.4 Upload route — `src/app/api/admin/documents/upload/route.ts`

```ts
import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { ingestPdf } from "@/server/ingest/pipeline";

export const runtime = "nodejs";          // pdf-parse uses node:fs
export const maxDuration = 60;            // parsing + child embedding can exceed 10s default

export const MAX_PDF_BYTES = 4 * 1024 * 1024; // Vercel-safe (4.5MB platform cap, see §4.1)
export const ACCEPTED_MIME = "application/pdf";

export async function POST(request: Request) {
  // 1. AuthZ — ADMIN only
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Parse multipart (bounded)
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Malformed multipart body" }, { status: 400 });
  }

  // 3. Validate file
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== ACCEPTED_MIME) {
    return NextResponse.json({ error: "Only .pdf files are accepted" }, { status: 415 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB limit` },
      { status: 413 },
    );
  }

  // 4. Buffer into memory (already bounded by the size check above)
  const buffer = Buffer.from(await file.arrayBuffer());

  // 5. Ingest and respond
  try {
    const result = await ingestPdf(buffer, file.name);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
```

Serverless-function notes: the route is Node runtime (never Edge — `pdf-parse` needs `node:fs`), `maxDuration: 60`, and the body is memory-buffered only after the 4 MiB check (the check is on the parsed `File.size`, so we never hold a full attacker payload in RAM).

#### 2.2.5 Frontend dropzone — `document-manager.tsx`

Add a `useState` + drag handlers; visual state machine: `idle → drag-over → uploading → done/error`. Edge cases handled: non-PDF dropped file rejected with message; empty file; > 4 MB file rejected client-side before the request is sent (mirrors the 413 server path); concurrent-upload guard (disable while `uploading`).

```tsx
const MAX_UI_PDF_MB = 4;
const [pdfFile, setPdfFile] = useState<File | null>(null);
const [uploading, setUploading] = useState(false);
const [pdfFeedback, setPdfFeedback] = useState<string | null>(null);

const onDrop = (event: React.DragEvent) => {
  event.preventDefault();
  const file = event.dataTransfer.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    setPdfFeedback("Only .pdf files are accepted.");
    return;
  }
  if (file.size > MAX_UI_PDF_MB * 1024 * 1024) {
    setPdfFeedback(`File exceeds the ${MAX_UI_PDF_MB} MB limit.`);
    return;
  }
  if (file.size === 0) {
    setPdfFeedback("File is empty.");
    return;
  }
  setPdfFile(file);
  setPdfFeedback(null);
};

const uploadPdf = async () => {
  if (!pdfFile || uploading) return;
  setUploading(true);
  setPdfFeedback(null);
  const body = new FormData();
  body.append("file", pdfFile);
  try {
    const res = await fetch("/api/admin/documents/upload", { method: "POST", body });
    const json = (await res.json()) as { status?: string; error?: string };
    if (!res.ok) {
      setPdfFeedback(`Upload failed: ${json.error ?? res.statusText}`);
      return;
    }
    setPdfFeedback(
      json.status === "failed"
        ? `Ingest failed: ${json.error ?? "unknown error"}`
        : `Ingested ${pdfFile.name} → ${json.status} (${"chunkCount" in json ? json.chunkCount : "?"} child chunks)`,
    );
    setPdfFile(null);
    refresh();
  } catch {
    setPdfFeedback("Network error during upload. Please retry.");
  } finally {
    setUploading(false);
  }
};
```

Dropzone markup skeleton (glass styling in §2.4):

```tsx
<div
  onDragOver={(e) => e.preventDefault()}
  onDragLeave={() => setDragging(false)}
  onDrop={onDrop}
  className={cn(
    "glass-card flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition",
    dragging ? "border-primary/70 bg-primary/5" : "border-glass-border hover:border-primary/60",
  )}
>
  <UploadCloud className="h-8 w-8 text-muted" />
  <p className="text-sm font-medium">Drag & drop a PDF here</p>
  <p className="text-xs text-muted">or</p>
  <label className="cursor-pointer rounded-xl bg-primary px-4 py-2 text-xs font-medium text-primary-foreground">
    Browse files
    <input
      type="file"
      accept=".pdf,application/pdf"
      className="hidden"
      onChange={(e) => onDrop({ preventDefault: () => {}, dataTransfer: { files: e.target.files } } as unknown as React.DragEvent)}
    />
  </label>
  <p className="text-xs text-muted">Up to 4 MB · text-based PDFs only (scanned pages can't be read)</p>
  {pdfFile && (
    <button type="button" onClick={uploadPdf} disabled={uploading} className="text-xs text-accent">
      {uploading ? "Uploading & embedding…" : `Upload ${pdfFile.name}`}
    </button>
  )}
  {pdfFeedback && <p className={cn("text-xs", pdfFeedback.startsWith("Ingested") ? "text-muted" : "text-destructive")}>{pdfFeedback}</p>}
</div>
```

---

### 2.3 Feature D — Interactive Admin Pipeline Visualizer

#### 2.3.1 tRPC endpoint — `admin.testPipeline`

**Enrich the orchestrator trace first.** `runAgenticRag` already computes the masked query and guardrail result internally but discards them. Add them to the response type so the visualizer shows Stage 0 without a second LLM call:

```ts
// src/server/rag/agents/orchestrator.ts
export interface AgenticRagResponse {
  userQuery: string;
  maskedQuery: string;                 // NEW
  guardrail: { passed: boolean; reason?: string }; // NEW
  finalAnswer: string;
  researchSteps: ResearchStep[];
  analysisMatrix: AnalystMatrix;
  sources: Source[];
  totalLatencyMs: number;
}
```

Populate at the three return sites (cache hit, guardrail-blocked, success). For the success path the guardrail ran inside `isQueryOutOfDomain` — wrap it:

```ts
const blocked = await isQueryOutOfDomain(maskedQuery);
guardrail = blocked
  ? { passed: false, reason: OUT_OF_DOMAIN_MESSAGE }
  : { passed: true, reason: "In-domain" };
```

**Procedure** (in `src/server/routers/admin.ts`):

```ts
import { z } from "zod";
import { runAgenticRag, type AgenticRagResponse } from "@/server/rag/agents/orchestrator";
import { getHybridRetriever } from "@/server/rag/instance";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { maskPii } from "@/server/pii/masker";

/** In-memory memory: prevents the orchestrator's memory.addTurn() from writing
 *  a ConversationMemory row whose conversationId FK would not exist in the DB. */
class NoopMemory {
  async ensureLoaded(): Promise<void> {}
  async addTurn(_u: string, _a: string): Promise<void> {}
  async getContextFormatted(): Promise<string> { return ""; }
  async clear(): Promise<void> {}
}

testPipeline: adminProcedure
  .input(z.object({ prompt: z.string().trim().min(5).max(2000) }))
  .mutation(async ({ input }): Promise<AgenticRagResponse> => {
    const result = await runAgenticRag(input.prompt, {
      hybridRetriever: getHybridRetriever(),
      cache: semanticCache,
      memory: new NoopMemory(),
      bypassCache: true,               // always force a live run for the glass-box view
    });
    logger.info(
      { prompt: input.prompt, latencyMs: result.totalLatencyMs },
      "[ADMIN] pipeline test complete",
    );
    return result;
  }),
```

Step-by-step logic:

1. Zod-validate `prompt` (5–2000 chars).
2. `runAgenticRag(prompt, { bypassCache: true, memory: NoopMemory })` — a `bypassCache: true` live run so every stage executes.
3. Return the full trace (`maskedQuery`, `guardrail`, `researchSteps`, `analysisMatrix`, `sources`, `finalAnswer`, `totalLatencyMs`).

The `NoopMemory` is essential: a fake `conversationId` would make `SummaryBufferMemory.saveToDb()` upsert a `conversation_memories` row referencing a nonexistent conversation (FK violation). We could `createMemory(crypto.randomUUID())` and rely on its internal `try/catch`, but the no-op adapter is explicit and side-effect-free.

**Serverless duration:** the trpc route handler (`src/app/api/trpc/[trpc]/route.ts`) must declare:

```ts
export const runtime = "nodejs";
export const maxDuration = 60;
```

**Timeout hardening (optional but recommended):** wrap long mutations in a tRPC middleware using `Promise.race` with an `AbortController` (see §4.2).

#### 2.3.2 Page — `src/app/admin/pipeline-tester/page.tsx`

GitHub-Actions-style **vertical** pipeline using pure Tailwind Flexbox. Data model derived from the trace:

- **Stage 0 — Guardrails / PII:** masked query + guardrail verdict badge (`passed`/`blocked`).
- **Stage 1 — Research (ReAct):** each `ResearchStep` renders as a `Thought → Action → Observation` triplet; expandable viewer per retrieved chunk showing **both** the matched child snippet and its expanded parent (see §2.5.5).
- **Stage 2 — Analyst:** render `analysisMatrix` (`summary`, `structured_table` as markdown, `key_insights`, `verified_facts`).
- **Stage 3 — Writer:** `finalAnswer` rendered with `react-markdown` (already a dependency; reuse the `.markdown-body` styles).

Component tree:

```
src/app/admin/pipeline-tester/page.tsx           (client page, form + run button)
src/components/admin/pipeline/pipeline-visualizer.tsx   (vertical stage rail)
src/components/admin/pipeline/stage-node.tsx            (collapsible stage card)
src/components/admin/pipeline/react-step.tsx            (Thought/Action/Observation rows)
src/components/admin/pipeline/source-panel.tsx          (child snippet + expanded parent + scores)
```

`stage-node.tsx` skeleton (expand/collapse + status icons):

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, Loader2, ShieldCheck, Search, FileSearch, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";

export type StageStatus = "pending" | "running" | "done" | "error";

const STAGE_META = {
  0: { label: "Guardrails & PII", icon: ShieldCheck },
  1: { label: "Research / Retrieval", icon: Search },
  2: { label: "Analyst Evaluation", icon: FileSearch },
  3: { label: "Writer Synthesis", icon: PenLine },
} as const;

export function StageNode({
  stage,
  status,
  running,
  summary,
  children,
}: {
  stage: 0 | 1 | 2 | 3;
  status: StageStatus;
  running: boolean;
  summary: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const meta = STAGE_META[stage];
  return (
    <div className="glass-card overflow-hidden rounded-2xl border border-glass-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-hover"
      >
        <span
          className={cn(
            "grid h-8 w-8 place-items-center rounded-xl",
            running ? "status-pulse bg-primary/20 text-primary" : "bg-surface-hover text-muted",
          )}
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <meta.icon className="h-4 w-4" />}
        </span>
        <span className="flex-1">
          <span className="block text-sm font-semibold">{meta.label}</span>
          <span className="block text-xs text-muted">{summary}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-glass-border px-4 py-3 text-sm">{children}</div>}
    </div>
  );
}
```

The visualizer maps a single `AgenticRagResponse` (from `api.admin.testPipeline.useMutation()`) into four `StageNode`s connected by a vertical connector line (`space-y-3` + a `w-px bg-border` rail), with a live "running" state advancing stage-by-stage while the mutation is in flight.

Edge cases: empty prompt disables the run button; guardrail-blocked prompt renders Stage 0 as red "blocked" and greys out Stages 1–3; zero-sources retrieval renders an explicit "No local context — CRAG web fallback used" note; tRPC `TIMEOUT` error renders a retry affordance (never auto-retry — §4.2).

---

### 2.4 Feature A — Global UI & UX Overhaul

The repo already has CSS-variable theming (`globals.css` `@theme`, `.dark` overrides, `.gradient-mesh`, `.cta-shimmer`, `tw-animate-css`, `framer-motion`, `next-themes`). We **replace the shared-hue approach with two independent palettes**.

#### 2.4.1 Two distinct color systems

Light = **"Paper & Ink"** (warm, editorial, high-contrast). Dark = **"Midnight"** (deep slate, luminous accents, dark glass). They share *token names* but not *values* — each `--color-*` is fully redefined in `.dark`.

```css
/* src/app/globals.css — @theme (light defaults) + .dark overrides */

@theme {
  /* LIGHT — Paper & Ink */
  --color-background: #faf7f2;        /* warm ivory */
  --color-foreground: #1f2430;        /* ink */
  --color-surface: #ffffff;
  --color-surface-hover: #f3efe7;
  --color-border: #e5ded2;
  --color-primary: #3f5bd6;           /* indigo */
  --color-primary-hover: #3249b8;
  --color-primary-foreground: #ffffff;
  --color-accent: #0e7490;            /* teal */
  --color-muted: #6b7280;
  --color-destructive: #b91c1c;
  --color-glass: rgba(255, 255, 255, 0.62);
  --color-glass-border: rgba(31, 36, 48, 0.10);
  --shadow-glass: 0 8px 32px rgba(90, 90, 140, 0.16);
  --color-mesh-a: rgba(63, 91, 214, 0.18);
  --color-mesh-b: rgba(14, 116, 144, 0.14);
  --color-mesh-c: rgba(217, 119, 6, 0.10);
}

.dark {
  /* DARK — Midnight */
  --color-background: #0b1020;        /* deep slate-navy */
  --color-foreground: #e8ecf8;
  --color-surface: #111832;
  --color-surface-hover: #1a2340;
  --color-border: #232e4f;
  --color-primary: #7c9cff;           /* luminous indigo */
  --color-primary-hover: #93aeff;
  --color-primary-foreground: #0b1020;
  --color-accent: #22d3ee;            /* cyan */
  --color-muted: #9aa4c0;
  --color-destructive: #f87171;
  --color-glass: rgba(255, 255, 255, 0.06);
  --color-glass-border: rgba(255, 255, 255, 0.12);
  --shadow-glass: 0 8px 32px rgba(0, 0, 0, 0.45);
  --color-mesh-a: rgba(124, 156, 255, 0.22);
  --color-mesh-b: rgba(34, 211, 238, 0.16);
  --color-mesh-c: rgba(192, 132, 252, 0.14);
}
```

Reusable glass card class:

```css
.glass-card {
  background: var(--color-glass);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  border: 1px solid var(--color-glass-border);
  box-shadow: var(--shadow-glass);
}
```

Each theme's mesh uses its own hue family and opacity (`--color-mesh-a/b/c`), so the background reads **different** in each mode rather than "same gradient, darker".

#### 2.4.2 Animated mesh background

```css
/* src/app/globals.css — replace .gradient-mesh with an animated variant */
.gradient-mesh {
  background:
    radial-gradient(40rem 40rem at 12% 8%, var(--color-mesh-a), transparent 60%),
    radial-gradient(36rem 36rem at 88% 14%, var(--color-mesh-b), transparent 60%),
    radial-gradient(46rem 46rem at 50% 100%, var(--color-mesh-c), transparent 65%);
  background-size: 140% 140%;
  animation: mesh-drift 22s ease-in-out infinite alternate;
}

@keyframes mesh-drift {
  0%   { background-position: 0% 0%; }
  100% { background-position: 100% 100%; }
}
```

Respect `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  .gradient-mesh { animation: none; }
}
```

#### 2.4.3 Micro-interactions

- Hover lift: `transition hover:-translate-y-0.5 hover:shadow-glass` (mirrors existing card pattern at `page.tsx:83`).
- Shimmer CTA: reuse `.cta-shimmer`.
- Page transitions: wrap route content in `framer-motion` `<motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:0.25}} />` (already installed).
- Button press: `active:scale-[0.98] transition`.
- Skeleton loaders: `animate-pulse` glass blocks.
- Focus visibility: `focus-visible:ring-2 focus-visible:ring-primary` on all interactive elements (keyboard a11y).

#### 2.4.4 Edge cases (explicit)

| Case | Handling |
|------|----------|
| **Theme hydration flash** | `next-themes` `suppressHydrationWarning` on `<html>`, inline `<script>` theme bootstrap in `<head>` (no CLS / flash on reload) |
| **`prefers-reduced-motion`** | Kill mesh drift + framer-motion page transitions + status-pulse; keep state changes instant |
| **Contrast on glass over animated mesh** | Body copy uses `text-foreground`/`text-muted` (AA-tested in both palettes); glass cards get a `bg-surface` fallback when `backdrop-filter` is unsupported (`@supports not (backdrop-filter: blur(1px))`) |
| **Loading states** | Glass `animate-pulse` skeletons per surface (admin docs list, chat, pipeline stages) |
| **Empty states** | Admin: "No documents ingested yet" + CTA; pipeline: "Run a test to see the trace"; landing: sections render even with placeholder copy |
| **Error states** | Typed feedback per surface (content-type 415, PDF 413/415/422, tRPC TIMEOUT, rate-limit) — all read from `data.code`, never raw stack traces |
| **Long content** | Query/answer lists use `line-clamp` + "Show more" collapsible; markdown tables get horizontal scroll (`overflow-x-auto`) |
| **Responsive / mobile** | Dropzone supports tap-to-browse; pipeline rail collapses to stacked cards below `md`; safe-area padding on mobile chrome |
| **Theme persistence** | Respect saved preference; default to `system`; toggle stores to `localStorage` with no layout shift |
| **Zero-data retrieval** | CRAG web-fallback path clearly labeled in both chat sources and pipeline Stage 1 |

#### 2.4.5 Landing page — "More things to write" content sections

Add 4 professional content sections below the feature grid in `src/app/page.tsx` (all copy is intentional placeholder that a content team replaces):

```tsx
const CONTENT_SECTIONS = [
  {
    eyebrow: "Guides",
    title: "End-to-end process walkthroughs",
    body: "Step-by-step walkthroughs that connect every milestone — from APS verification and uni-assist application through visa submission and blocked-account setup — so nothing falls through the cracks.",
    cta: "Read the guides",
  },
  {
    eyebrow: "Universities",
    title: "University & program spotlights",
    body: "Curated dossiers on leading German institutions: admission seasons, language requirements, tuition-fee status, and the documents each program actually expects.",
    cta: "Explore spotlights",
  },
  {
    eyebrow: "Finances",
    title: "Financial planning for your move",
    body: "Blocked-account thresholds, semester contributions, health-insurance costs, and realistic monthly budgets for major German cities — with the numbers kept current.",
    cta: "See the numbers",
  },
  {
    eyebrow: "Timelines",
    title: "Checklists and timelines",
    body: "Calendar-aware checklists that sequence every deadline: application windows, visa appointments, and enrollment cutoffs mapped to your intended intake.",
    cta: "Get the checklist",
  },
];
```

Each renders as a glass card with an `eyebrow`, `title`, `body`, and a text-link CTA — same layout grid as the existing `FEATURES` grid, restyled with `.glass-card`. This delivers the "more things to write" requirement with clean, professional placeholder copy.

---

### 2.5 True Parent-Child Chunking (new data layer)

**Goal:** precise child-level search + parent-level LLM context.

```
Document (whole file)
 └─ ParentChunk (~2000 chars, stored, passed to LLM)
     └─ ChildChunk (~200 chars, embedded + indexed for search)
         └─ on child match → fetch parent via parentId → give parent to LLM
```

#### 2.5.1 Prisma migration

```prisma
// prisma/schema.prisma — add below DocumentChunk (see current flat schema)
model DocumentParentChunk {
  id         Int             @id @default(autoincrement())
  documentId String
  text       String
  createdAt  DateTime        @default(now())

  document Document        @relation(fields: [documentId], references: [id], onDelete: Cascade)
  children DocumentChunk[]

  @@index([documentId])
  @@map("document_parent_chunks")
}

model DocumentChunk {
  id         Int      @id @default(autoincrement())
  documentId String
  parentId   Int?                        // NEW — FK to parent (child→parent join)
  sourceName String
  sourceUrl  String
  text       String
  embedding  Unsupported("vector(768)")  // child-only embeddings (precision pass)
  createdAt  DateTime  @default(now())

  document Document               @relation(fields: [documentId], references: [id], onDelete: Cascade)
  parent   DocumentParentChunk?   @relation(fields: [parentId], references: [id], onDelete: Cascade)

  @@index([documentId])
  @@index([sourceName])
  @@index([parentId])
  @@map("document_chunks")
}
```

Generate + apply:

```bash
pnpm prisma migrate dev --name parent_child_chunks
pnpm prisma generate
```

**Backfill strategy:** the new `parentId` column is nullable, so existing flat chunks remain valid as standalone children. After deploy, run a one-time rebuild with the new chunker so every document gets parent coverage:

```bash
# idempotent: unchanged-hash docs are skipped unless --force
pnpm tsx src/server/ingest/cli.ts sync --force
```

(If `cli.ts` lacks `--force` propagation, extend `syncAllDocuments` to accept it.)

#### 2.5.2 Two-level chunker — `chunker.ts` v2

Keep the existing `RecursiveChunker` (it handles overlap correctly). Add a composition layer:

```ts
// src/server/ingest/chunker.ts (append)
export const PARENT_CHUNK_SIZE = 2000;
export const PARENT_CHUNK_OVERLAP = 200;
export const CHILD_CHUNK_SIZE = 200;
export const CHILD_CHUNK_OVERLAP = 50;

export interface ParentChildChunk {
  parent: { text: string };
  children: { text: string }[];
}

export function chunkParentChild(text: string): ParentChildChunk[] {
  if (!text) return [];
  const parentChunker = new RecursiveChunker({
    chunkSize: PARENT_CHUNK_SIZE,
    chunkOverlap: PARENT_CHUNK_OVERLAP,
    minChunkChars: 100,
  });
  const childChunker = new RecursiveChunker({
    chunkSize: CHILD_CHUNK_SIZE,
    chunkOverlap: CHILD_CHUNK_OVERLAP,
    minChunkChars: 40,
  });

  return parentChunker
    .splitText(text)
    .map((parentText) => {
      const children = childChunker.splitText(parentText);
      // Edge case: a parent too short to produce children becomes its own child.
      return {
        parent: { text: parentText },
        children: children.length > 0 ? children.map((text) => ({ text })) : [{ text: parentText }],
      };
    });
}
```

Overlap strategy preserved at both levels (200-char overlap on parents, 50-char on children) so section boundaries are never lost.

#### 2.5.3 Second embedding pass — children only

`persistIngested` (shared by `ingestUrl` and `ingestPdf`) collects child texts and embeds **only children**:

```ts
const structure = chunkParentChild(cleaned);
const childTexts = structure.flatMap((p) => p.children.map((c) => c.text));
if (childTexts.length === 0) return { ... /* status: "failed", "No usable chunks" */ };
const vectors = await embeddingClient.embedTexts(childTexts); // precision pass
await storeDocument(url, title, hash, structure, vectors, existing?.id);
```

Parents are stored without embeddings (no `vector()` column), which keeps the FAISS-equivalent dense scan (pgvector) over only ~200-char rows — same index shape as today, higher precision.

#### 2.5.4 Transactional store — `storeDocument` v2

```ts
async function storeDocument(
  url: string,
  title: string,
  hash: string,
  structure: ParentChildChunk[],
  vectors: number[][],
  existingId?: string,
): Promise<{ id: string; status: "created" | "updated"; parentCount: number; childCount: number }> {
  return prisma.$transaction(async (tx) => {
    const document = await tx.document.upsert({
      where: { url },
      create: { url, title, hash, chunkCount: 0 },
      update: { title, hash },
      select: { id: true },
    });

    if (existingId && existingId !== document.id) {
      await tx.documentParentChunk.deleteMany({ where: { documentId: existingId } }); // cascades children
    }
    await tx.documentParentChunk.deleteMany({ where: { documentId: document.id } }); // cascades children

    let childCount = 0;
    for (const block of structure) {
      const parent = await tx.documentParentChunk.create({
        data: { documentId: document.id, text: block.parent.text },
        select: { id: true },
      });
      const rows = block.children.map((child, index) =>
        Prisma.sql`(
          ${document.id},
          ${parent.id},
          ${title},
          ${url},
          ${child.text},
          ${`[${vectors[childCount + index].join(",")}]`}::vector,
          NOW()
        )`,
      );
      if (rows.length > 0) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO document_chunks
            ("documentId", "parentId", "sourceName", "sourceUrl", "text", "embedding", "createdAt")
          VALUES ${Prisma.join(rows, ", ")}
        `);
      }
      childCount += rows.length;
    }

    await tx.document.update({
      where: { id: document.id },
      data: { chunkCount: childCount },
    });

    return {
      id: document.id,
      status: existingId ? "updated" : "created",
      parentCount: structure.length,
      childCount,
    };
  });
}
```

`IngestResult.chunkCount` = child count (the searchable units); `parentCount` is surfaced in the upload response for observability.

#### 2.5.5 Retrieval join — child match → parent context

Extend `Chunk` with parent linkage (child snippet kept for the visualizer):

```ts
// src/server/rag/types.ts
export interface Chunk {
  id: string;
  documentId?: string;
  sourceName: string;
  sourceUrl: string;
  text: string;                 // parent text after expansion (LLM-facing)
  childText?: string;           // matched child snippet (visualizer / trace)
  parentId?: string;
  similarityScore?: number;
  bm25Score?: number;
  rrfScore?: number;
  crossScore?: number;
}
```

- `dense.ts`: add `"parentId"` to the raw SQL `SELECT`.
- `corpus.ts` `PrismaCorpusProvider`: add `parentId` to the `select`, and expose it in the `Chunk` mapping. BM25 runs over **child** texts (short, precise) — unchanged index shape.
- New `src/server/rag/retrieval/join.ts` — expand top reranked children to parents, dedupe by `parentId`:

```ts
import { prisma } from "@/server/db";
import type { Chunk } from "@/server/rag/types";

/** Given reranked child chunks, fetch their parent chunks and return the
 *  parent-level context (deduplicated, preserving the best child's score). */
export async function expandToParents(chunks: Chunk[]): Promise<Chunk[]> {
  const parentIds = Array.from(new Set(chunks.map((c) => c.parentId).filter((id): id is string => Boolean(id))));
  if (parentIds.length === 0) return chunks; // legacy flat chunks — pass through

  const parents = await prisma.documentParentChunk.findMany({
    where: { id: { in: parentIds.map(Number) } },
    select: { id: true, text: true },
  });
  const parentById = new Map(parents.map((p) => [String(p.id), p.text]));
  const seen = new Set<string>();
  const expanded: Chunk[] = [];

  for (const child of chunks) {
    const parentText = child.parentId ? parentById.get(child.parentId) : undefined;
    if (parentText !== undefined) {
      if (seen.has(child.parentId!)) continue; // dedupe: one parent per match
      seen.add(child.parentId!);
      expanded.push({ ...child, text: parentText, childText: child.text });
    } else {
      expanded.push(child);
    }
  }
  return expanded;
}
```

- `hybrid.ts` `retrieve()`: after rerank, `const expanded = await expandToParents(reranked)` and return `expanded` as `chunks`. CRAG confidence (`bestCrossScore`) still uses the *child* cross-score (precision metric); only the context handed to the LLM is parent-level.

**Context cost math:** `RERANK_TOP_K = 5` children → ≤ 5 parents × ~2000 chars ≈ **~10 KB context** per research pass — well within `llama-3.1-8b` context windows, ~3.3× richer than today's 5 × 600 chars.

`agentResearchReact` then pushes `chunk.text` (now the parent text) into `accumulatedContext` unchanged — no orchestrator change needed for the join; only `source-panel.tsx` (visualizer) needs to render `childText` vs `text` distinctly.

---

## 3. Dependencies & Environment

### 3.1 Install commands (pnpm — repo standard)

```bash
pnpm add pdf-parse
pnpm add -D @types/pdf-parse
```

> Do **not** install in the Python `requirements.txt` of the repo root — this is the `web-app` workspace.

### 3.2 `next.config.ts` modification

```ts
const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],   // NEW — keep pdf-parse out of the bundled server graph
  async headers() { return [{ source: "/(.*)", headers: securityHeaders }]; },
};
```

`pdf-parse` resolves `node:fs`/`node:path` at load time; `serverExternalPackages` (Next 15, successor to `experimental.serverComponentsExternalPackages`) prevents bundler resolution errors in serverless.

### 3.3 Prisma migration — **required** for parent-child

Unlike the previous flat design, this feature **does** change the schema. Apply §2.5.1 (`document_parent_chunks` table + nullable `parentId` on `document_chunks`) before deploying any ingestion code. The PDF `pdf://` synthetic URL still avoids touching `Document.url`, but the chunk layer is migrated. **Order matters:** migrate → regenerate client → deploy new `storeDocument`.

### 3.4 Environment

No new env vars. `HF_TOKEN`, `GROQ_API_KEY`, `DATABASE_URL` unchanged.

---

## 4. Security & Performance Considerations

### 4.1 Vercel serverless function limits

| Limit | Value | Impact |
|-------|-------|--------|
| Request body | **4.5 MB (Hobby & Pro serverless)** | Hard ceiling → `MAX_PDF_BYTES = 4 MiB`. A larger file in multipart form would be rejected by the platform *before* our handler executes. Client mirrors 4 MB. |
| Max execution | 10 s default; `maxDuration: 60` max on Hobby | PDF parse + parent/child chunking + child embedding (HF API round-trip per batch) easily exceeds 10 s → set `export const maxDuration = 60` on the upload + trpc routes. |
| Bundle size | 100 MB (Hobby) / 250 MB (Pro) | Keep `pdf-parse` external (§3.2); never import it from a page component. |

Self-hosted fallback: if the 4 MiB cap is ever too tight, raise it freely on Node hosts (not Vercel) by changing `MAX_PDF_BYTES`.

### 4.2 tRPC timeout settings

- Server: set `maxDuration = 60` on `src/app/api/trpc/[trpc]/route.ts` (a pipeline test issues ~3–5 sequential LLM calls).
- Recommended middleware for long mutations (guard against a hung upstream LLM):

```ts
// src/server/trpc/t.ts — add a bounded-procedure helper
import { TRPCError } from "@trpc/server";

const PIPELINE_TEST_TIMEOUT_MS = 55_000;

const withTimeout = (ms: number) =>
  t.middleware(async ({ ctx, next }) => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new TRPCError({ code: "TIMEOUT", message: "Pipeline test timed out" })),
        ms,
      );
    });
    try {
      return await Promise.race([next({ ctx }), timeout]);
    } finally {
      clearTimeout(timer!);
    }
  });

export const adminLongProcedure = adminProcedure.use(withTimeout(PIPELINE_TEST_TIMEOUT_MS));
```

- Client: `api.admin.testPipeline.useMutation({ retry: false })` — never auto-retry an expensive, side-effect-free but costly operation; a 55 s timeout with `retry: false` prevents billable duplicate runs.
- Keep `maxDuration` below the middleware timeout (60 s platform > 55 s app) so the platform kills first and the client sees a clean `TIMEOUT`.

### 4.3 SSRF / validation bypass risks

- **DNS rebinding:** `assertSafeUrl` resolves once before fetch, but `fetch` re-resolves. Mitigation: after `response` is received, re-verify `response.url`'s hostname via `assertSafeUrl` (post-redirect check) — the existing `redirect: "follow"` can hop to an internal host. Add `await assertSafeUrl(response.url)` before content-type handling (§2.1.3 step 5).
- **Content-type spoofing:** a hostile origin can serve `text/html` that is actually a giant binary. Keep `MAX_SCRAPE_BYTES` (5 MiB) enforcement against `Content-Length` **and** the decoded `Buffer.byteLength` after `.arrayBuffer()`.
- **Redirect to `file://` / private IP:** fetch on Node follows only HTTP(S) redirects, and our scheme check is pre-fetch only. The post-redirect `assertSafeUrl` (§2.1.3 step 5) closes the loop.
- **Upload abuse:** only ADMIN can POST (§2.2.4 step 1); the size/mime checks are server-authoritative (client-side checks are UX only).
- **Memory exhaustion:** the `file.size` check precedes `arrayBuffer()` so oversized uploads are rejected before buffering.
- **PDF bombs:** `MAX_PDF_BYTES` caps the file; `MAX_PDF_PAGES` (200) caps decompression work inside `pdf-parse`; extracted text is capped by `cleanText`/chunker before embedding.

### 4.4 Parent-child performance trade-offs

- **Embedding cost ↑:** children ≈ `doc_len / 200` vs old `doc_len / 600` → ~3× more embedding calls per document (batch via `HfEmbeddingClient`). Mitigation: batch `embedTexts`, and rely on idempotent `hash` skip for re-ingest.
- **Query latency:** parent fetch adds one indexed `IN` query on `document_parent_chunks` (few ms). No change to dense scan shape (children only).
- **Context quality ↑:** LLM receives ~2000-char parents instead of 600-char flat chunks → fewer hallucination-inducing truncations, more table/figure context preserved.

---

## 5. Implementation Checklist

**Phase 0 — Foundation / Security**
- [ ] Add `ErrorCode.INVALID_CONTENT_TYPE` + `415` mapping in `src/server/lib/errors/codes.ts`.
- [ ] Add `ErrorCode.PDF_PARSE_FAILED` + `422` mapping in the same file.
- [ ] Add `InvalidContentTypeError` and `PdfParseError` classes in `src/server/lib/errors/domain-error.ts`.
- [ ] Add `ALLOWED_CONTENT_TYPES` set + `assertSupportedContentType()` in `src/server/ingest/scraper.ts`.
- [ ] Replace the warn-and-continue block (`scraper.ts:39-45`) with a throwing call.
- [ ] Enforce `MAX_SCRAPE_BYTES` against `Content-Length` and decoded length.
- [ ] Post-redirect SSRF re-validation: `assertSafeUrl(response.url)` after fetch.
- [ ] Update `document-manager.tsx` to color failed-ingest feedback (esp. content-type).
- [ ] Run `pnpm lint && pnpm typecheck && pnpm test`.

**Phase 1 — Parent-Child Chunking + PDF Ingestion**
- [ ] Update `prisma/schema.prisma`: add `DocumentParentChunk`, add `parentId` + relation to `DocumentChunk`; indexes.
- [ ] `pnpm prisma migrate dev --name parent_child_chunks && pnpm prisma generate`.
- [ ] Add `chunkParentChild()` + `PARENT_CHUNK_SIZE`/`CHILD_CHUNK_SIZE` constants to `chunker.ts`.
- [ ] Extend `Chunk` type (`parentId`, `childText`); add `parentId` to `dense.ts` SELECT and `corpus.ts` select/mapping.
- [ ] Create `src/server/rag/retrieval/join.ts` (`expandToParents`); call it in `hybrid.ts` after rerank.
- [ ] Rewrite `storeDocument` to insert parents + children transactionally; update `chunkCount` = child count.
- [ ] `pnpm add pdf-parse` and `pnpm add -D @types/pdf-parse`; add `serverExternalPackages` to `next.config.ts`.
- [ ] Create `src/server/ingest/pdf-parser.ts` (import `pdf-parse/lib/pdf-parse.js`; page/size/text guards).
- [ ] Refactor `pipeline.ts`: extract `persistIngested()` shared tail (parent-child aware); add `ingestPdf()` + `pdfSourceKey()`.
- [ ] Create `src/app/api/admin/documents/upload/route.ts` (`runtime="nodejs"`, `maxDuration=60`, ADMIN gate, 4 MiB cap, mime checks).
- [ ] Add drag-and-drop `.pdf` dropzone to `document-manager.tsx` with client-side 4 MB / .pdf / empty guards.
- [ ] Backfill existing docs: run `cli sync --force` (or direct `syncAllDocuments({ force: true })`).
- [ ] Manual test: upload a text PDF and a scanned (image-only) PDF; verify the scanned one returns the "no extractable text" error; verify a >4 MB file returns a clean 413.

**Phase 2 — UI Overhaul**
- [ ] Define dual palettes in `globals.css`: light "Paper & Ink" `@theme` + full `.dark` "Midnight" overrides for every token.
- [ ] Add `.glass-card` + `--shadow-glass` + `--color-mesh-*`; animate `.gradient-mesh` with `prefers-reduced-motion` guard.
- [ ] Add `@supports not (backdrop-filter: blur(1px))` solid-surface fallback for glass cards.
- [ ] Add `focus-visible` rings + press/hover micro-interactions on shared primitives.
- [ ] Add `CONTENT_SECTIONS` (4 sections) + "more things to write" grid to `src/app/page.tsx`.
- [ ] Add framer-motion page-transition wrapper (reduced-motion aware).
- [ ] Implement edge-case states: loading skeletons, empty states, typed error feedback, `line-clamp` long text, mobile-safe dropzone.
- [ ] Verify dark/light toggle with `next-themes`: no flash (hydration guard), no CLS, both palettes AA-contrast on glass over mesh.

**Phase 3 — Pipeline Visualizer**
- [x] Extend `AgenticRagResponse` with `maskedQuery` + `guardrail` in `orchestrator.ts`; populate all return sites.
- [x] Add `NoopMemory` + `admin.testPipeline` mutation in `src/server/routers/admin.ts`.
- [x] Set `runtime="nodejs"` + `maxDuration=60` on the tRPC route handler.
- [x] Add `withTimeout` middleware + `adminLongProcedure`; use `retry: false` on the client.
- [x] Create `src/app/admin/pipeline-tester/page.tsx` and the four pipeline components.
- [x] Add "Pipeline Tester" entry to `NAV_ITEMS` in `src/app/admin/layout.tsx`.
- [ ] Verify a test run renders Stage 0 (masked query + guardrail), Stage 1 (ReAct steps + **child snippet + expanded parent**), Stage 2 (matrix), Stage 3 (markdown answer). Verify guardrail-blocked and zero-source edge cases. *(Requires live DB + LLM keys — sandbox blocked.)*

**Phase 4 — Tests & CI**
- [x] Unit: `pdf-parser` (valid PDF, empty, image-only, >200 pages), `scraper` content-type rejection.
- [x] Unit: `chunkParentChild` (overlap integrity, short-parent fallback, empty input).
- [x] Unit: `expandToParents` (dedupe, legacy flat pass-through, missing parent).
- [x] Unit: `pdfSourceKey` stability (same buffer → same key; sanitized filename).
- [x] Unit: `testPipeline` returns a full trace and does not write ConversationMemory.
- [x] e2e (Playwright): admin uploads a PDF; pipeline tester shows 4 completed stages; >4 MB upload shows 413; image-only PDF shows clean 422 error.
- [x] Verify `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` all green — lint/typecheck/test green in sandbox (280 tests / 41 files); `test:e2e` execution deferred to a machine with a DB (specs compile & list here, 21 tests / 6 files).
- [x] Update `web-app/docs/ROADMAP.md` / status docs — `docs/TESTING_PHASE4.md` added; status doc + ROADMAP updated. E2E browser verification remains pending a live DB + LLM keys.

---

## 6. Risk Assessment

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | **`pdf-parse` breaks in serverless** — top-level `fs.readFileSync` of a test fixture crashes the function bundle at cold start. | Medium | High | Import `pdf-parse/lib/pdf-parse.js` (skips the debug read); add `serverExternalPackages`; unit test the parser in CI so a regression fails the build. |
| 2 | **SSRF bypass via DNS rebinding / redirect to private host** — content-type hardening alone does not block an HTML page served from `169.254.169.254`. | Low | Critical | Re-run `assertSafeUrl` against `response.url` *after* fetch (post-redirect); enforce byte caps pre/post extraction. |
| 3 | **Migration-order failure** — new `storeDocument` deployed before the `document_parent_chunks` table exists, or before the client is regenerated. | Medium | High | Migration gated in CI (migrate → generate → build); backward-compatible `parentId` nullable + legacy pass-through in `expandToParents`; rollback = deploy old client, no data loss (children still valid without parents). |
| 4 | **Vercel platform limits silently degrade the feature** — 4.5 MB body cap and 10 s default duration would reject/abort the upload and pipeline-test calls in production even though they work locally. | High | Medium | Set `maxDuration = 60` and 4 MiB server cap from day one; document the limits in the route headers; add a size check in the dropzone and an e2e test that uploads a ~4.5 MB file to assert the clean 413 path. |
| 5 | **Embedding cost 3× on large PDFs** (children ≈ 1/200 chars each) — admin uploads a big corpus and hits HF rate limits / budget. | Medium | Medium | Batch `embedTexts`; idempotent `hash` skip; `MAX_PDF_BYTES` + `MAX_PDF_PAGES` caps; surface chunk/embedding counts in the upload response for cost observability. |
