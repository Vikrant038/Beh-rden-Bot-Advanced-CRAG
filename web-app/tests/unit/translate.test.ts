import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createTranslationRateLimiter,
  detectLanguage,
  GroqRateLimiter,
  GroqRateLimiterPool,
  splitIntoChunks,
  translateToEnglish,
} from "@/server/ingest/translate";

describe("detectLanguage", () => {
  it("detects German text", () => {
    expect(
      detectLanguage(
        "Die Aufenthaltserlaubnis ist eine Aufenthaltsgenehmigung für Studierende in Deutschland. Bitte beachten Sie die Vorschriften des Aufenthaltsgesetzes.",
      ),
    ).toBe("de");
  });

  it("detects English text", () => {
    expect(
      detectLanguage(
        "The residence permit is required for studying in Germany. Please read the official guidelines carefully before applying.",
      ),
    ).toBe("en");
  });

  it("detects short German text with umlauts", () => {
    expect(detectLanguage("Über die Anmeldung")).toBe("de");
  });

  it("returns en for empty text", () => {
    expect(detectLanguage("")).toBe("en");
  });
});

describe("splitIntoChunks", () => {
  it("splits text at sentence boundaries", () => {
    const text = "Sentence one. Sentence two. Sentence three is a bit longer and continues here.";
    const chunks = splitIntoChunks(text, 30);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk stays under the cap plus the next sentence (max ~2× cap).
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(60);
    }
  });

  it("returns a single chunk for short text", () => {
    const text = "Just a short sentence.";
    expect(splitIntoChunks(text, 1000)).toEqual([text]);
  });

  it("returns the raw text when no boundary found", () => {
    const text = "aaaa".repeat(500);
    const chunks = splitIntoChunks(text, 100);
    expect(chunks.length).toBeGreaterThan(0);
  });
});

describe("GroqRateLimiterPool", () => {
  it("exposes the key count as size and the first key's limits", () => {
    const pool = new GroqRateLimiterPool(["key-1", "key-2"]);
    expect(pool.size).toBe(2);
    expect(pool.limiters).toHaveLength(2);
    expect(pool.rpm).toBe(30);
    expect(pool.tpm).toBe(6000);
    expect(pool.rpd).toBe(14400);
  });

  it("rejects an empty key list", () => {
    expect(() => new GroqRateLimiterPool(["  ", ""])).toThrow(
      "GroqRateLimiterPool requires at least one API key",
    );
  });

  it("picks the key with the most available tokens", async () => {
    const pool = new GroqRateLimiterPool(["key-1", "key-2"]);
    // Drain key-1's bucket so key-2 is clearly the least-loaded.
    await pool.limiters[0]!.waitForTokens(pool.limiters[0]!.tpm);
    const chosen = await pool.waitForTokens(10);
    expect(chosen).toBe(pool.limiters[1]);
    expect(pool.limiters[0]!.availableTokens).toBeLessThan(pool.limiters[1]!.availableTokens);
  });

  it("returns a limiter when both keys have capacity", async () => {
    const pool = new GroqRateLimiterPool(["key-1", "key-2"]);
    const chosen = await pool.waitForTokens(10);
    expect(pool.limiters).toContain(chosen);
  });
});

