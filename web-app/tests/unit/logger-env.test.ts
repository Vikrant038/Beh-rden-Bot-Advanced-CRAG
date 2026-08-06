import { vi, describe, it, expect } from "vitest";

describe("createLogger", () => {
  it("selects the info level when NODE_ENV is production", async () => {
    vi.resetModules();
    // vi.stubEnv types NODE_ENV correctly (direct assignment is rejected by
    // @types/node's read-only ProcessEnv) and auto-restores it on unstub.
    vi.stubEnv("NODE_ENV", "production");
    try {
      const { createLogger } = await import("@/server/lib/logger");
      const logger = createLogger("env-test");
      expect((logger as unknown as { level: string }).level).toBe("info");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("selects the debug level in non-production environments", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "test");
    try {
      const { createLogger } = await import("@/server/lib/logger");
      const logger = createLogger("env-test");
      expect((logger as unknown as { level: string }).level).toBe("debug");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
