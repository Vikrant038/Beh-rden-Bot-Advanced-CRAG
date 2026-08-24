import { vi, describe, it, expect, beforeEach } from "vitest";

const envState = vi.hoisted(() => ({ keys: false }));

vi.mock("@/server/env", () => ({
  env: {
    get LANGFUSE_PUBLIC_KEY() {
      return envState.keys ? "pk-test" : undefined;
    },
    get LANGFUSE_SECRET_KEY() {
      return envState.keys ? "sk-test" : undefined;
    },
    get LANGFUSE_HOST() {
      return "https://cloud.langfuse.com";
    },
  },
}));

const traceSpies = vi.hoisted(() => ({ trace: vi.fn(), flush: vi.fn() }));

vi.mock("langfuse", () => {
  class FakeSpan {
    end = vi.fn();
    update = vi.fn();
  }
  class FakeGeneration {
    end = vi.fn();
    update = vi.fn();
  }
  class FakeTrace {
    span = vi.fn(() => new FakeSpan());
    generation = vi.fn(() => new FakeGeneration());
    update = vi.fn();
  }
  void FakeTrace;
  class FakeLangfuse {
    trace = traceSpies.trace;
    flushAsync = traceSpies.flush;
  }
  return { Langfuse: FakeLangfuse };
});

import {
  runWithTrace,
  runWithTraceGen,
  observeGeneration,
  isTracingEnabled,
  setTraceInput,
} from "@/server/tracing";

describe("tracing", () => {
  beforeEach(() => {
    envState.keys = false;
    traceSpies.trace.mockReset();
    traceSpies.trace.mockReturnValue({
      span: vi.fn(() => ({ end: vi.fn(), update: vi.fn() })),
      generation: vi.fn(() => ({ end: vi.fn(), update: vi.fn() })),
      update: vi.fn(),
    });
    traceSpies.flush.mockReset();
    traceSpies.flush.mockResolvedValue(undefined);
  });

  it("reports tracing as disabled when Langfuse keys are missing", () => {
    expect(isTracingEnabled()).toBe(false);
  });

  it("reports tracing as enabled when Langfuse keys are present", () => {
    envState.keys = true;
    expect(isTracingEnabled()).toBe(true);
  });

  it("runWithTrace runs the function and ends a span when enabled", async () => {
    envState.keys = true;
    const result = await runWithTrace(
      { name: "test-trace", metadata: { env: "test" }, input: { q: "hi" } },
      async () => "ok",
    );
    expect(result).toBe("ok");
    expect(traceSpies.trace).toHaveBeenCalled();
    expect(traceSpies.flush).toHaveBeenCalled();
  });

  it("runWithTrace propagates errors and marks the span failed", async () => {
    envState.keys = true;
    const span = { end: vi.fn(), update: vi.fn() };
    traceSpies.trace.mockReturnValue({
      span: vi.fn(() => span),
      generation: vi.fn(),
      update: vi.fn(),
    });
    await expect(
      runWithTrace({ name: "failing-trace" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(span.end).toHaveBeenCalledWith(expect.objectContaining({ statusMessage: "boom" }));
  });

  it("runWithTrace falls through when tracing is disabled", async () => {
    const result = await runWithTrace({ name: "noop" }, async () => 42);
    expect(result).toBe(42);
    expect(traceSpies.trace).not.toHaveBeenCalled();
  });

  it("observeGeneration no-ops without a trace context", async () => {
    envState.keys = true;
    const handle = observeGeneration("llm.call");
    expect(() => handle.end("out")).not.toThrow();
    expect(() => handle.endError(new Error("x"))).not.toThrow();
  });

  it("observeGeneration attaches a generation inside a trace", async () => {
    envState.keys = true;
    const generation = { end: vi.fn(), update: vi.fn() };
    traceSpies.trace.mockReturnValue({
      span: vi.fn(() => ({ end: vi.fn(), update: vi.fn() })),
      generation: vi.fn(() => generation),
      update: vi.fn(),
    });
    await runWithTrace({ name: "gen-trace" }, async () => {
      const handle = observeGeneration("llm.call", { model: "openai/gpt-oss-120b" });
      handle.end("output text");
      expect(generation.end).toHaveBeenCalled();
    });
  });

  it("runWithTraceGen yields all items and ends the span", async () => {
    envState.keys = true;
    const items: number[] = [];
    for await (const value of runWithTraceGen({ name: "gen-trace" }, async function* () {
      yield 1;
      yield 2;
      yield 3;
    })) {
      items.push(value);
    }
    expect(items).toEqual([1, 2, 3]);
    expect(traceSpies.flush).toHaveBeenCalled();
  });

  it("setTraceInput is a safe no-op outside a trace", () => {
    expect(() => setTraceInput({ q: "x" })).not.toThrow();
  });

  it("runWithTraceGen propagates errors and marks the span failed", async () => {
    envState.keys = true;
    const span = { end: vi.fn(), update: vi.fn() };
    traceSpies.trace.mockReturnValue({
      span: vi.fn(() => span),
      generation: vi.fn(),
      update: vi.fn(),
    });
    const iterator = runWithTraceGen({ name: "fail-gen" }, async function* () {
      yield 1;
      throw new Error("gen boom");
    })[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual(expect.objectContaining({ done: false }));
    await expect(iterator.next()).rejects.toThrow("gen boom");
    expect(span.end).toHaveBeenCalledWith(expect.objectContaining({ statusMessage: "gen boom" }));
  });

  it("runWithTrace records a non-string result without truncation", async () => {
    envState.keys = true;
    const span = { end: vi.fn(), update: vi.fn() };
    traceSpies.trace.mockReturnValue({
      span: vi.fn(() => span),
      generation: vi.fn(),
      update: vi.fn(),
    });
    const result = await runWithTrace({ name: "obj-trace" }, async () => ({ ok: true }));
    expect(result).toEqual({ ok: true });
    expect(span.end).toHaveBeenCalledWith({ output: { ok: true } });
  });

  it("setTraceInput updates the active trace and span inside a trace", async () => {
    envState.keys = true;
    const trace = {
      span: vi.fn(() => ({ end: vi.fn(), update: vi.fn() })),
      generation: vi.fn(),
      update: vi.fn(),
    };
    traceSpies.trace.mockReturnValue(trace);
    await runWithTrace({ name: "input-trace" }, async () => {
      setTraceInput({ masked: "query" });
    });
    expect(trace.update).toHaveBeenCalledWith({ input: { masked: "query" } });
  });

  it("observeGeneration marks the generation failed via endError inside a trace", async () => {
    envState.keys = true;
    const generation = { end: vi.fn(), update: vi.fn() };
    traceSpies.trace.mockReturnValue({
      span: vi.fn(() => ({ end: vi.fn(), update: vi.fn() })),
      generation: vi.fn(() => generation),
      update: vi.fn(),
    });
    await runWithTrace({ name: "gen-error" }, async () => {
      const handle = observeGeneration("llm.call");
      handle.endError(new Error("gen failed"));
      expect(generation.end).toHaveBeenCalledWith(expect.objectContaining({ statusMessage: "gen failed" }));
    });
  });

  it("swallows a Langfuse flush failure", async () => {
    envState.keys = true;
    traceSpies.flush.mockRejectedValue(new Error("flush boom"));
    const result = await runWithTrace({ name: "flush-trace" }, async () => "ok");
    expect(result).toBe("ok");
  });
});
