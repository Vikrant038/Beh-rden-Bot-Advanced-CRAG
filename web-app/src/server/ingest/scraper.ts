/**
 * SSRF-safe web page scraper for the ingest pipeline. Fetches a URL, validates
 * it against the SSRF guard (GUARDRAILS M6.3), extracts the document title and
 * main-body text using lightweight HTML heuristics (no browser required, so it
 * runs on Vercel serverless).
 */

import { assertSafeUrl } from "@/server/lib/security/url-validator";
import { ExternalApiError, InvalidContentTypeError, SsrfBlockedError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("ingest-scraper");

export const SCRAPE_TIMEOUT_MS = 20_000;
export const MAX_SCRAPE_BYTES = 5 * 1024 * 1024;
export const MIN_CONTENT_CHARS = 200;

/** Maximum retries for transient failures (429 / 403 / 5xx / network errors). */
export const SCRAPE_MAX_RETRIES = 2;
/** Base backoff for retries (doubles per attempt: 300ms → 600ms). */
export const SCRAPE_RETRY_BACKOFF_MS = 300;

/**
 * Realistic desktop-browser User-Agent. Several official German portals
 * (DAAD, study-in-germany, daad.in, frankfurt.de …) return 403 to obviously
 * automated agents like "BehoerdenBot/1.0" while serving the same page to a
 * browser.
 */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const ALLOWED_CONTENT_TYPES = new Set(["text/html", "text/plain"]);

export interface ScrapedDocument {
  title: string;
  url: string;
  text: string;
}

export interface ScrapeOptions {
  /** Number of retries for transient failures (default SCRAPE_MAX_RETRIES). */
  maxRetries?: number;
  /** Base backoff delay in ms, doubled per attempt (default SCRAPE_RETRY_BACKOFF_MS). */
  backoffMs?: number;
}

function assertSupportedContentType(url: string, contentType: string | null): void {
  const mime = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_CONTENT_TYPES.has(mime)) {
    throw new InvalidContentTypeError(url, contentType ?? "(missing)");
  }
}

/**
 * Fetches and extracts readable text from a web URL.
 * @throws ExternalApiError when the fetch/extraction fails or content is too short.
 * @throws SsrfBlockedError when the URL resolves to a disallowed host.
 * @throws InvalidContentTypeError when the URL returns a non-HTML/plain-text content type.
 */
export async function scrapeWebPage(
  rawUrl: string,
  options: ScrapeOptions = {},
): Promise<ScrapedDocument> {
  const trimmedUrl = rawUrl.trim();
  await assertSafeUrl(trimmedUrl);

  const response = await fetchWithTimeout(trimmedUrl, options);

  if (!response.ok) {
    throw new ExternalApiError(`Failed to fetch ${trimmedUrl}: HTTP ${response.status}`);
  }

  // Post-redirect SSRF re-validation: fetch follows redirects, which can hop to
  // an internal host after the initial assertSafeUrl passed.
  await assertSafeUrl(response.url);

  const contentType = response.headers.get("content-type");
  assertSupportedContentType(trimmedUrl, contentType);

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_SCRAPE_BYTES) {
    throw new ExternalApiError(`Response too large from ${trimmedUrl} (${contentLength} bytes)`);
  }

  const html = await response.text();
  if (Buffer.byteLength(html, "utf8") > MAX_SCRAPE_BYTES) {
    throw new ExternalApiError(`Decoded response too large from ${trimmedUrl}`);
  }

  const extracted = extractMainContent(html);

  if (extracted.text.length < MIN_CONTENT_CHARS) {
    throw new ExternalApiError(
      `Extracted text too short from ${trimmedUrl} (${extracted.text.length} chars)`,
    );
  }

  logger.info(
    { url: trimmedUrl, chars: extracted.text.length, title: extracted.title },
    "[INGEST] scraped page",
  );
  return { title: extracted.title, url: trimmedUrl, text: extracted.text };
}

/** Statuses worth retrying: 429 (rate limit), 403 (bot gate / soft WAF), 5xx (server). */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 403 || status >= 500;
}

/** Hard cap so a bad option value can't balloon wall time (per-attempt 20s timeout). */
const MAX_RETRIES_CAP = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Max redirect hops followed, each re-validated against the SSRF guard. */
const MAX_REDIRECT_HOPS = 5;

/**
 * Fetches a URL following redirects MANUALLY so every hop (not just the final
 * URL) is re-validated against the SSRF guard. `fetch(redirect: "follow")`
 * silently follows the whole chain — a chain like public → http://169.254.169.254
 * → public would fetch the internal host while the final URL looks safe.
 * Re-validating each hop closes that gap. A single AbortSignal covers the
 * whole chain so the total time stays bounded by SCRAPE_TIMEOUT_MS.
 */
