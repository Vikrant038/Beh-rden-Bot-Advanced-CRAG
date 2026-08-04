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
    "document.ingestUrl": () => ({ jobId: "url-job", queued: true }),
    "document.sync": () => ({ enqueued: 0, alreadyPending: 0 }),
    "document.delete": () => ({ deleted: 1 }),
    "document.jobGet": () => ({
      id: "pdf-job",
      type: "PDF",
      status: "DONE",
      error: null,
      result: { title: "valid-guide.pdf", status: "created", chunkCount: 7 },
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }),
    "document.jobStats": () => ({ queued: 0, running: 0, done24h: 0, failed24h: 0 }),
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
    "admin.recentQueries": () => ({ items: [], nextCursor: null }),
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

test("ingests a valid text PDF successfully (enqueued, then polled to DONE)", async ({ page }) => {
  await openDocuments(page, async (route) => {
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ jobId: "pdf-job", queued: true }),
    });
  });

  await selectFile(page, VALID_PDF);
  await page.getByRole("button", { name: /Upload valid-guide\.pdf/ }).click();

  // The upload returns 202 + jobId; the UI polls jobGet until DONE, then
  // reports the final ingest result from the job payload.
  await expect(
    page.getByText(/Ingested valid-guide\.pdf → created \(7 child chunks\)/),
  ).toBeVisible();
});

test("rejects an oversized PDF on the server with 413", async ({ page }) => {
  // The UI rejects >4 MB client-side, so exercise the server-side guard
  // directly against the upload route (defense in depth).
  await setSessionCookie(page.context(), { role: "ADMIN" });
  const oversized = Buffer.alloc(5 * 1024 * 1024, 0x25);

  const response = await page.request.post("/api/admin/documents/upload", {
    multipart: {
      file: { name: "huge.pdf", mimeType: "application/pdf", buffer: oversized },
    },
    headers: { Accept: "application/json" },
  });

  expect(response.status()).toBe(413);
  await expect(response.json()).resolves.toMatchObject({ error: "File exceeds 4 MB limit" });
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
  await fileInput.setInputFiles({
    name: "big.pdf",
    mimeType: "application/pdf",
    buffer: oversized,
  });

  await expect(page.getByText("File exceeds the 4 MB limit.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Upload big\.pdf/ })).toHaveCount(0);
});
