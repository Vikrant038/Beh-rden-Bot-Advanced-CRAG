import { callLLM } from "@/server/llm/client";
import type { LlmMessage } from "@/server/llm/client";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("llm-json");

/**
 * Calls the LLM and parses a JSON response, stripping markdown code fences.
 * Returns null on any parse failure (callers fall back gracefully).
 */
export async function callLLMJson<T>(
  prompt: string,
  maxTokens = 300,
  temperature = 0,
): Promise<T | null> {
  const messages: LlmMessage[] = [{ role: "user", content: prompt }];
  try {
    const raw = await callLLM(messages, { maxTokens, temperature });
    return parseJsonLoose(raw) as T;
  } catch (error) {
    logger.warn({ error: String(error) }, "[LLM JSON] call failed");
    return null;
  }
}

export function parseJsonLoose(raw: string): unknown {
  let text = raw.trim();
  if (text.startsWith("```json")) {
    text = text.slice(7);
  } else if (text.startsWith("```")) {
    text = text.slice(3);
  }
  if (text.endsWith("```")) {
    text = text.slice(0, -3);
  }
  return JSON.parse(text.trim());
}
