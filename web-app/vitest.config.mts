import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
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
