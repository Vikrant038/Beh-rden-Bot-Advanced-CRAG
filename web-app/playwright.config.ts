import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";

// Load local env so the dev server and the session-token helper share the
// same NEXTAUTH_SECRET. CI provides its own env (see e2e-web-app.yml).
if (existsSync(".env")) {
  loadEnv({ path: ".env" });
}
process.env.NEXTAUTH_SECRET ??= "e2e-local-secret-not-for-production";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Mobile viewport coverage in CI (responsive checklist B8.186/B8.196):
    // every spec also runs at a phone viewport so layout/touch regressions are
    // caught on every push, not just at release time. The iPhone 13 profile
    // defaults to WebKit, which is not installed locally/CI — keep its mobile
    // viewport, touch, and UA but run the installed Chromium engine.
    {
      name: "mobile-chromium",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
      },
    },
  ],
  webServer: {
    command: "pnpm dev --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  },
});
