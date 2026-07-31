export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
}

/**
 * Minimal circuit breaker (WEB_APP_PLAN §7: "~50 lines, no heavy library").
 * State is stored per serverless-function instance (documented decision).
 * Ported behavior from `pybreaker.CircuitBreaker(fail_max=5, reset_timeout=60)`.
 */
export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private openedAt: number | null = null;

  constructor(private readonly options: CircuitBreakerOptions) {}

  getState(): CircuitState {
    if (this.state === "OPEN" && this.shouldHalfOpen()) {
      this.state = "HALF_OPEN";
    }
    return this.state;
  }

  allowRequest(): boolean {
    const state = this.getState();
    return state !== "OPEN";
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.allowRequest()) {
      throw new Error(`Circuit breaker is OPEN (${this.options.failureThreshold} failures)`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  onSuccess(): void {
    this.failureCount = 0;
    this.openedAt = null;
    this.state = "CLOSED";
  }

  onFailure(): void {
    if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.openedAt = Date.now();
      this.failureCount = this.options.failureThreshold;
      return;
    }

    this.failureCount += 1;
    if (this.failureCount >= this.options.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = Date.now();
    }
  }

  private shouldHalfOpen(): boolean {
    return this.openedAt !== null && Date.now() - this.openedAt >= this.options.resetTimeoutMs;
  }
}
