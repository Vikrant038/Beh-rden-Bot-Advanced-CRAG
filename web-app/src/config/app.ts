/**
 * Central application configuration.
 *
 * Single source of truth for every configurable value the app uses — app
 * identity, feature limits, pipeline tuning, admin defaults, model settings.
 * Change a value here and it takes effect everywhere without hunting through
 * files.
 *
 * **How to add a new config value**
 *   1. Add it to the relevant section below (with a JSDoc comment explaining
 *      what it controls and how to tune it).
 *   2. Export it as a named const.
 *   3. Find every place the value was previously hardcoded and replace with
 *      `import { VALUE } from "@/config/app"`.
 *
 * All imports must be side-effect-free and safe for both server and client.
 * Do NOT import any Prisma, Next.js, or framework-specific modules here.
 */

// ─── App identity ───────────────────────────────────────────────────────────

/** Public-facing product name. */
export const APP_NAME = "Behörden-Bot";

/** Semver — bumped by releases. */
export const APP_VERSION = "0.6.0";

/** Short <meta> description (also used by OG / Twitter cards). */
export const APP_DESCRIPTION =
  "Your AI guide to studying in Germany — student visas, APS certification, blocked accounts, and university applications, answered from official sources. Built for Indian students.";

/** Tagline shown next to the name in page titles and OG. */
export const PAGE_TAGLINE = "Asked and answered from official German sources.";

/**
 * Canonical public URL for metadataBase, OG, canonical, sitemap, and robots.
 * Derived from NEXTAUTH_URL (validated at build time) so it works on Vercel
 * and local without a hardcoded domain.
 */
function resolveAppUrl(): string {
  const raw = process.env.NEXTAUTH_URL?.trim() ?? "";
  if (raw === "") return "http://localhost:3000";
  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch {
    return "http://localhost:3000";
  }
}
export const APP_URL = resolveAppUrl();

/**
 * Fallback URL for SEO files (robots.ts, sitemap.ts) when NEXT_PUBLIC_SITE_URL
 * is not set. Only imported by SEO modules; for the canonical metadata URL use
 * `APP_URL` instead.
 */
export const SEO_BASE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || APP_URL;

// ─── Feature limits ─────────────────────────────────────────────────────────

/**
 * Free-tier cap: a guest may ask at most this many prompts (USER messages
 * across all their non-deleted conversations) before being asked to sign in.
 */
export const GUEST_PROMPT_LIMIT = 5;

/**
 * How long a guest session persists on the device (180 days, in seconds).
 */
export const GUEST_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/** HTTP-only cookie that carries the signed device-scoped guest identity. */
export const GUEST_COOKIE = "behoerden_guest";

/**
 * Client-facing error code sent by the server when the guest cap is hit.
 * Must match `ErrorCode.GUEST_PROMPT_LIMIT` in `src/server/lib/errors/codes.ts`.
 */
export const GUEST_LIMIT_REACHED_CODE = "GUEST_PROMPT_LIMIT";

/**
 * Hard limit on each chat query — both the client textarea and the server
 * Zod schema enforce this (MAX_QUERY_LENGTH is the single source). A query
 * longer than this is rejected with a 422 before any LLM spend.
 */
export const MAX_QUERY_LENGTH = 4000;

/**
 * Cap on a stopped/partial assistant response persisted via chat.savePartial.
 */
export const MAX_PARTIAL_CONTENT_LENGTH = 20_000;

/**
 * Max number of pages for a single uploaded PDF document. Pages beyond this
 * trigger a PdfPageLimitError (no pdf.js fallback — the cap is parser-
 * independent).
 */
export const MAX_PDF_PAGES = 200;

/** Max upload file size for PDF documents (4 MB). */
export const MAX_PDF_BYTES = 4 * 1024 * 1024;

/** Only PDF documents are accepted. */
export const ACCEPTED_MIME = "application/pdf";

