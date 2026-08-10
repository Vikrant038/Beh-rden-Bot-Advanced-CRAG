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

const SEVENTY_B = {
  model: "llama-3.3-70b-versatile",
  rpm: 30,
  rpd: 1000,
  tpm: 12000,
  tpd: 100000,
};

const SCOUT = {
  model: "meta-llama/llama-4-scout-17b-16e-instruct",
  rpm: 30,
  rpd: 1000,
  tpm: 30000,
  tpd: 500000,
};

describe("GroqRateLimiterPool", () => {
  it("exposes the key count as size and the preferred model's limits", () => {
    const pool = new GroqRateLimiterPool(["key-1", "key-2"]);
    expect(pool.size).toBe(2);
    expect(pool.keyLimiters(0)).toHaveLength(2);
    expect(pool.model).toBe("llama-3.3-70b-versatile");
    expect(pool.modelsList).toHaveLength(7);
    expect(pool.rpm).toBe(30);
    expect(pool.tpm).toBe(12000);
    expect(pool.rpd).toBe(1000);
    expect(pool.tpd).toBe(100000);
    expect(pool.totalTpd).toBeGreaterThan(1_000_000);
  });

  it("rejects an empty key list", () => {
    expect(() => new GroqRateLimiterPool(["  ", ""])).toThrow(
      "GroqRateLimiterPool requires at least one API key",
    );
  });

  it("picks the key with the most available tokens", async () => {
    const pool = new GroqRateLimiterPool(["key-1", "key-2"], [SEVENTY_B]);
    const [k1, k2] = pool.keyLimiters(0);
    // Drain key-1's bucket so key-2 is clearly the least-loaded.
    await k1.waitForTokens(k1.tpm);
    const chosen = await pool.waitForTokens(10);
    expect(chosen).toBe(k2);
    expect(k1.availableTokens).toBeLessThan(k2.availableTokens);
  });

  it("returns a limiter when both keys have capacity", async () => {
    const pool = new GroqRateLimiterPool(["key-1", "key-2"], [SEVENTY_B]);
    const chosen = await pool.waitForTokens(10);
    expect(pool.keyLimiters(0)).toContain(chosen);
  });

  it("falls back to the next model when the first model's daily budget is exhausted", async () => {
    const pool = new GroqRateLimiterPool(["key-1"], [{ ...SEVENTY_B, tpd: 50 }, SCOUT]);
    const first = await pool.waitForTokens(40);
    expect(first.model).toBe("llama-3.3-70b-versatile");
    // 40 + 40 = 80 > 50 → the 70b daily budget is spent → fall back to scout.
    const second = await pool.waitForTokens(40);
    expect(second.model).toBe("meta-llama/llama-4-scout-17b-16e-instruct");
  });

  it("shares a model's daily budget across keys", async () => {
    const pool = new GroqRateLimiterPool(["key-1", "key-2"], [{ ...SEVENTY_B, tpd: 90 }]);
    const [k1, k2] = pool.keyLimiters(0);
    const first = await pool.waitForTokens(40);
    const second = await pool.waitForTokens(40);
    expect(first.model).toBe("llama-3.3-70b-versatile");
    expect(second.model).toBe("llama-3.3-70b-versatile");
    // Both requests fit the shared 90-token budget (40 + 40 ≤ 90) and the
    // second goes to the other key (least-loaded).
    expect([k1, k2]).toContain(first);
    expect([k1, k2]).toContain(second);
    expect(first).not.toBe(second);
  });
});

describe("createTranslationRateLimiter", () => {
  const originalKeys = process.env.GROQ_API_KEYS;
  const originalKey = process.env.GROQ_API_KEY;
  const originalModels = process.env.GROQ_TRANSLATE_MODELS;
  const originalModel = process.env.GROQ_TRANSLATE_MODEL;
  const originalTpd = process.env.GROQ_TPD;

  beforeEach(() => {
    delete process.env.GROQ_API_KEYS;
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_TRANSLATE_MODELS;
    delete process.env.GROQ_TRANSLATE_MODEL;
    delete process.env.GROQ_TPD;
  });

  afterEach(() => {
    if (originalKeys === undefined) delete process.env.GROQ_API_KEYS;
    else process.env.GROQ_API_KEYS = originalKeys;
    if (originalKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = originalKey;
    if (originalModels === undefined) delete process.env.GROQ_TRANSLATE_MODELS;
    else process.env.GROQ_TRANSLATE_MODELS = originalModels;
    if (originalModel === undefined) delete process.env.GROQ_TRANSLATE_MODEL;
    else process.env.GROQ_TRANSLATE_MODEL = originalModel;
    if (originalTpd === undefined) delete process.env.GROQ_TPD;
    else process.env.GROQ_TPD = originalTpd;
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

  it("reads GROQ_TRANSLATE_MODEL and GROQ_TPD from env", () => {
    process.env.GROQ_API_KEY = "only-key";
    process.env.GROQ_TRANSLATE_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
    process.env.GROQ_TPD = "500000";
    const limiter = createTranslationRateLimiter();
    expect(limiter).toBeInstanceOf(GroqRateLimiter);
    expect(limiter.model).toBe("meta-llama/llama-4-scout-17b-16e-instruct");
    expect(limiter.tpm).toBe(30000);
    expect(limiter.tpd).toBe(500000);
  });

  it("reads GROQ_TRANSLATE_MODELS as the fallback chain", () => {
    process.env.GROQ_API_KEYS = "k1,k2";
    process.env.GROQ_TRANSLATE_MODELS =
      "llama-3.1-8b-instant,meta-llama/llama-4-scout-17b-16e-instruct";
    const limiter = createTranslationRateLimiter();
    expect(limiter).toBeInstanceOf(GroqRateLimiterPool);
    expect(limiter.modelsList).toEqual([
      "llama-3.1-8b-instant",
      "meta-llama/llama-4-scout-17b-16e-instruct",
    ]);
    expect(limiter.totalTpd).toBe(1_000_000);
  });

  it("applies model and tpd overrides to a pool", () => {
    const limiter = createTranslationRateLimiter({
      keys: ["k1", "k2"],
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      tpd: 500000,
    });
    expect(limiter).toBeInstanceOf(GroqRateLimiterPool);
    expect(limiter.model).toBe("meta-llama/llama-4-scout-17b-16e-instruct");
    expect(limiter.tpd).toBe(500000);
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

describe("GroqRateLimiter TPD guard", () => {
  it("accumulates a daily token counter per request", async () => {
    const limiter = new GroqRateLimiter({ rpm: 1000, tpm: 1_000_000, rpd: 1_000_000, tpd: 100 });
    await limiter.waitForTokens(40);
    await limiter.waitForTokens(40);
    const state = limiter as unknown as { tokensToday: number };
    expect(state.tokensToday).toBe(80);
  });

  it("does not count tokens when tpd is unset", async () => {
    const limiter = new GroqRateLimiter({ rpm: 1000, tpm: 1_000_000, rpd: 1_000_000 });
    await limiter.waitForTokens(40);
    const state = limiter as unknown as { tokensToday: number };
    expect(state.tokensToday).toBe(0);
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
