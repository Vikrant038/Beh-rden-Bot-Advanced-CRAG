/**
 * SSRF-safe web page scraper for the ingest pipeline. Fetches a URL, validates
 * it against the SSRF guard (GUARDRAILS M6.3), extracts the document title and
 * main-body text using lightweight HTML heuristics (no browser required, so it
 * runs on Vercel serverless).
 */

import { assertSafeUrl } from "@/server/lib/security/url-validator";
import { ExternalApiError, InvalidContentTypeError } from "@/server/lib/errors";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("ingest-scraper");

export const SCRAPE_TIMEOUT_MS = 20_000;
export const MAX_SCRAPE_BYTES = 5 * 1024 * 1024;
export const MIN_CONTENT_CHARS = 200;

const ALLOWED_CONTENT_TYPES = new Set(["text/html", "text/plain"]);

export interface ScrapedDocument {
  title: string;
  url: string;
  text: string;
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
export async function scrapeWebPage(rawUrl: string): Promise<ScrapedDocument> {
  const trimmedUrl = rawUrl.trim();
  await assertSafeUrl(trimmedUrl);

  const response = await fetchWithTimeout(trimmedUrl);

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

async function fetchWithTimeout(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: {
        "User-Agent": "BehoerdenBot/1.0 (RAG ingestion)",
        Accept: "text/html,text/plain;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn({ error: String(error), url }, "[INGEST] fetch failed");
    throw new ExternalApiError(`Unable to fetch ${url}: ${String(error)}`);
  }
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
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ");
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