/** Admin UI: max file size in MB for client-side validation. */
export const MAX_UI_PDF_MB = 4;

/** Admin UI: how often (ms) to poll for document-upload job status. */
export const POLL_INTERVAL_MS = 2500;

// ─── Admin defaults ─────────────────────────────────────────────────────────

/** Max number of past days the admin dashboard can query. */
export const DAILY_QUERY_MAX_DAYS = 90;

/** Default page size for the admin recent-queries table. */
export const RECENT_QUERY_LIMIT = 10;

/** How many users the admin users endpoint fetches at once (cursor cap). */
export const ADMIN_USER_FETCH_LIMIT = 500;

// ─── Retrieval & pipeline tuning ────────────────────────────────────────────

/**
 * Embedding vector dimension (BGE-M3 = 1024). Must match the model used by
 * the embeddings worker and the pgvector index.
 */
export const EMBEDDING_DIM = 1024;

/** Minimum similarity score (cross-encoder) for a chunk to pass the gate. */
export const DEFAULT_MIN_SIMILARITY = 0.2;

/** RRF fusion constant (k). */
export const RRF_K = 60;

/** Top-K chunks fetched by dense embedding retrieval per sub-query. */
export const DENSE_TOP_K = 15;

/** Top-K chunks fetched by sparse (BM25 / FTS) retrieval per sub-query. */
export const SPARSE_TOP_K = 15;

/** Top-K chunks after cross-encoder reranking (final answer context window). */
export const RERANK_TOP_K = 5;

/**
 * CRAG relevance gate threshold (cross-encoder score, 0–1). If the best chunk
 * scores below this, the CRAG gate triggers a refusal answer.
 */
export const CRAG_THRESHOLD = 0.5;

/**
 * Cosine-similarity threshold for the semantic cache lookup. A query vector
 * closer than this to a cached entry returns the cached answer directly.
 */
export const CACHE_SIMILARITY_THRESHOLD = 0.97;

/** How long a semantic-cache entry lives (7 days, in seconds). */
export const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Text prefix prepended to every query before embedding, as recommended by
 * BGE's training methodology ("Represent this sentence for searching relevant
 * passages: …").
 */
export const QUERY_EMBEDDING_PREFIX = "Represent this sentence for searching relevant passages: ";

// ─── Default LLM parameters ─────────────────────────────────────────────────

/** LLM temperature for summarization / memory (low = deterministic). */
export const LLM_TEMPERATURE_LOW = 0.1;

/** LLM temperature for answer generation (balanced). */
export const LLM_TEMPERATURE_MEDIUM = 0.2;

/** LLM temperature for analysis / research (slightly creative). */
export const LLM_TEMPERATURE_HIGH = 0.3;

/** Max response tokens for summary generation. */
export const LLM_MAX_TOKENS_SUMMARY = 150;

/** Max response tokens for answer generation. */
export const LLM_MAX_TOKENS_ANSWER = 600;

/** Max response tokens for agentic analysis (analyst step). */
export const LLM_MAX_TOKENS_ANALYSIS = 1000;

/** Max tokens for the guardrail JSON response. */
export const LLM_MAX_TOKENS_GUARDRAIL = 150;

// ─── Blocked-account calculation defaults ───────────────────────────────────

/** Monthly blocked-account amount (€992 as of 2025/26). */
export const BLOCKED_ACCOUNT_MONTHLY_EUR = 992;

/** How many months the blocked account must cover. */
export const BLOCKED_ACCOUNT_MONTHS = 12;

/** Assumed EUR→INR exchange rate for display. */
export const INR_PER_EUR = 90;

// ─── Chart / UI defaults ────────────────────────────────────────────────────

/** Color palette for the admin dashboard charts (Kvantum / tableu-inspired). */
export const CHART_COLORS = ["#0072B2", "#D55E00", "#009E73", "#E69F00", "#56B4E9", "#CC79A7"];
