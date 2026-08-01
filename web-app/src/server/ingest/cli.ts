#!/usr/bin/env tsx
/**
 * Ingest CLI — `pnpm ingest`.
 *
 * Usage:
 *   pnpm ingest <url> [url...]         # ingest one or more URLs
 *   pnpm ingest --file data/urls.json  # URLs from a JSON array or JSONL file
 *   pnpm ingest --sync                 # re-sync every stored document
 *   pnpm ingest --force <url>          # re-embed even if content unchanged
 */

import { readFileSync } from "node:fs";
import { ingestUrl, syncAllDocuments, type IngestResult } from "@/server/ingest/pipeline";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("ingest-cli");

interface CliArgs {
  urls: string[];
  file?: string;
  sync: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { urls: [], sync: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file" || arg === "-f") {
      args.file = argv[++i];
    } else if (arg === "--sync") {
      args.sync = true;
    } else if (arg === "--force") {
      args.force = true;
    } else {
      args.urls.push(arg);
    }
  }
  return args;
}

function readUrlsFromFile(path: string): string[] {
  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // Not JSON — treat as newline-delimited URLs.
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function printSummary(results: IngestResult[]): void {
  const counts: Record<string, number> = {};
  for (const result of results) {
    counts[result.status] = (counts[result.status] ?? 0) + 1;
  }
  logger.info({ counts, total: results.length }, "[INGEST] run complete");
  for (const result of results) {
    const line =
      result.status === "failed"
        ? `${result.url} -> FAILED (${result.error ?? "unknown error"})`
        : `${result.url} -> ${result.status} (${result.chunkCount} chunks, ${result.cacheInvalidated} cache entries invalidated)`;
    process.stdout.write(`${line}\n`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let results: IngestResult[];
  if (args.sync) {
    results = await syncAllDocuments({ force: args.force });
  } else {
    const urls = [...args.urls];
    if (args.file) {
      urls.push(...readUrlsFromFile(args.file));
    }
    if (urls.length === 0) {
      process.stderr.write(
        "Usage: pnpm ingest <url> [url...] | --file <path> | --sync [--force]\n",
      );
      process.exit(2);
    }
    results = [];
    for (const url of urls) {
      try {
        results.push(await ingestUrl(url, { force: args.force }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          url,
          title: "",
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
