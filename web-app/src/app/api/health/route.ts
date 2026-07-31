import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("health");

interface DependencyCheck {
  status: "up" | "down";
  latency_ms?: number;
}

async function checkDatabase(): Promise<DependencyCheck> {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "up", latency_ms: Date.now() - startedAt };
  } catch (error) {
    logger.error({ error }, "health check: database down");
    return { status: "down" };
  }
}

async function checkCache(): Promise<DependencyCheck> {
  if (!env.UPSTASH_REDIS_URL || !env.UPSTASH_REDIS_TOKEN) {
    return { status: "down", latency_ms: 0 };
  }
  const startedAt = Date.now();
  try {
    const redis = Redis.fromEnv();
    await redis.ping();
    return { status: "up", latency_ms: Date.now() - startedAt };
  } catch (error) {
    logger.error({ error }, "health check: cache down");
    return { status: "down" };
  }
}

export async function GET() {
  const database = await checkDatabase();
  const cache = await checkCache();

  const checks = { database, cache };

  if (database.status === "down") {
    return NextResponse.json(
      {
        status: "unhealthy",
        checks,
      },
      { status: 503 },
    );
  }

  const isDegraded = cache.status === "down";
  return NextResponse.json(
    {
      status: isDegraded ? "degraded" : "healthy",
      checks,
    },
    { status: 200 },
  );
}
