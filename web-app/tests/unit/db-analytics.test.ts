import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { messageStats, timeWindow } from "@/server/db/analytics";

describe("timeWindow SQL fragment", () => {
  it("returns Prisma.empty when no window is given", () => {
    expect(timeWindow(undefined)).toBe(Prisma.empty);
  });

  it("produces an AND-prefixed fragment by default (for queries with an existing WHERE)", () => {
    const fragment = timeWindow(14);
    expect(fragment).not.toBe(Prisma.empty);
    expect(fragment.text).toContain('AND "createdAt" >= NOW() - make_interval');
    expect(fragment.values).toContain(14);
  });

  it("produces a WHERE-prefixed fragment when asked (for queries with no other predicate)", () => {
    const fragment = timeWindow(14, "WHERE");
    expect(fragment.text).toContain('WHERE "createdAt" >= NOW() - make_interval');
    expect(fragment.text).not.toContain("AND");
  });
});

describe("messageStats SQL composition", () => {
  it("assembles a valid FROM-messages query with the WHERE-prefixed time window", async () => {
    // The regression: timeWindow(14) previously returned an AND-prefixed
    // fragment, producing `FROM messages AND "createdAt" >= ...` — invalid SQL
    // that Postgres rejects. messageStats must pass the "WHERE" prefix.
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([{ assistantCount: 1, cacheHits: 0, avgLatencyMs: 10 }]),
    } as never;

    const result = await messageStats(prisma, 14);

    const rawSql = (prisma as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw;
    // Tagged template: args are [strings, ...interpolated Sql fragments]
    const [strings, fragment] = rawSql.mock.calls[0] as [TemplateStringsArray, Prisma.Sql];
    const fullSql = `${strings[0]}${fragment.text}${strings[1]}`;
    expect(fullSql).toContain('FROM messages');
    expect(fragment.text).toContain('WHERE "createdAt" >= NOW() - make_interval');
    expect(fragment.text).not.toMatch(/^AND/);
    expect(fullSql).not.toMatch(/FROM messages\s+AND/);
    expect(result?.assistantCount).toBe(1);
  });
});
