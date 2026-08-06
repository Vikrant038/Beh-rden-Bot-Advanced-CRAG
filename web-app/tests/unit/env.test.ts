import { describe, it, expect } from "vitest";
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
