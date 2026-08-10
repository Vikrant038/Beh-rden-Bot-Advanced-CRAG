import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("renders the hero, accordion features, and sign-in CTA", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Your AI guide to studying in Germany" }),
    ).toBeVisible();
    // Feature accordion: summary titles are visible while collapsed.
    await expect(page.getByText("3-Agent ReAct")).toBeVisible();
    await expect(page.getByText("Bilingual Retrieval")).toBeVisible();
    await expect(page.getByText("CRAG Gate")).toBeVisible();
    // Corpus + topics are collapsed behind a summary; expand it.
    await page.getByText("Explore the knowledge base").click();
    await expect(page.getByText("Built on a real legal corpus")).toBeVisible();

    const signIn = page.getByRole("link", { name: "Get started" });
    await expect(signIn).toBeVisible();
    await signIn.click();
    // First navigation to /login on a cold dev server compiles the route server-side.
    await expect(page).toHaveURL(/\/login$/, { timeout: 15000 });
  });

  test("sample chips prefill a chat query (guests and signed-in users)", async ({ page }) => {
    await page.goto("/");

    const visaChip = page.getByRole("link", { name: /Visa documents/ });
    await expect(visaChip).toBeVisible();
    await expect(visaChip).toHaveAttribute(
      "href",
      `/chat?q=${encodeURIComponent("What documents do I need for a German student visa?")}`,
    );
  });

  test("Start asking redirects to /login when unauthenticated", async ({ page }) => {
    await page.goto("/");
    // Two identical CTAs (hero + bottom card); either one navigates to /login.
    await page
      .getByRole("link", { name: /Start asking/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 15000 });
  });
});

test.describe("Route guards", () => {
  test("redirects /chat to /login when unauthenticated", async ({ page }) => {
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("redirects /history to /login when unauthenticated", async ({ page }) => {
    await page.goto("/history");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("redirects /admin to /login when unauthenticated", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});
