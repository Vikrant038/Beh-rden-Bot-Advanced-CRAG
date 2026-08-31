import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";
import { env } from "@/server/env";

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

/**
 * GUARDRAILS M2.6: auth endpoints 5 req / 15 min / IP; public endpoints 100 req / 15 min / IP.
 * Uses Upstash sliding-window when configured; falls back to an in-memory sliding window
 * for local development (no external dependency).
 * ⚠️  SERVERLESS LIMITATION: The in-memory fallback (`memBuckets`) is per-function-instance.
 * Without Upstash configured, rate limits are NOT enforced globally across Vercel instances —
 * each warm instance tracks only its own bucket. Always configure UPSTASH_REDIS_URL and
 * UPSTASH_REDIS_TOKEN in production (see docs/security/SECURITY_EXCEPTIONS.md).
 */
export class RateLimiter {
  private readonly upstashLimit: Ratelimit | null;
  private readonly memBuckets = new Map<string, number[]>();
  private readonly lastSeen = new Map<string, number>();
  private static readonly MAX_MEM_BUCKETS = 10_000;

  constructor(
    private readonly maxRequests: number,
    private readonly windowSeconds: number,
  ) {
    this.upstashLimit =
      env.UPSTASH_REDIS_URL && env.UPSTASH_REDIS_TOKEN
        ? new Ratelimit({
            redis: Redis.fromEnv(),
            limiter: Ratelimit.slidingWindow(maxRequests, `${windowSeconds} s`),
            prefix: `ratelimit:${maxRequests}`,
          })
        : null;
  }

  async check(identifier: string): Promise<RateLimitResult> {
    if (this.upstashLimit) {
      const result = await this.upstashLimit.limit(identifier);
      return {
        success: result.success,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
      };
    }

    // m5: bound memory — drop the least-recently-seen bucket once the map
    // grows past the cap, and evict buckets that fell out of the window.
    if (this.memBuckets.size >= RateLimiter.MAX_MEM_BUCKETS) {
      this.evictStaleBuckets();
    }
    this.lastSeen.set(identifier, Date.now());

    const now = Date.now();
    const windowStart = now - this.windowSeconds * 1000;
    const timestamps = (this.memBuckets.get(identifier) ?? []).filter(
      (timestamp) => timestamp > windowStart,
    );

    if (timestamps.length === 0) {
      this.memBuckets.delete(identifier);
    }

    if (timestamps.length >= this.maxRequests) {
      this.memBuckets.set(identifier, timestamps);
      const oldest = timestamps[0] ?? now;
      return {
        success: false,
        limit: this.maxRequests,
        remaining: 0,
        reset: Math.ceil((oldest + this.windowSeconds * 1000 - now) / 1000),
      };
    }

    timestamps.push(now);
    this.memBuckets.set(identifier, timestamps);
    return {
      success: true,
      limit: this.maxRequests,
      remaining: this.maxRequests - timestamps.length,
      reset: this.windowSeconds,
    };
  }

  private evictStaleBuckets(): void {
    const now = Date.now();
    const staleCutoff = now - this.windowSeconds * 1000;
    const candidates = [...this.lastSeen.entries()].sort(([, seenA], [, seenB]) => seenA - seenB);

    for (const [key] of candidates) {
      if (this.memBuckets.size < RateLimiter.MAX_MEM_BUCKETS) {
        break;
      }
      const timestamps = this.memBuckets.get(key);
      if (timestamps === undefined || timestamps[timestamps.length - 1] < staleCutoff) {
        this.memBuckets.delete(key);
        this.lastSeen.delete(key);
      }
    }
  }

  async enforce(identifier: string): Promise<RateLimitResult> {
    const result = await this.check(identifier);
    if (!result.success) {
      const { RateLimitedError } = await import("@/server/lib/errors");
      throw new RateLimitedError();
    }
    return result;
  }
}

export const chatRateLimiter = new RateLimiter(60, 60);
