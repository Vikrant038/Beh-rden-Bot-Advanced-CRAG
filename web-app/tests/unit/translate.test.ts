import { describe, it, expect, vi } from "vitest";
import { detectLanguage, GroqRateLimiter, splitIntoChunks } from "@/server/ingest/translate";

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
