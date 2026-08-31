import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createTranslationRateLimiter,
  detectLanguage,
  detectLanguageLlm,
  GroqRateLimiter,
  GroqRateLimiterPool,
  splitIntoChunks,
  translateToEnglish,
  type TranslationRateLimiter,
} from "@/server/ingest/translate";

// The LLM detection call is replaced with a stub so the translateToEnglish
// tests below keep exercising the segment-translation path in isolation — the
// real detection behavior is covered in tests/unit/translate-detection.test.ts.
// NOTE: translateToEnglish closes over the REAL detectLanguageLlm internally,
// so replacing just the export would leak real detection calls into these
// tests (each one would burn a client call + regex-fallback). The wrapper
// routes detection through the injected mock instead.
vi.mock("@/server/ingest/translate", async () => {
  const actual = await vi.importActual<typeof import("@/server/ingest/translate")>(
    "@/server/ingest/translate",
  );
  const detectLanguageLlmMock = vi.fn();
  return {
    ...actual,
    detectLanguageLlm: detectLanguageLlmMock,
    translateToEnglish: (text: string, rateLimiter: TranslationRateLimiter) =>
      actual.translateToEnglish(text, rateLimiter, detectLanguageLlmMock),
  };
});

const mockedDetectLanguageLlm = vi.mocked(detectLanguageLlm);

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

/** Clears the segment's on-disk checkpoint so the API call is actually exercised. */
const clearSegmentCache = (text: string): void =>
  rmSync(
    join(
      process.cwd(),
      "data",
      "translation-cache",
      `${createHash("sha256").update(text).digest("hex")}.json`,
    ),
    {
      force: true,
    },
  );

const PRIMARY = {
  model: "openai/gpt-oss-120b",
  rpm: 1000,
  rpd: 0,
  tpm: 250_000,
  tpd: 0,
};

const FALLBACK = {
  model: "qwen/qwen3-32b",
  rpm: 60,
  rpd: 1000,
  tpm: 6000,
  tpd: 500000,
};

