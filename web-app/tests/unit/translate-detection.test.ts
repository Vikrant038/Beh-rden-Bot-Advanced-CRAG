import { describe, it, expect, vi } from "vitest";
import { detectLanguageLlm, GroqRateLimiter } from "@/server/ingest/translate";

function makeLimiter(): GroqRateLimiter {
  return new GroqRateLimiter({ apiKey: "test-key", tpm: 1_000_000, rpm: 1000, rpd: 100_000 });
}

describe("detectLanguageLlm (LLM-based detection)", () => {
  it("returns the ISO code from the LLM JSON response", async () => {
    const limiter = makeLimiter();
    const spy = vi
      .spyOn(limiter.client.chat.completions, "create")
      .mockResolvedValue({ choices: [{ message: { content: '{"language": "de"}' } }] } as never);
    await expect(
      detectLanguageLlm("Die Aufenthaltserlaubnis ist erforderlich.", limiter),
    ).resolves.toBe("de");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("handles fenced JSON", async () => {
    const limiter = makeLimiter();
    vi.spyOn(limiter.client.chat.completions, "create").mockResolvedValue({
      choices: [{ message: { content: '```json\n{"language": "hi"}\n```' } }],
    } as never);
    await expect(detectLanguageLlm("कुछ हिंदी पाठ", limiter)).resolves.toBe("hi");
  });

  it("returns en for English text", async () => {
    const limiter = makeLimiter();
    vi.spyOn(limiter.client.chat.completions, "create").mockResolvedValue({
      choices: [{ message: { content: '{"language": "en"}' } }],
    } as never);
    await expect(
      detectLanguageLlm("The residence permit is required for studying.", limiter),
    ).resolves.toBe("en");
  });

  it("normalizes noisy language codes", async () => {
    const limiter = makeLimiter();
    vi.spyOn(limiter.client.chat.completions, "create").mockResolvedValue({
      choices: [{ message: { content: '{"language": " DE "}' } }],
    } as never);
    await expect(detectLanguageLlm("irgendwas", limiter)).resolves.toBe("de");
  });

  it("falls back to the regex heuristic when the LLM call fails", async () => {
    const limiter = makeLimiter();
    vi.spyOn(limiter.client.chat.completions, "create").mockRejectedValue(
      Object.assign(new Error("boom"), { status: 503 }) as never,
    );
    await expect(
      detectLanguageLlm(
        "Die Aufenthaltserlaubnis ist eine Aufenthaltsgenehmigung für Studierende.",
        limiter,
      ),
    ).resolves.toBe("de");
  });

  it("falls back to en when the LLM response is not valid JSON", async () => {
    const limiter = makeLimiter();
    vi.spyOn(limiter.client.chat.completions, "create").mockResolvedValue({
      choices: [{ message: { content: "sorry, no json here" } }],
    } as never);
    await expect(
      detectLanguageLlm("The residence permit is required for studying.", limiter),
    ).resolves.toBe("en");
  });

  it("returns en for empty text without an LLM call", async () => {
    const limiter = makeLimiter();
    const spy = vi.spyOn(limiter.client.chat.completions, "create");
    await expect(detectLanguageLlm("   ", limiter)).resolves.toBe("en");
    expect(spy).not.toHaveBeenCalled();
  });
});
