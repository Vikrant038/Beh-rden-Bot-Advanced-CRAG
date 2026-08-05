/**
 * Langfuse tracing (TASK-039). Wraps chat turns, ingestion runs, and LLM /
 * embedding calls with Langfuse spans. No-ops when LANGFUSE keys are absent,
 * so the app runs fully untraced in local/CI environments.
 *
 * A per-request trace context is propagated through AsyncLocalStorage so that
 * nested LLM/embedding calls attach to the enclosing trace without threading
 * span ids through every pipeline signature.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { Langfuse } from "langfuse";
import type { LangfuseTraceClient, LangfuseSpanClient, LangfuseGenerationClient } from "langfuse";
import { env } from "@/server/env";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("tracing");

export interface TraceContext {
  trace: LangfuseTraceClient;
  span: LangfuseSpanClient;
  name: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext | undefined>();

let langfuseClient: Langfuse | null = null;

export function getLangfuse(): Langfuse | null {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) {
    return null;
  }
  if (!langfuseClient) {
    langfuseClient = new Langfuse({
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
      baseUrl: env.LANGFUSE_HOST,
    });
  }
  return langfuseClient;
}

export function isTracingEnabled(): boolean {
  return getLangfuse() !== null;
}

export interface TraceOptions {
  name: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  input?: unknown;
}

/**
 * Runs `fn` inside a Langfuse trace + top-level span. The trace context is
 * stored in AsyncLocalStorage so nested `observeGeneration` calls attach to it.
 */
export async function runWithTrace<T>(options: TraceOptions, fn: () => Promise<T>): Promise<T> {
  const client = getLangfuse();
  if (!client) {
    return fn();
  }

  const trace = client.trace({
    name: options.name,
    userId: options.userId,
    sessionId: options.sessionId,
    metadata: options.metadata,
    input: options.input,
  });
  const span = trace.span({
    name: options.name,
    metadata: options.metadata,
    input: options.input,
  });
  const context: TraceContext = { trace, span, name: options.name };

  try {
    const result = await traceStorage.run(context, fn);
    span.end({ output: summarizeOutput(result) });
    await flush(client);
    return result;
  } catch (error) {
    span.end({
      level: "ERROR",
      statusMessage: error instanceof Error ? error.message : String(error),
      output: String(error),
    });
    await flush(client);
    throw error;
  }
}

/** Overrides the input recorded on the active trace (e.g. PII-masked query). */
export function setTraceInput(input: unknown): void {
  const context = traceStorage.getStore();
  if (!context) {
    return;
  }
  context.trace.update({ input });
  context.span.update({ input });
}

/**
 * Generator variant of `runWithTrace`: wraps an async generator's execution in
 * a trace so `observeGeneration` calls attach spans as events are yielded.
 */
export async function* runWithTraceGen<T>(
  options: TraceOptions,
  create: () => AsyncGenerator<T>,
): AsyncGenerator<T> {
  const client = getLangfuse();
  if (!client) {
    yield* create();
    return;
  }

  const trace = client.trace({
    name: options.name,
    userId: options.userId,
    sessionId: options.sessionId,
    metadata: options.metadata,
    input: options.input,
  });
  const span = trace.span({
    name: options.name,
    metadata: options.metadata,
    input: options.input,
  });
  const context: TraceContext = { trace, span, name: options.name };

  try {
    yield* traceStorage.run(context, () => create());
    span.end();
    await flush(client);
  } catch (error) {
    span.end({
      level: "ERROR",
      statusMessage: error instanceof Error ? error.message : String(error),
      output: String(error),
    });
    await flush(client);
    throw error;
  }
}

export interface GenerationHandle {
  end(output?: unknown): void;
  endError(error: unknown): void;
}

const NOOP_GENERATION: GenerationHandle = { end: () => undefined, endError: () => undefined };

/**
 * Opens a generation observation for an LLM/embedding call. Only records when
 * tracing is enabled AND a trace context is active on this async chain.
 */
export function observeGeneration(
  name: string,
  options: { model?: string; metadata?: Record<string, unknown> } = {},
): GenerationHandle {
  const context = traceStorage.getStore();
  const client = getLangfuse();
  if (!client || !context) {
    return NOOP_GENERATION;
  }

  const generation: LangfuseGenerationClient = context.trace.generation({
    name,
    model: options.model,
    metadata: options.metadata,
    input: options.metadata?.input,
  });

  return {
    end(output) {
      generation.end({
        output,
        usage: estimateUsage(options.metadata?.input, output),
      });
    },
    endError(error) {
      generation.end({
        level: "ERROR",
        statusMessage: error instanceof Error ? error.message : String(error),
        output: String(error),
      });
    },
  };
}

function estimateUsage(input: unknown, output: unknown): { input: number; output: number } {
  const countTokens = (value: unknown): number => {
    const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
    return Math.max(1, Math.ceil(text.length / 4));
  };
  return { input: countTokens(input), output: countTokens(output) };
}

function summarizeOutput<T>(result: T): unknown {
  if (typeof result === "string") {
    return result.slice(0, 500);
  }
  return result;
}

async function flush(client: Langfuse): Promise<void> {
  try {
    await client.flushAsync();
  } catch (error) {
    logger.warn({ error: String(error) }, "[TRACE] Langfuse flush failed");
  }
}
