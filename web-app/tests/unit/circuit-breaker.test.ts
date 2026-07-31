import { CircuitBreaker } from "@/server/llm/circuit-breaker";

describe("CircuitBreaker", () => {
  it("should start CLOSED", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 60_000 });
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.allowRequest()).toBe(true);
  });

  it("should OPEN after failureThreshold failures", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60_000 });
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.getState()).toBe("CLOSED");
    breaker.onFailure();
    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.allowRequest()).toBe(false);
  });

  it("should reject calls while OPEN", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 60_000 });
    breaker.onFailure();
    breaker.onFailure();

    await expect(breaker.execute(async () => "ok")).rejects.toThrow(/OPEN/);
  });

  it("should transition to HALF_OPEN after resetTimeout", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 50 });
    breaker.onFailure();
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.getState()).toBe("OPEN");

    vi.waitFor(
      () => {
        expect(breaker.getState()).toBe("HALF_OPEN");
        expect(breaker.allowRequest()).toBe(true);
      },
      { timeout: 200 },
    );
  });

  it("should close on successful probe, reopen on failed probe", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 50 });
    breaker.onFailure();
    breaker.onFailure();
    breaker.onFailure();

    vi.waitFor(
      () => {
        expect(breaker.getState()).toBe("HALF_OPEN");
      },
      { timeout: 200 },
    );

    breaker.onSuccess();
    expect(breaker.getState()).toBe("CLOSED");

    breaker.onFailure();
    breaker.onFailure();
    breaker.onFailure();
    vi.waitFor(
      () => {
        expect(breaker.getState()).toBe("HALF_OPEN");
      },
      { timeout: 200 },
    );

    breaker.onFailure();
    expect(breaker.getState()).toBe("OPEN");
  });

  it("should reset counters after success", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60_000 });
    breaker.onFailure();
    breaker.onFailure();
    breaker.onSuccess();
    expect(breaker.getState()).toBe("CLOSED");
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("execute should record success and return result", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60_000 });
    const result = await breaker.execute(async () => 42);
    expect(result).toBe(42);
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("execute should record failure and rethrow", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 60_000 });
    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    expect(breaker.getState()).toBe("CLOSED");
    await expect(breaker.execute(async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    expect(breaker.getState()).toBe("OPEN");
    await expect(breaker.execute(async () => "never")).rejects.toThrow(/OPEN/);
  });

  it("getState should transition OPEN to HALF_OPEN after reset", () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 10 });
    breaker.onFailure();
    breaker.onFailure();
    expect(breaker.getState()).toBe("OPEN");
    vi.waitFor(
      () => {
        expect(breaker.getState()).toBe("HALF_OPEN");
      },
      { timeout: 100 },
    );
  });
});
