import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    globals: true,
    // Slow integration tests (full SSE pipeline, LLM retry/fallback paths)
    // legitimately take 5-7s, and the v8 coverage instrumentation adds enough
    // overhead to push them past Vitest's 5s default — causing random
    // "Test timed out in 5000ms" flakes on coverage runs. 20s still catches
    // real hangs; per-test overrides (e.g. llm-client 20s) remain effective.
    testTimeout: 20_000,
    env: {
      GEMINI_API_KEY: "test_key_for_vitest",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      exclude: [
        "node_modules/**",
        "src/**/*.d.ts",
        "src/server/ingest/translate/index.ts",
        "src/server/lib/errors/index.ts",
        "src/lib/guest.ts",
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 85,
      },
    },
    // M4: React component tests (.tsx) need a DOM; split into a dedicated
    // jsdom project instead of running everything under node.
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: [
            "src/**/*.test.ts",
            "tests/unit/**/*.test.ts",
            "tests/integration/**/*.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
