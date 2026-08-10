import { describe, it, expect, vi } from "vitest";

describe("config/app", () => {
  it("falls back to localhost when NEXTAUTH_URL is unset", async () => {
    vi.resetModules();
    vi.stubEnv("NEXTAUTH_URL", undefined);
    const mod = await import("@/config/app");
    expect(mod.APP_URL).toBe("http://localhost:3000");
    expect(mod.SEO_BASE_URL).toBe("http://localhost:3000");
    vi.unstubAllEnvs();
  });

  it("resolves APP_URL to the origin of a valid NEXTAUTH_URL", async () => {
    vi.resetModules();
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com/some/path");
    const mod = await import("@/config/app");
    expect(mod.APP_URL).toBe("https://app.example.com");
    vi.unstubAllEnvs();
  });

  it("falls back to localhost when NEXTAUTH_URL is not a valid URL", async () => {
    vi.resetModules();
    vi.stubEnv("NEXTAUTH_URL", "not a url");
    const mod = await import("@/config/app");
    expect(mod.APP_URL).toBe("http://localhost:3000");
    vi.unstubAllEnvs();
  });

  it("prefers NEXT_PUBLIC_SITE_URL for the SEO base URL when set", async () => {
    vi.resetModules();
    vi.stubEnv("NEXTAUTH_URL", "https://app.example.com");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://seo.example.com");
    const mod = await import("@/config/app");
    expect(mod.SEO_BASE_URL).toBe("https://seo.example.com");
    expect(mod.APP_URL).toBe("https://app.example.com");
    vi.unstubAllEnvs();
  });
});
