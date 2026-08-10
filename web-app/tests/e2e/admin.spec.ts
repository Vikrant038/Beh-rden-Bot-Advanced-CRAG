import { test, expect } from "@playwright/test";
import { setSessionCookie } from "./helpers/auth";
import { mockTrpc } from "./helpers/trpc-mock";

test("redirects a non-admin user away from /admin", async ({ page }) => {
  await setSessionCookie(page.context(), { role: "USER" });

  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/\/chat/);
});

test("allows an admin to view the dashboard", async ({ page }) => {
  await setSessionCookie(page.context(), { role: "ADMIN" });
  // MetricCard counts up 0→value on load; under reduced motion it renders the
  // final value immediately. Without this, getByText("12") transiently matches
  // BOTH the Total-users card and the Total-messages counter mid-animation
  // (strict-mode flake) — reduced motion makes the value assertions
  // deterministic.
  await page.emulateMedia({ reducedMotion: "reduce" });

  await mockTrpc(page, {
    "admin.metrics": () => ({
      totalUsers: 12,
      totalMessages: 340,
      queriesToday: 23,
      cacheHitRate: 0.68,
      avgLatencyMs: 1450,
    }),
    "admin.dailyQueries": () => [],
    "admin.modeSplit": () => [],
    "admin.recentQueries": () => ({ items: [], nextCursor: null }),
    "admin.topQuestions": () => [],
    "admin.failedQueries": () => [],
    // The app sidebar lists knowledge-base sources on every page.
    "source.list": () => [],
  });

  await page.goto("/admin/dashboard");

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Total users")).toBeVisible();
  await expect(page.getByText("12")).toBeVisible();
  await expect(page.getByText("Total messages")).toBeVisible();
  await expect(page.getByText("340")).toBeVisible();
});
