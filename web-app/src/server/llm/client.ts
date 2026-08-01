import OpenAI from "openai";
import { env } from "@/server/env";
import { CircuitBreaker } from "@/server/llm/circuit-breaker";
import { createLogger } from "@/server/lib/logger";
import { LLMProviderError } from "@/server/llm/errors";
import { observeGeneration } from "@/server/tracing";

const logger = createLogger("llm");

export const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";
export const DEFAULT_HF_MODEL = "meta-llama/Llama-3.1-8B-Instruct";
export const LLM_SEMAPHORE_LIMIT = 10;
export const GROQ_MAX_RETRIES = 3;
export const HF_MAX_RETRIES = 2;
export const GROQ_BASE_DELAY_MS = 1500;
export const HF_BASE_DELAY_MS = 1500;

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCallOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

const groqBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 60_000 });
const hfBreaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 60_000 });

let activeCalls = 0;

async function acquireSemaphore(signal?: AbortSignal): Promise<void> {
  while (activeCalls >= LLM_SEMAPHORE_LIMIT) {
    if (signal?.aborted) {
      throw new Error("LLM call aborted while waiting for semaphore");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  activeCalls += 1;
}

function releaseSemaphore(): void {
  activeCalls = Math.max(0, activeCalls - 1);
}

let groqClient: OpenAI | null = null;

function getGroqClient(): OpenAI | null {
  if (groqClient !== null) {
    return groqClient;
  }
  if (!env.GROQ_API_KEY) {
    return null;
  }
  groqClient = new OpenAI({
    apiKey: env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
  });
  return groqClient;
}

export interface HfTextGenerationRequest {
  model: string;
  inputs: string;
  parameters: { max_new_tokens: number; temperature: number };
}

async function callHfRaw(
  prompt: string,
  maxTokens: number,
  temperature: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!env.HF_TOKEN) {
    throw new LLMProviderError("HF_TOKEN not configured");
  }
  const body: HfTextGenerationRequest = {
    model: env.HF_LLM_MODEL ?? DEFAULT_HF_MODEL,
    inputs: prompt,
    parameters: { max_new_tokens: maxTokens, temperature },
  };

  const response = await fetch(`${env.HF_INFERENCE_URL}/models/${encodeURIComponent(body.model)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.HF_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new LLMProviderError(
      `HuggingFace API error ${response.status}: ${await response.text()}`,
    );
  }

  const data = (await response.json()) as
    { generated_text?: string } | Array<{ generated_text?: string }>;
  const generated = Array.isArray(data)
    ? data[0]?.generated_text
    : (data as { generated_text?: string }).generated_text;
  if (!generated) {
    throw new LLMProviderError("HuggingFace returned empty response");
  }
  return generated.trim();
}

function formatPromptForHf(messages: LlmMessage[]): string {
  return messages.map((message) => `${message.role}: ${message.content}`).join("\n");
}

async function callGroqWithRetry(
  messages: LlmMessage[],
  maxTokens: number,
  temperature: number,
  signal?: AbortSignal,
): Promise<string> {
  const client = getGroqClient();
  if (!client) {
    throw new LLMProviderError("Groq client unavailable (GROQ_API_KEY not configured)");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= GROQ_MAX_RETRIES; attempt += 1) {
    try {
      await acquireSemaphore(signal);
      try {
        const response = await client.chat.completions.create(
          {
            model: env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
            messages: messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
            max_tokens: maxTokens,
            temperature,
          },
          { signal },
        );
        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new LLMProviderError("Groq returned empty completion");
        }
        return content.trim();
      } finally {
        releaseSemaphore();
      }
    } catch (error) {
      lastError = error;
      if (attempt < GROQ_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, GROQ_BASE_DELAY_MS * attempt));
      }
    }
  }
  throw new LLMProviderError(
    `Groq API call failed after ${GROQ_MAX_RETRIES} attempts: ${String(lastError)}`,
  );
}

async function callHfWithRetry(
  messages: LlmMessage[],
  maxTokens: number,
  temperature: number,
  signal?: AbortSignal,
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= HF_MAX_RETRIES; attempt += 1) {
    try {
      await acquireSemaphore(signal);
      try {
        const prompt = formatPromptForHf(messages);
        return await callHfRaw(prompt, maxTokens, temperature, signal);
      } finally {
        releaseSemaphore();
      }
    } catch (error) {
      lastError = error;
      if (attempt < HF_MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, HF_BASE_DELAY_MS * attempt));
      }
    }
  }
  throw new LLMProviderError(
    `HuggingFace API call failed after ${HF_MAX_RETRIES} attempts: ${String(lastError)}`,
  );
}

/**
 * Centralized resilient LLM caller with circuit breakers + semaphore.
 * Groq primary; HuggingFace fallback. Ported from `src/llm_client.py:call_llm`.
 */
export async function callLLM(
  messages: LlmMessage[],
  options: LlmCallOptions = {},
): Promise<string> {
  const maxTokens = options.maxTokens ?? 600;
  const temperature = options.temperature ?? 0.1;
  const { signal } = options;

  const generation = observeGeneration("llm.call", {
    model: env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
    metadata: { input: messages, maxTokens, temperature },
  });

  try {
    const groqResult = await groqBreaker.execute(() =>
      callGroqWithRetry(messages, maxTokens, temperature, signal),
    );
    generation.end(groqResult);
    return groqResult;
  } catch (error) {
    logger.warn(
      { error: String(error) },
      "[CIRCUIT BREAKER] Groq failed; falling back to HuggingFace",
    );
  }

  try {
    const hfResult = await hfBreaker.execute(() =>
      callHfWithRetry(messages, maxTokens, temperature, signal),
    );
    generation.end(hfResult);
    return hfResult;
  } catch (error) {
    logger.warn({ error: String(error) }, "[CIRCUIT BREAKER] HuggingFace also failed");
    generation.endError(error);
  }

  throw new LLMProviderError(
    "No working LLM provider available! Please ensure GROQ_API_KEY or HF_TOKEN is set.",
  );
}

/**
 * Streaming variant for SSE: emits content chunks as they arrive.
 * Falls back to a single non-streamed call when streaming is unavailable.
 */
export async function* callLLMStream(
  messages: LlmMessage[],
  options: LlmCallOptions = {},
): AsyncGenerator<string, void, undefined> {
  const maxTokens = options.maxTokens ?? 600;
  const temperature = options.temperature ?? 0.2;
  const { signal } = options;

  const client = getGroqClient();
  if (client) {
    try {
      const stream = await client.chat.completions.create(
        {
          model: env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
          messages: messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
          max_tokens: maxTokens,
          temperature,
          stream: true,
        },
        { signal },
      );
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          yield delta;
        }
      }
      return;
    } catch (error) {
      logger.warn(
        { error: String(error) },
        "Groq streaming failed; falling back to non-streamed call",
      );
    }
  }

  const full = await callLLM(messages, { maxTokens, temperature, signal });
  yield full;
}
