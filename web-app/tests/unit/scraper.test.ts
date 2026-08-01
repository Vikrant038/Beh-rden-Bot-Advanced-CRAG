import { vi, describe, it, expect, beforeEach } from "vitest";
import { scrapeWebPage, extractMainContent, SCRAPE_TIMEOUT_MS } from "@/server/ingest/scraper";

vi.mock("@/server/lib/security/url-validator", () => ({
  assertSafeUrl: vi.fn(),
}));

import { assertSafeUrl } from "@/server/lib/security/url-validator";
import { SsrfBlockedError, ExternalApiError } from "@/server/lib/errors";

const mockedAssertSafeUrl = vi.mocked(assertSafeUrl);

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>DAAD — Study in Germany</title>
  <script>var track = true;</script>
  <style>.hidden { display: none; }</style>
</head>
<body>
  <nav>Home About Contact</nav>
  <main>
    <h1>Study in Germany</h1>
    <p>German universities offer world-class education at low tuition fees.</p>
    <p>International students must obtain a student visa before arrival.</p>
    <ul><li>Blocked account required</li><li>Health insurance required</li></ul>
  </main>
  <footer>Imprint</footer>
</body>
</html>
`;

function mockFetchResponse(body: string, status = 200, contentType = "text/html"): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": contentType }),
    text: () => Promise.resolve(body),
  } as Response);
}

describe("scrapeWebPage", () => {
  beforeEach(() => {
    mockedAssertSafeUrl.mockReset();
    mockedAssertSafeUrl.mockResolvedValue();
    globalThis.fetch = vi.fn();
  });

  it("extracts title and main content from HTML", async () => {
    mockFetchResponse(SAMPLE_HTML);
    const result = await scrapeWebPage("https://www.daad.de/en/study/");
    expect(result.title).toBe("DAAD — Study in Germany");
    expect(result.url).toBe("https://www.daad.de/en/study/");
    expect(result.text).toContain("Study in Germany");
    expect(result.text).toContain("student visa");
    expect(result.text).toContain("Blocked account required");
    expect(result.text).not.toContain("Home About Contact");
    expect(result.text).not.toContain("Imprint");
  });

  it("validates the URL against the SSRF guard", async () => {
    mockedAssertSafeUrl.mockRejectedValue(new SsrfBlockedError("http://127.0.0.1/"));
    await expect(scrapeWebPage("http://127.0.0.1/admin")).rejects.toThrow(SsrfBlockedError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects when content is too short", async () => {
    mockFetchResponse("<html><body><p>Too short.</p></body></html>");
    await expect(scrapeWebPage("https://example.com/short")).rejects.toThrow(ExternalApiError);
  });

  it("rejects on non-2xx HTTP status", async () => {
    mockFetchResponse("Server Error", 500);
    await expect(scrapeWebPage("https://example.com/500")).rejects.toThrow(ExternalApiError);
  });

  it("rejects when fetch itself fails", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(scrapeWebPage("https://example.com")).rejects.toThrow(ExternalApiError);
  });
});

describe("extractMainContent", () => {
  it("uses main/article region when present", () => {
    const { title, text } = extractMainContent(SAMPLE_HTML);
    expect(title).toBe("DAAD — Study in Germany");
    expect(text).toContain("Study in Germany");
    expect(text).not.toContain("Home About Contact");
  });

  it("falls back to body when no main/article", () => {
    const html = "<html><head><title>T</title></head><body><p>Plain body text here.</p></body></html>";
    const { text } = extractMainContent(html);
    expect(text).toContain("Plain body text here.");
  });

  it("decodes HTML entities", () => {
    const { text } = extractMainContent("<html><body><p>M&uuml;nchen &amp; Berlin</p></body></html>");
    expect(text).toContain("München & Berlin");
  });

  it("returns empty text for empty html", () => {
    const { text } = extractMainContent("");
    expect(text).toBe("");
  });
});

describe("constants", () => {
  it("defines a sane fetch timeout", () => {
    expect(SCRAPE_TIMEOUT_MS).toBeGreaterThan(0);
    expect(SCRAPE_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
