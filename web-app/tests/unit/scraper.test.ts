import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  scrapeWebPage,
  extractMainContent,
  SCRAPE_TIMEOUT_MS,
  SCRAPE_MAX_RETRIES,
  BROWSER_USER_AGENT,
} from "@/server/ingest/scraper";

vi.mock("@/server/lib/security/url-validator", () => ({
  assertSafeUrl: vi.fn(),
}));

import { assertSafeUrl } from "@/server/lib/security/url-validator";
import { SsrfBlockedError, ExternalApiError, InvalidContentTypeError } from "@/server/lib/errors";

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

function mockResponse(body: string, status = 200, contentType = "text/html"): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": contentType }),
    text: () => Promise.resolve(body),
  } as Response;
}

/** A bare non-2xx response (empty body) — the retry/status-code cases.
 * `location` turns it into a redirect hop; `body` carries an abortable stream. */
function errorResponse(
  status: number,
  opts: { location?: string; body?: { cancel: unknown } } = {},
): Response {
  return {
    ok: false,
    status,
    headers: opts.location ? new Headers({ location: opts.location }) : new Headers(),
    body: opts.body,
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

function mockFetchResponse(body: string, status = 200, contentType = "text/html"): void {
  globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(body, status, contentType));
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
    await expect(scrapeWebPage("https://example.com/500", { backoffMs: 1 })).rejects.toThrow(
      ExternalApiError,
    );
  });

  it("rejects when fetch itself fails", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(scrapeWebPage("https://example.com", { backoffMs: 1 })).rejects.toThrow(
      ExternalApiError,
    );
  });

  it("retries a transient 500 and succeeds on the second attempt", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(mockResponse(SAMPLE_HTML));

    const result = await scrapeWebPage("https://example.com/flaky", { backoffMs: 1 });
    expect(result.title).toBe("DAAD — Study in Germany");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 rate limit and succeeds", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(mockResponse(SAMPLE_HTML));

    const result = await scrapeWebPage("https://example.com/limited", { backoffMs: 1 });
    expect(result.title).toBe("DAAD — Study in Germany");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("recovers from a network error on retry", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(mockResponse(SAMPLE_HTML));

    const result = await scrapeWebPage("https://example.com/reset", { backoffMs: 1 });
    expect(result.title).toBe("DAAD — Study in Germany");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("fails after exhausting retries on a persistent 500", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(500));

    await expect(scrapeWebPage("https://example.com/down", { backoffMs: 1 })).rejects.toThrow(
      ExternalApiError,
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(SCRAPE_MAX_RETRIES + 1);
  });

  it("does not retry a non-retryable 404", async () => {
    mockFetchResponse("Not Found", 404);
    await expect(scrapeWebPage("https://example.com/missing", { backoffMs: 1 })).rejects.toThrow(
      ExternalApiError,
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 403 at most once before failing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(403));

    await expect(scrapeWebPage("https://example.com/gated", { backoffMs: 1 })).rejects.toThrow(
      /HTTP 403/,
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("sends a browser-like User-Agent instead of a bot agent", async () => {
    mockFetchResponse(SAMPLE_HTML);
    await scrapeWebPage("https://example.com/ua");
    const fetchMock = vi.mocked(globalThis.fetch);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(BROWSER_USER_AGENT);
    expect(headers["User-Agent"]).toContain("Mozilla/5.0");
    expect(headers["User-Agent"]).not.toContain("Bot");
  });

  it("rejects a JSON content type with InvalidContentTypeError", async () => {
    mockFetchResponse('{"data": []}', 200, "application/json");
    await expect(scrapeWebPage("https://example.com/api.json")).rejects.toThrow(
      InvalidContentTypeError,
    );
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("rejects a PDF content type", async () => {
    mockFetchResponse("%PDF-1.4", 200, "application/pdf");
    await expect(scrapeWebPage("https://example.com/file.pdf")).rejects.toThrow(
      InvalidContentTypeError,
    );
  });

  it("rejects a missing content type header", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.resolve(SAMPLE_HTML),
    } as Response);
    await expect(scrapeWebPage("https://example.com/no-header")).rejects.toThrow(
      InvalidContentTypeError,
    );
  });

  it("accepts text/html with a charset parameter", async () => {
    mockFetchResponse(SAMPLE_HTML, 200, "text/html; charset=UTF-8");
    const result = await scrapeWebPage("https://www.daad.de/en/study/");
    expect(result.title).toBe("DAAD — Study in Germany");
  });

  it("rejects when the declared content-length exceeds the cap", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/html", "content-length": "99999999" }),
      text: () => Promise.resolve(SAMPLE_HTML),
    } as Response);
    await expect(scrapeWebPage("https://example.com/huge")).rejects.toThrow(ExternalApiError);
    await expect(scrapeWebPage("https://example.com/huge")).rejects.toThrow(/too large/);
  });

  it("rejects when the decoded body exceeds the cap", async () => {
    const huge = `<html><body><p>${"x".repeat(6 * 1024 * 1024)}</p></body></html>`;
    mockFetchResponse(huge, 200, "text/html");
    await expect(scrapeWebPage("https://example.com/big")).rejects.toThrow(/too large/);
  });

  it("follows redirects hop-by-hop, re-validating every hop", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(302, { location: "/de/study/", body: { cancel } }))
      .mockResolvedValueOnce(mockResponse(SAMPLE_HTML));

    const result = await scrapeWebPage("https://www.daad.de/en/study/");

    expect(result.title).toBe("DAAD — Study in Germany");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    // The second hop resolves the relative Location against the first URL.
    expect(vi.mocked(globalThis.fetch).mock.calls[1]?.[0]).toBe("https://www.daad.de/de/study/");
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("propagates an SSRF rejection on a redirect hop immediately (no retry)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      errorResponse(302, {
        location: "http://169.254.169.254/latest/meta-data",
        body: { cancel: vi.fn().mockResolvedValue(undefined) },
      }),
    );
    mockedAssertSafeUrl.mockImplementation((url: string) =>
      url.includes("169.254.169.254")
        ? Promise.reject(new SsrfBlockedError(url))
        : Promise.resolve(),
    );

    await expect(scrapeWebPage("https://example.com/redirect")).rejects.toThrow(SsrfBlockedError);
    // SSRF rejections are deterministic — never retried.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a redirect chain longer than the hop cap", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      errorResponse(302, {
        location: "/next",
        body: { cancel: vi.fn().mockResolvedValue(undefined) },
      }),
    );

    await expect(scrapeWebPage("https://example.com/loop")).rejects.toThrow(/Too many redirects/);
  });

  it("clamps an absurd retry option to the hard cap", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(500));

    await expect(
      scrapeWebPage("https://example.com/cap", { maxRetries: 99, backoffMs: 1 }),
    ).rejects.toThrow(ExternalApiError);
    // MAX_RETRIES_CAP (5) + initial attempt = 6 fetches, not 100.
    expect(globalThis.fetch).toHaveBeenCalledTimes(6);
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
    const html =
      "<html><head><title>T</title></head><body><p>Plain body text here.</p></body></html>";
    const { text } = extractMainContent(html);
    expect(text).toContain("Plain body text here.");
  });

  it("decodes HTML entities", () => {
    const { text } = extractMainContent(
      "<html><body><p>M&uuml;nchen &amp; Berlin</p></body></html>",
    );
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

  it("defines a bounded retry budget", () => {
    expect(SCRAPE_MAX_RETRIES).toBeGreaterThanOrEqual(1);
    expect(SCRAPE_MAX_RETRIES).toBeLessThanOrEqual(5);
  });

  it("defines a browser-like User-Agent", () => {
    expect(BROWSER_USER_AGENT).toContain("Mozilla/5.0");
    expect(BROWSER_USER_AGENT).toContain("Chrome/");
  });
});
