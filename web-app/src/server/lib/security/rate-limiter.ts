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
 */
export class RateLimiter {
  private readonly upstashLimit: Ratelimit | null;
  private readonly memBuckets = new Map<string, number[]>();

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

    const now = Date.now();
    const windowStart = now - this.windowSeconds * 1000;
    const timestamps = (this.memBuckets.get(identifier) ?? []).filter(
      (timestamp) => timestamp > windowStart,
    );

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

  async enforce(identifier: string): Promise<RateLimitResult> {
    const result = await this.check(identifier);
    if (!result.success) {
      const { RateLimitedError } = await import("@/server/lib/errors");
      throw new RateLimitedError();
    }
    return result;
  }
}

export const authRateLimiter = new RateLimiter(5, 15 * 60);
export const publicRateLimiter = new RateLimiter(100, 15 * 60);
export const chatRateLimiter = new RateLimiter(60, 60);