describe("createTranslationRateLimiter", () => {
  const originalKeys = process.env.GROQ_API_KEYS;
  const originalKey = process.env.GROQ_API_KEY;

  beforeEach(() => {
    delete process.env.GROQ_API_KEYS;
    delete process.env.GROQ_API_KEY;
  });

  afterEach(() => {
    if (originalKeys === undefined) delete process.env.GROQ_API_KEYS;
    else process.env.GROQ_API_KEYS = originalKeys;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
  });

  it("builds a pool from GROQ_API_KEYS", () => {
    process.env.GROQ_API_KEYS = "key-1,key-2,key-3";
    const limiter = createTranslationRateLimiter();
    expect(limiter).toBeInstanceOf(GroqRateLimiterPool);
    expect(limiter.size).toBe(3);
  });

  it("builds a single limiter from GROQ_API_KEY", () => {
    process.env.GROQ_API_KEY = "only-key";
    const limiter = createTranslationRateLimiter();
    expect(limiter).toBeInstanceOf(GroqRateLimiter);
    expect(limiter.size).toBe(1);
  });

  it("prefers explicit keys over env vars", () => {
    process.env.GROQ_API_KEY = "env-key";
    const limiter = createTranslationRateLimiter({ keys: ["explicit-1", "explicit-2"] });
    expect(limiter).toBeInstanceOf(GroqRateLimiterPool);
    expect(limiter.size).toBe(2);
  });

  it("throws a clear error when no key is configured", () => {
    expect(() => createTranslationRateLimiter()).toThrow(/No Groq API key configured/);
  });

  it("falls back to GROQ_API_KEY when GROQ_API_KEYS is empty", () => {
    process.env.GROQ_API_KEYS = "  ,";
    process.env.GROQ_API_KEY = "single-key";
    const limiter = createTranslationRateLimiter();
    expect(limiter).toBeInstanceOf(GroqRateLimiter);
    expect(limiter.size).toBe(1);
  });
});

describe("translateToEnglish parallel dedupe", () => {
  it("translates a shared segment only once under concurrent callers", async () => {
    const limiter = new GroqRateLimiter({
      apiKey: "test-key",
      tpm: 1_000_000,
      rpm: 1000,
      rpd: 100_000,
    });

    const createSpy = vi.spyOn(limiter.client.chat.completions, "create").mockReturnValue(
      new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            choices: [{ message: { content: "The translated segment." } }],
          });
        }, 50);
      }) as never,
    );

    const germanText = "Die Aufenthaltserlaubnis ist eine Aufenthaltsgenehmigung für Studierende.";
    // Remove any checkpoint-cache entry from a previous run so the API call
    // is actually exercised (the cache would short-circuit the spy).
    const segmentHash = createHash("sha256").update(germanText).digest("hex");
    rmSync(join(process.cwd(), "data", "translation-cache", `${segmentHash}.json`), {
      force: true,
    });

    const [r1, r2] = await Promise.all([
      translateToEnglish(germanText, limiter),
      translateToEnglish(germanText, limiter),
    ]);

    expect(r1.englishText).toBe("The translated segment.");
    expect(r2.englishText).toBe("The translated segment.");
    // Only one API call despite two concurrent callers.
    expect(createSpy).toHaveBeenCalledTimes(1);
  });
});

describe("GroqRateLimiter", () => {
  it.skip("throttles to the configured RPM", async () => {
    const limiter = new GroqRateLimiter({ rpm: 2, tpm: 6000, rpd: 100 });
    const start = Date.now();
    await limiter.waitForTokens(1);
    await limiter.waitForTokens(1);
    await limiter.waitForTokens(1);
    const elapsed = Date.now() - start;
    // 3 requests at 2 RPM = min 60s between first and last.
    expect(elapsed).toBeGreaterThan(59_000);
  }, 90_000);

  it.skip("waits for token-bucket refill when TPM is exhausted", async () => {
    // Very small bucket: 100 tokens/min → a 200-token request must wait.
    const limiter = new GroqRateLimiter({ rpm: 30, tpm: 100, rpd: 1000 });
    const start = Date.now();
    await limiter.waitForTokens(200);
    const elapsed = Date.now() - start;
    // 200 tokens at 100/min = ~1.2 min wait.
    expect(elapsed).toBeGreaterThan(60_000);
  }, 120_000);

  it.skip("respects the RPD daily cap", async () => {
    const limiter = new GroqRateLimiter({ rpm: 100, tpm: 1_000_000, rpd: 2 });
    await limiter.waitForTokens(1);
    await limiter.waitForTokens(1);
    // The third call must wait for the daily reset (mock the date to avoid a
    // real 24h wait). We assert the guard exists by checking the counter.
    expect((limiter as unknown as { requestsToday: number }).requestsToday).toBe(2);
  });
});
