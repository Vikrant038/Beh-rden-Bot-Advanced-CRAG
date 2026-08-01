import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("renders the hero, feature grid, and sign-in CTA", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Your AI Guide to German Immigration" }),
    ).toBeVisible();
    await expect(page.getByText("3-Agent ReAct")).toBeVisible();
    await expect(page.getByText("Hybrid Retrieval")).toBeVisible();
    await expect(page.getByText("CRAG Gate")).toBeVisible();

    const signIn = page.getByRole("link", { name: "Sign in" });
    await expect(signIn).toBeVisible();
    await signIn.click();
    // First navigation to /login on a cold dev server compiles the route server-side.
    await expect(page).toHaveURL(/\/login$/, { timeout: 15000 });
  });

  test("Start asking redirects to /login when unauthenticated", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Start asking/ }).click();
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
