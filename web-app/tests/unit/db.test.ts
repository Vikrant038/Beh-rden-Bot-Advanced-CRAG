import { describe, it, expect, vi } from "vitest";

const globalForPrisma = globalThis as unknown as { prisma?: unknown };

describe("db singleton", () => {
  it("caches the Prisma client on globalThis outside production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/db");
    globalForPrisma.prisma = undefined;
    const mod = await import("@/server/db");
    expect(mod.prisma).toBeDefined();
    expect(globalForPrisma.prisma).toBe(mod.prisma);
    vi.unstubAllEnvs();
  });

  it("does not attach the client to globalThis in production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/db");
    globalForPrisma.prisma = undefined;
    const mod = await import("@/server/db");
    expect(mod.prisma).toBeDefined();
    expect(globalForPrisma.prisma).toBeUndefined();
    vi.unstubAllEnvs();
  });
});
