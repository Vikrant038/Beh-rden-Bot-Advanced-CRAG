#!/usr/bin/env tsx
/**
 * Ingest CLI — `pnpm ingest`.
 *
 * Usage:
 *   pnpm ingest <url> [url...]                # ingest one or more URLs
 *   pnpm ingest <url> --title "Name"          # with a display-name override
 *   pnpm ingest --file data/urls.json         # entries from a JSON/JSONL file (URLs + PDFs)
 *   pnpm ingest --sync                        # re-sync every stored document
 *   pnpm ingest --force <url>                 # re-embed even if content unchanged
 *
 * --file format — a JSON array, JSONL, or newline-delimited URLs:
 *
 *   // JSON array (mixed URLs + PDFs with optional titles):
 *   [
 *     "https://www.uni-assist.de/…",
 *     { "url": "https://www.akexpat.com/…", "title": "Blocked Account Guide" },
 *     { "pdf": "./docs/merkblatt_verfahren.pdf", "title": "Merkblatt Verfahren" }
 *   ]
 *
 *   // JSONL (one JSON value per line) or plain lines:
 *   {"url": "https://…", "title": "…"}
 *   {"pdf": "./docs/visa.pdf"}
 *   https://example.com/plain-url-line
 *
 * `pdf` paths are resolved relative to the file's directory. `title` is
 * optional everywhere; without it, URLs use the scraped <title> tag and PDFs
 * use their filename.
 */

// Load .env (GROQ_API_KEYS, DATABASE_URL, …) — tsx does not auto-inject it.
import "dotenv/config";

import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
  ingestPdf,
  ingestUrl,
  syncAllDocuments,
  type IngestOptions,
  type IngestResult,
} from "@/server/ingest/pipeline";
import {
  createTranslationRateLimiter,
  type TranslationRateLimiter,
} from "@/server/ingest/translate";
import { createLogger } from "@/server/lib/logger";

/** Shared rate limiter for the CLI run (reused across all documents). */
let cliRateLimiter: TranslationRateLimiter | undefined;

const logger = createLogger("ingest-cli");

interface CliArgs {
  urls: string[];
  file?: string;
  sync: boolean;
  force: boolean;
  title?: string;
  english: boolean;
}

/** A single ingest job from the CLI: either a URL or a local PDF path. */
interface IngestEntry {
  kind: "url" | "pdf";
  value: string;
  title?: string;
}

type CliIngestResult = IngestResult & { filename?: string };

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { urls: [], sync: false, force: false, english: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file" || arg === "-f") {
      args.file = argv[++i];
    } else if (arg === "--sync") {
      args.sync = true;
    } else if (arg === "--force") {
      args.force = true;
    } else if (arg === "--english") {
      args.english = true;
    } else if (arg === "--title") {
      args.title = argv[++i];
    } else {
      args.urls.push(arg);
    }
  }
  return args;
}

function entryFromObject(obj: Record<string, unknown>): IngestEntry | null {
  const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : undefined;
  if (typeof obj.url === "string" && obj.url.trim()) {
    return { kind: "url", value: obj.url.trim(), title };
  }
  if (typeof obj.pdf === "string" && obj.pdf.trim()) {
    return { kind: "pdf", value: obj.pdf.trim(), title };
  }
  return null;
}

/** Parse one line of a JSONL file: a JSON object/string, or a plain URL. */
function parseFileLine(line: string): IngestEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "string" && parsed.trim()) {
      return { kind: "url", value: parsed.trim() };
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return entryFromObject(parsed as Record<string, unknown>);
    }
    // Valid JSON that isn't a URL/PDF entry (string, number, boolean, null,
    // or an object without url/pdf) — skip rather than ingest the raw text.
    return null;
  } catch {
    // Not JSON — treat the line as a plain URL.
  }
  return { kind: "url", value: trimmed };
}

/**
 * Reads a batch file into ingest entries. Accepts a JSON array (strings and/or
 * `{url|pdf, title}` objects), JSONL, or newline-delimited plain URLs.
 */
function readEntriesFromFile(filePath: string): IngestEntry[] {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split(/\r?\n/);

  // Fast path: the whole file is a JSON array.
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const entries: IngestEntry[] = [];
      for (const item of parsed) {
        if (typeof item === "string" && item.trim()) {
          entries.push({ kind: "url", value: item.trim() });
        } else if (item && typeof item === "object" && !Array.isArray(item)) {
          const entry = entryFromObject(item as Record<string, unknown>);
          if (entry) {
            entries.push(entry);
          }
        }
      }
      return entries;
    }
  } catch {
    // Not a single JSON array — fall through to JSONL / plain lines.
  }

  const entries: IngestEntry[] = [];
  for (const line of lines) {
    const entry = parseFileLine(line);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

function printSummary(results: CliIngestResult[]): void {
  const counts: Record<string, number> = {};
  for (const result of results) {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
  }
  logger.info({ counts, total: results.length }, "[INGEST] run complete");
  for (const result of results) {
    const label = result.filename ?? result.url;
    const line =
      result.status === "failed"
        ? `${label} -> FAILED (${result.error ?? "unknown error"})`
        : `${label} -> ${result.status} (${result.chunkCount} chunks, ${result.cacheInvalidated} cache entries invalidated)`;
    process.stdout.write(`${line}\n`);
  }
}

function ingestOptions(args: CliArgs): IngestOptions {
  const opts: IngestOptions = { force: args.force, title: args.title };
  if (args.english) {
    opts.normalizeEnglish = true;
    if (!cliRateLimiter) {
      cliRateLimiter = createTranslationRateLimiter();
    }
    opts.rateLimiter = cliRateLimiter;
  }
  return opts;
}

async function runEntry(
  entry: IngestEntry,
  baseDir: string,
  opts: IngestOptions,
): Promise<CliIngestResult> {
  if (entry.kind === "url") {
    return ingestUrl(entry.value, opts);
  }
  const pdfPath = isAbsolute(entry.value) ? entry.value : resolve(baseDir, entry.value);
  const buffer = readFileSync(pdfPath);
  return ingestPdf(buffer, basename(pdfPath), opts);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let results: CliIngestResult[];
  const opts = ingestOptions(args);

  if (args.sync) {
    results = await syncAllDocuments(opts);
  } else {
    const entries: IngestEntry[] = [];
    const baseDir = args.file ? dirname(resolve(args.file)) : process.cwd();

    if (args.file) {
      entries.push(...readEntriesFromFile(args.file));
    }
    if (args.urls.length > 0) {
      if (args.title && args.urls.length > 1) {
        process.stderr.write("Error: --title can only be used with a single URL.\n");
        process.exit(2);
      }
      for (const url of args.urls) {
        entries.push({ kind: "url", value: url, title: args.title });
      }
    }

    if (entries.length === 0) {
      process.stderr.write(
        'Usage: pnpm ingest <url> [url...] [--title "Name"] | --file <path> | --sync [--force] [--english]\n',
      );
      process.exit(2);
    }

    results = [];
    for (const entry of entries) {
      try {
        results.push(await runEntry(entry, baseDir, opts));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          url: entry.value,
          title: entry.title ?? "",
          status: "failed",
          chunkCount: 0,
          hash: "",
          error: message,
          cacheInvalidated: 0,
        });
      }
    }
  }

  printSummary(results);
  const failures = results.filter((result) => result.status === "failed").length;
  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  logger.error({ error: String(error) }, "[INGEST] fatal error");
  process.exit(1);
});
