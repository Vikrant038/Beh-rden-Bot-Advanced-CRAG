import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/unit/**/*.test.ts"],
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
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
