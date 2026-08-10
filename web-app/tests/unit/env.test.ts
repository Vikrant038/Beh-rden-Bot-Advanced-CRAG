import { describe, it, expect, vi } from "vitest";
import { normalizeUrl } from "@/server/env";

describe("normalizeUrl", () => {
  it("returns undefined for non-string input", () => {
    expect(normalizeUrl(undefined)).toBeUndefined();
    expect(normalizeUrl(42)).toBeUndefined();
    expect(normalizeUrl(null)).toBeUndefined();
  });

  it("returns undefined for empty/whitespace strings", () => {
    expect(normalizeUrl("")).toBeUndefined();
    expect(normalizeUrl("   ")).toBeUndefined();
  });

  it("prepends https:// to a bare host without a scheme", () => {
    expect(normalizeUrl("my-app.vercel.app")).toBe("https://my-app.vercel.app");
  });

  it("keeps an explicit scheme and strips a trailing slash", () => {
    expect(normalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
    expect(normalizeUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("returns undefined for an invalid URL", () => {
    expect(normalizeUrl("not a url at all !!!")).toBeUndefined();
    expect(normalizeUrl("://missing-scheme-host")).toBeUndefined();
  });
});

describe("loadServerEnv", () => {
  it("throws a helpful error when required variables are missing", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NEXTAUTH_SECRET", "");
    await expect(import("@/server/env")).rejects.toThrow(/Invalid server environment variables/);
    vi.unstubAllEnvs();
  });

  it("treats empty-string platform vars as unset so defaults apply", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/db");
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("GROQ_MODEL", "");
    vi.stubEnv("EMBEDDING_PROVIDER", "");
    const mod = await import("@/server/env");
    expect(mod.env.NEXTAUTH_URL).toBe("http://localhost:3000");
    expect(mod.env.GROQ_MODEL).toBe("llama-3.1-8b-instant");
    expect(mod.env.EMBEDDING_PROVIDER).toBe("hf");
    vi.unstubAllEnvs();
  });

  it("falls RERANKER_URL back to the HF inference URL when the legacy default is set", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/db");
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
    vi.stubEnv("HF_INFERENCE_URL", "https://worker.example.com");
    vi.stubEnv("RERANKER_URL", "https://api-inference.huggingface.co");
    const mod = await import("@/server/env");
    expect(mod.env.RERANKER_URL).toBe("https://worker.example.com");
    vi.unstubAllEnvs();
  });

  it("treats an empty RERANKER_URL as unset and inherits the HF inference URL", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/db");
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
    vi.stubEnv("HF_INFERENCE_URL", "https://worker.example.com");
    vi.stubEnv("RERANKER_URL", "");
    const mod = await import("@/server/env");
    expect(mod.env.RERANKER_URL).toBe("https://worker.example.com");
    vi.unstubAllEnvs();
  });
});