async function fetchWithRedirectValidation(
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    // Resolve + validate the CURRENT hop right before connecting. This also
    // re-checks the scheme, so a redirect to file:// or another protocol is
    // rejected here rather than fetched.
    await assertSafeUrl(current);
    const response = await fetch(current, { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      // Release the connection for the next hop (redirect bodies are empty).
      await response.body?.cancel().catch(() => {});
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  throw new ExternalApiError(`Too many redirects fetching ${url}`);
}

/**
 * Fetches a URL with exponential-backoff retries on transient failures.
 * Non-transient 4xx responses and content-type/size errors are thrown
 * immediately — retrying those would just produce the same result.
 */
async function fetchWithTimeout(url: string, options: ScrapeOptions): Promise<Response> {
  const maxRetries = Math.min(
    MAX_RETRIES_CAP,
    Math.max(0, options.maxRetries ?? SCRAPE_MAX_RETRIES),
  );
  const backoffMs = Math.max(0, options.backoffMs ?? SCRAPE_RETRY_BACKOFF_MS);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      await sleep(backoffMs * 2 ** (attempt - 1));
    }

    let response: Response;
    try {
      response = await fetchWithRedirectValidation(url, {
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          Accept: "text/html,text/plain;q=0.9",
        },
        signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
      });
    } catch (error) {
      // SSRF rejections are deterministic (the host resolved to a blocked
      // range) — never retry, propagate immediately so the caller sees the
      // real reason instead of a wrapped ExternalApiError after 3 attempts.
      if (error instanceof SsrfBlockedError) {
        throw error;
      }
      if (attempt < maxRetries) {
        logger.warn({ url, error: String(error), attempt }, "[INGEST] fetch failed; retrying");
        continue;
      }
      logger.warn({ url, error: String(error) }, "[INGEST] fetch failed");
      throw new ExternalApiError(`Unable to fetch ${url}: ${String(error)}`);
    }

    if (response.ok) {
      return response;
    }
    if (isRetryableStatus(response.status) && attempt < maxRetries) {
      // Bot-gated portals commonly 403 permanently (WAF/geo-block): a single
      // retry covers soft-WAF flaps without tripling requests to blocked hosts.
      if (response.status === 403 && attempt >= 1) {
        throw new ExternalApiError(`Failed to fetch ${url}: HTTP 403`);
      }
      logger.warn(
        { url, status: response.status, attempt },
        "[INGEST] retryable HTTP status; retrying",
      );
      continue;
    }
    throw new ExternalApiError(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  throw new ExternalApiError(`Unable to fetch ${url}`);
}

export interface ExtractedContent {
  title: string;
  text: string;
}

/**
 * Extracts title + readable main-body text from an HTML document.
 * Prefers <article>/<main> blocks when present; otherwise uses <body>.
 */
export function extractMainContent(html: string): ExtractedContent {
  const title = extractTitle(html);

  // Prefer article/main region if present.
  const mainMatch =
    html.match(/<main[\s>][\s\S]*?<\/main>/i) ?? html.match(/<article[\s>][\s\S]*?<\/article>/i);
  const region = mainMatch ? mainMatch[0] : extractBody(html);
  if (!region) {
    return { title, text: "" };
  }

  const stripped = stripNoiseTags(region);
  const text = normalizeWhitespace(stripTags(stripped));
  return { title, text };
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1]).trim().slice(0, 200) : "";
}

function extractBody(html: string): string {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[0] : html;
}

function stripNoiseTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*[^>]*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*[^>]*>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*[^>]*>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg\s*[^>]*>/gi, " ")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*[^>]*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav\s*[^>]*>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer\s*[^>]*>/gi, " ")
    .replace(/<header\b[^>]*>[\s\S]*?<\/header\s*[^>]*>/gi, " ")
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside\s*[^>]*>/gi, " ");
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|tr|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ");
}

function normalizeWhitespace(text: string): string {
  return decodeEntities(text)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    ndash: "\u2013",
    mdash: "\u2014",
    hellip: "\u2026",
    uuml: "\u00fc",
    auml: "\u00e4",
    ouml: "\u00f6",
    szlig: "\u00df",
  };
  return text
    .replace(/&(#x?[0-9a-fA-F]+);/g, (_m, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const code = Number.parseInt(entity.slice(2), 16);
        return Number.isNaN(code) ? "" : String.fromCodePoint(code);
      }
      if (entity.startsWith("#")) {
        const code = Number.parseInt(entity.slice(1), 10);
        return Number.isNaN(code) ? "" : String.fromCodePoint(code);
      }
      return "";
    })
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => named[name.toLowerCase()] ?? match);
}