describe("GroqRateLimiterPool", () => {
  it("exposes the key count as size and the preferred model's limits", () => {
    const pool = new GroqRateLimiterPool(["key-1", "key-2"]);
    expect(pool.size).toBe(2);
    expect(pool.keyLimiters(0)).toHaveLength(2);
    expect(pool.model).toBe("openai/gpt-oss-120b");
    expect(pool.modelsList).toHaveLength(4);
    expect(pool.rpm).toBe(1000);
    expect(pool.tpm).toBe(250_000);
    expect(pool.rpd).toBe(0);
    expect(pool.tpd).toBe(0);
    expect(pool.totalTpd).toBe(1_000_000);
  });

  it("rejects an empty key list", () => {
    expect(() => new GroqRateLimiterPool(["  ", ""])).toThrow(
      "GroqRateLimiterPool requires at least one API key",
    );
  });

  it("picks the key with the most available tokens", async () => {
    const pool = new GroqRateLimiterPool(["key-1", "key-2"], [PRIMARY]);
    const [k1, k2] = pool.keyLimiters(0);
    // Drain key-1's bucket so key-2 is clearly the least-loaded.
    await k1.waitForTokens(k1.tpm);
    const chosen = await pool.waitForTokens(10);
    expect(chosen).toBe(k2);
    expect(k1.availableTokens).toBeLessThan(k2.availableTokens);
  });

  it("returns a limiter when both keys have capacity", async () => {
    const pool = new GroqRateLimiterPool(["key-1", "key-2"], [PRIMARY]);
    const chosen = await pool.waitForTokens(10);
    expect(pool.keyLimiters(0)).toContain(chosen);
  });

  it("falls back to the next model when the first model's daily budget is exhausted", async () => {
    const pool = new GroqRateLimiterPool(["key-1"], [{ ...PRIMARY, tpd: 50 }, FALLBACK]);
    const first = await pool.waitForTokens(40);
    expect(first.model).toBe("openai/gpt-oss-120b");
    // 40 + 40 = 80 > 50 → the primary daily budget is spent → fall back.
    const second = await pool.waitForTokens(40);
    expect(second.model).toBe("qwen/qwen3-32b");
  });
  it("shares a model's daily budget across keys", async () => {
    const pool = new GroqRateLimiterPool(["key-1", "key-2"], [{ ...PRIMARY, tpd: 90 }]);
    const [k1, k2] = pool.keyLimiters(0);
    const first = await pool.waitForTokens(40);
    const second = await pool.waitForTokens(40);
    expect(first.model).toBe("openai/gpt-oss-120b");
    expect(second.model).toBe("openai/gpt-oss-120b");

    // Both requests fit the shared 90-token budget (40 + 40 ≤ 90) and the
    // second goes to the other key (least-loaded).
    expect([k1, k2]).toContain(first);
    expect([k1, k2]).toContain(second);
    expect(first).not.toBe(second);
  });

  it("skips a blacklisted model and returns the next one", async () => {
    const pool = new GroqRateLimiterPool(["key-1"], [PRIMARY, FALLBACK]);
    pool.blacklistModel("openai/gpt-oss-120b");
    const chosen = await pool.waitForTokens(10);
    expect(chosen.model).toBe("qwen/qwen3-32b");
    expect(pool.liveModels).toEqual(["qwen/qwen3-32b"]);
  });

  it("throws when every model is blacklisted", async () => {
    const pool = new GroqRateLimiterPool(["key-1"], [PRIMARY, FALLBACK]);
    pool.blacklistModel("openai/gpt-oss-120b");
    pool.blacklistModel("qwen/qwen3-32b");
    await expect(pool.waitForTokens(10)).rejects.toThrow(/All translation models are unavailable/);
  });

  it("blacklisting an unknown model is a no-op", async () => {
    const pool = new GroqRateLimiterPool(["key-1"], [PRIMARY]);
    pool.blacklistModel("not-a-model");
    expect(pool.liveModels).toEqual(["openai/gpt-oss-120b"]);
  });

  it("exhausting a model's daily budget makes waitForTokens skip it", async () => {
    const pool = new GroqRateLimiterPool(["key-1"], [{ ...PRIMARY, tpd: 100 }, FALLBACK]);
    pool.exhaustModelToday("openai/gpt-oss-120b");
    const chosen = await pool.waitForTokens(10);
    expect(chosen.model).toBe("qwen/qwen3-32b");
    // The model is NOT blacklisted — just spent for today.
    expect(pool.liveModels).toEqual(["openai/gpt-oss-120b", "qwen/qwen3-32b"]);
  });

  it("exhausting an unknown model is a no-op", async () => {
    const pool = new GroqRateLimiterPool(["key-1"], [PRIMARY]);
    pool.exhaustModelToday("not-a-model");
    const chosen = await pool.waitForTokens(10);
    expect(chosen.model).toBe("openai/gpt-oss-120b");
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
    process.env.GROQ_TRANSLATE_MODEL = "qwen/qwen3-32b";
    process.env.GROQ_TPD = "500000";
    const limiter = createTranslationRateLimiter();
    expect(limiter).toBeInstanceOf(GroqRateLimiter);
    expect(limiter.model).toBe("qwen/qwen3-32b");
    expect(limiter.tpm).toBe(6000);
    expect(limiter.tpd).toBe(500000);
  });

  it("reads GROQ_TRANSLATE_MODELS as the fallback chain", () => {
    process.env.GROQ_API_KEYS = "k1,k2";
    process.env.GROQ_TRANSLATE_MODELS = "openai/gpt-oss-120b,qwen/qwen3-32b";
    const limiter = createTranslationRateLimiter();
    expect(limiter).toBeInstanceOf(GroqRateLimiterPool);
    expect(limiter.modelsList).toEqual(["openai/gpt-oss-120b", "qwen/qwen3-32b"]);
    expect(limiter.totalTpd).toBe(500_000);
  });

  it("applies model and tpd overrides to a pool", () => {
    const limiter = createTranslationRateLimiter({
      keys: ["k1", "k2"],
      model: "qwen/qwen3-32b",
      tpd: 500000,
    });
    expect(limiter).toBeInstanceOf(GroqRateLimiterPool);
    expect(limiter.model).toBe("qwen/qwen3-32b");
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
  beforeEach(() => {
    mockedDetectLanguageLlm.mockReset();
    mockedDetectLanguageLlm.mockResolvedValue("de");
  });

  it("skips translation when the LLM detects English", async () => {
    mockedDetectLanguageLlm.mockResolvedValueOnce("en");
    const limiter = new GroqRateLimiter({
      apiKey: "test-key",
      tpm: 1_000_000,
      rpm: 1000,
      rpd: 100_000,
    });
    const createSpy = vi.spyOn(limiter.client.chat.completions, "create");

    const result = await translateToEnglish(
      "The residence permit is required for studying in Germany.",
      limiter,
    );

    expect(result.translated).toBe(false);
    expect(result.language).toBe("en");
    expect(result.englishText).toBe("The residence permit is required for studying in Germany.");
    expect(createSpy).not.toHaveBeenCalled();
  });

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
    clearSegmentCache(germanText);

    const [r1, r2] = await Promise.all([
      translateToEnglish(germanText, limiter),
      translateToEnglish(germanText, limiter),
    ]);

    expect(r1.englishText).toBe("The translated segment.");
    expect(r2.englishText).toBe("The translated segment.");
    // Only one API call despite two concurrent callers.
    expect(createSpy).toHaveBeenCalledTimes(1);
    // The LLM detection is consulted once per document (via the shared
    // in-flight dedupe below the mock) and decides "de" → translate.
    expect(mockedDetectLanguageLlm).toHaveBeenCalledWith(
      expect.stringContaining("Aufenthaltserlaubnis"),
      limiter,
    );
  });

  it("retries the segment on the next model after a hard model error", async () => {
    const pool = new GroqRateLimiterPool(["key-1"], [{ ...PRIMARY, tpd: 100_000 }, FALLBACK]);
    const [primary] = pool.keyLimiters(0);
    const [fallback] = pool.keyLimiters(1);

    // A model-not-found response must remove that model from rotation rather
    // than stalling the whole chain.
    const hardError = Object.assign(
      new Error("The model `x` does not exist or you do not have access to it."),
      { status: 404 },
    );
    vi.spyOn(primary.client.chat.completions, "create").mockRejectedValue(hardError as never);
    vi.spyOn(fallback.client.chat.completions, "create").mockResolvedValue({
      choices: [{ message: { content: "Translated by fallback." } }],
    } as never);

    const germanText = "Die Aufenthaltserlaubnis ist eine Aufenthaltsgenehmigung für Studierende.";
    clearSegmentCache(germanText);

    const result = await translateToEnglish(germanText, pool);
    expect(result.englishText).toBe("Translated by fallback.");
    // Exactly one attempt on the dead model, then one on the fallback.
    expect(primary.client.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(fallback.client.chat.completions.create).toHaveBeenCalledTimes(1);
    // The dead model is out of rotation for the rest of the run.
    expect(pool.liveModels).toEqual(["qwen/qwen3-32b"]);
  });

  it("does not retry on transient errors (429/5xx)", async () => {
    const pool = new GroqRateLimiterPool(["key-1"], [PRIMARY, FALLBACK]);
    const [primary] = pool.keyLimiters(0);
    const [fallback] = pool.keyLimiters(1);

    const transient = Object.assign(new Error("over capacity"), { status: 503 });
    vi.spyOn(primary.client.chat.completions, "create").mockRejectedValue(transient as never);
    vi.spyOn(fallback.client.chat.completions, "create").mockResolvedValue({
      choices: [{ message: { content: "Translated by fallback." } }],
    } as never);

    const germanText = "Die Anmeldung muss bei der Meldebehörde erfolgen.";
    clearSegmentCache(germanText);

    // A transient error is surfaced to the caller (which falls back to the
    // original text) — the chain must NOT burn the next model's budget on it.
    await expect(translateToEnglish(germanText, pool)).rejects.toThrow("over capacity");
    expect(fallback.client.chat.completions.create).not.toHaveBeenCalled();
  });

  it("advances past a model whose daily budget the API reports as spent", async () => {
    const pool = new GroqRateLimiterPool(["key-1"], [{ ...PRIMARY, tpd: 100_000 }, FALLBACK]);
    const [primary] = pool.keyLimiters(0);
    const [fallback] = pool.keyLimiters(1);

    // Exactly the error from run 3: the pool's fresh in-process estimate said
    // The primary had budget locally, but Groq's server-side counter was already exhausted.
    const tpd429 = Object.assign(
      new Error(
        "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` " +
          "service tier `on_demand` on tokens per day (TPD): Limit 100000, Used 95738, Requested 5161.",
      ),
      { status: 429 },
    );
    vi.spyOn(primary.client.chat.completions, "create").mockRejectedValue(tpd429 as never);
    vi.spyOn(fallback.client.chat.completions, "create").mockResolvedValue({
      choices: [{ message: { content: "Translated by fallback." } }],
    } as never);

    const germanText = "Die Aufenthaltserlaubnis wird für das Studium benötigt.";
    clearSegmentCache(germanText);

    const result = await translateToEnglish(germanText, pool);
    expect(result.englishText).toBe("Translated by fallback.");
    expect(primary.client.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(fallback.client.chat.completions.create).toHaveBeenCalledTimes(1);

    // A second call must skip the primary entirely (its budget is marked spent)
    // and go straight to the fallback.
    const germanText2 = "Die Anmeldung muss bei der Meldebehörde erfolgen.";
    clearSegmentCache(germanText2);
    const second = await translateToEnglish(germanText2, pool);
    expect(second.englishText).toBe("Translated by fallback.");
    expect(primary.client.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(fallback.client.chat.completions.create).toHaveBeenCalledTimes(2);
  });
});

describe("GroqRateLimiter TPD guard", () => {
  it("accumulates a daily token counter per request", async () => {
    const limiter = new GroqRateLimiter({
      apiKey: "test-key",
      rpm: 1000,
      tpm: 1_000_000,
      rpd: 1_000_000,
      tpd: 100,
    });
    await limiter.waitForTokens(40);
    await limiter.waitForTokens(40);
    const state = limiter as unknown as { tokensToday: number };
    expect(state.tokensToday).toBe(80);
  });

  it("does not count tokens when tpd is unset", async () => {
    const limiter = new GroqRateLimiter({
      apiKey: "test-key",
      rpm: 1000,
      tpm: 1_000_000,
      rpd: 1_000_000,
    });
    await limiter.waitForTokens(40);
    const state = limiter as unknown as { tokensToday: number };
    expect(state.tokensToday).toBe(0);
  });

  it("resets tokensToday when the day rolls over in GroqRateLimiterPool", async () => {
    const pool = new GroqRateLimiterPool(
      ["test-key"],
      [{ model: "test-model-1", rpm: 100, tpm: 1000, tpd: 500, rpd: 100 }],
    );
    // simulate consumption on day X
    const state = pool as unknown as {
      tokensToday: number[];
      tpdResetDays: number[];
      hasModelBudget: (idx: number, tokens: number) => boolean;
    };
    state.tokensToday[0] = 450;
    state.tpdResetDays[0] = (new Date().getDate() + 1) % 30; // different day

    const hasBudget = state.hasModelBudget(0, 100);
    expect(hasBudget).toBe(true);
    expect(state.tokensToday[0]).toBe(0);
  });

  it("throws when all models are unavailable on the account", async () => {
    const pool = new GroqRateLimiterPool(
      ["test-key"],
      [{ model: "test-model-1", rpm: 100, tpm: 1000, tpd: 500, rpd: 100 }],
    );
    pool.blacklistModel("test-model-1");

    await expect(pool.waitForTokens(10)).rejects.toThrow(
      /All translation models are unavailable on this account/,
    );
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
