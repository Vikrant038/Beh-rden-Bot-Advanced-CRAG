import { test, expect, type Page, type Route } from "@playwright/test";
import { setSessionCookie } from "./helpers/auth";
import { mockTrpc } from "./helpers/trpc-mock";
import { resolve } from "node:path";

const FIXTURES = resolve(process.cwd(), "tests/e2e/fixtures");
const VALID_PDF = resolve(FIXTURES, "valid-guide.pdf");
const IMAGE_ONLY_PDF = resolve(FIXTURES, "image-only.pdf");

async function openDocuments(page: Page, uploadHandler?: (route: Route) => Promise<void>) {
  await setSessionCookie(page.context(), { role: "ADMIN" });
  await mockTrpc(page, {
    "source.list": () => [],
    "document.ingestUrl": () => ({
      url: "https://example.com",
      title: "Example",
      status: "created",
      chunkCount: 5,
      hash: "h",
      cacheInvalidated: 0,
    }),
    "document.sync": () => ({ failed: 0, total: 0, results: [] }),
    "document.delete": () => ({ deleted: 1 }),
    "admin.clearCache": () => ({ cleared: true }),
    "admin.metrics": () => ({
      totalUsers: 1,
      totalMessages: 1,
      queriesToday: 0,
      cacheHitRate: 0,
      avgLatencyMs: 0,
    }),
    "admin.dailyQueries": () => [],
    "admin.modeSplit": () => [],
    "admin.recentQueries": () => [],
  });
  if (uploadHandler) {
    await page.route("**/api/admin/documents/upload", uploadHandler);
  }
  await page.goto("/admin/documents");
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
}

async function selectFile(page: Page, path: string) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(path);
}

test("ingests a valid text PDF successfully", async ({ page }) => {
  await openDocuments(page, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        url: "pdf://abc/valid-guide.pdf",
        title: "valid-guide.pdf",
        status: "created",
        chunkCount: 7,
        parentCount: 1,
        hash: "h",
        cacheInvalidated: 0,
        filename: "valid-guide.pdf",
      }),
    });
  });

  await selectFile(page, VALID_PDF);
  await page.getByRole("button", { name: /Upload valid-guide\.pdf/ }).click();

  await expect(page.getByText(/Ingested valid-guide\.pdf → created \(7 child chunks\)/)).toBeVisible();
});

test("rejects an oversized PDF on the server with 413", async ({ page }) => {
  await openDocuments(page, async (route) => {
    await route.fulfill({
      status: 413,
      contentType: "application/json",
      body: JSON.stringify({ error: "File exceeds 4 MB limit" }),
    });
  });

  // Generate a >4 MiB buffer to satisfy the server-side size check.
  const oversized = Buffer.alloc(5 * 1024 * 1024, 0x25);
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "huge.pdf",
    mimeType: "application/pdf",
    buffer: oversized,
  });

  await page.getByRole("button", { name: /Upload huge\.pdf/ }).click();
  await expect(page.getByText("Upload failed: File exceeds 4 MB limit")).toBeVisible();
});

test("rejects a scanned/image-only PDF with 422", async ({ page }) => {
  await openDocuments(page, async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: "PDF contains no extractable text (scanned/image-only?)",
      }),
    });
  });

  await selectFile(page, IMAGE_ONLY_PDF);
  await page.getByRole("button", { name: /Upload image-only\.pdf/ }).click();

  await expect(
    page.getByText("Upload failed: PDF contains no extractable text (scanned/image-only?)"),
  ).toBeVisible();
});

test("rejects an oversized file client-side before uploading", async ({ page }) => {
  await openDocuments(page);

  const oversized = Buffer.alloc(5 * 1024 * 1024, 0x25);
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({ name: "big.pdf", mimeType: "application/pdf", buffer: oversized });

  await expect(page.getByText("File exceeds the 4 MB limit.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Upload big\.pdf/ })).toHaveCount(0);
});
