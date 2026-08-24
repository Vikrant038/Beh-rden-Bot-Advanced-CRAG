/**
 * Translation checkpoint cache for the ingest pipeline.
 * File-based cache that survives process restarts for resumable translation.
 */
import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("translate");

/** In-flight translation promises keyed by segment hash. With parallel workers
 * (or the pool's multi-model fallbacks) multiple workers may try to translate
 * the same segment concurrently. This map deduplicates the LLM call. */
const inflightSegments = new Map<string, Promise<string>>();

const CACHE_DIR = join(process.cwd(), "data", "translation-cache");

interface TranslationRecord {
  originalHash: string;
  translatedText: string;
  model: string;
  language: string;
  timestamp: number;
}

/** Ensures the cache directory exists. */
function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/** Returns the cache file path for a given hash. */
function cacheFilePath(originalHash: string): string {
  return join(CACHE_DIR, `${originalHash}.json`);
}

/**
 * Returns the cached translation for `originalHash`, or null if not cached.
 */
export function cacheLookup(originalHash: string): string | null {
  ensureCacheDir();
  const path = cacheFilePath(originalHash);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const content = readFileSync(path, "utf8");
    const record: TranslationRecord = JSON.parse(content);
    return record.translatedText;
  } catch (error) {
    logger.warn({ error: String(error), originalHash }, "[TRANSLATE] cache read failed");
    return null;
  }
}

/**
 * Stores a translation result in the checkpoint cache.
 */
export function cacheStore(
  originalHash: string,
  translatedText: string,
  model: string,
  language: string,
): void {
  ensureCacheDir();
  const path = cacheFilePath(originalHash);
  const record: TranslationRecord = {
    originalHash,
    translatedText,
    model,
    language,
    timestamp: Date.now(),
  };
  try {
    writeFileSync(path, JSON.stringify(record), "utf8");
  } catch (error) {
    logger.warn({ error: String(error), originalHash }, "[TRANSLATE] cache write failed");
  }
}

/**
 * Returns a promise for the translation, deduplicating concurrent requests
 * for the same segment.
 */
export function getOrCreateInflight(
  originalHash: string,
  factory: () => Promise<string>,
): Promise<string> {
  const existing = inflightSegments.get(originalHash);
  if (existing) {
    return existing;
  }
  const promise = factory().finally(() => {
    inflightSegments.delete(originalHash);
  });
  inflightSegments.set(originalHash, promise);
  return promise;
}
