import { callLLM } from "@/server/llm/client";
import type { LlmMessage } from "@/server/llm/client";
import { createLogger } from "@/server/lib/logger";
import { DomainGuardBlockedError } from "@/server/lib/errors";

const logger = createLogger("guardrail");

export const NEGATIVE_TERMS = [
  "japan",
  "stock trading",
  "algorithmic",
  "crypto",
  "recipe",
  "cooking",
  "nba",
  "football",
  "cricket",
  "python script for trading",
];

/**
 * Stage 0A domain guardrail: blocks spam/off-topic and illegal-advice queries.
 * Ported from `src/advanced_retrieval.py:is_query_out_of_domain`. The LLM
 * classifier fails open (returns in-domain) on error. A lightweight negative
 * term cache gives instant rejection for known off-domain queries.
 */
export async function isQueryOutOfDomain(query: string): Promise<boolean> {
  const lower = query.toLowerCase();

  for (const term of NEGATIVE_TERMS) {
    if (lower.includes(term)) {
      logger.info("[GUARDRAIL] Negative cache hit (off-domain term)");
      return true;
    }
  }

  const prompt =
    `You are a strict safety guardrail for a German Immigration Assistant.\n` +
    `Your job is to block two categories of queries:\n` +
    `  1. SPAM: Queries completely unrelated to German immigration/education (crypto, cooking, sports, programming, etc).\n` +
    `  2. UNSAFE: Queries asking for illegal advice, even if immigration-related.\n\n` +
    `RULE: If the query is asking for factual information (costs, timelines, requirements, processes) about studying or working in Germany, ACCEPT it.\n` +
    `RULE: If the query seeks to circumvent, defraud, or illegally exploit German immigration law, REJECT it.\n` +
    `RULE: If the query is totally unrelated to Germany/immigration/education, REJECT it.\n\n` +
    `User Query: ${query}\n\n` +
    `Is this query safe and relevant to German immigration, universities, or student life?\n` +
    `Reply ONLY with 'YES' or 'NO'.`;

  try {
    const messages: LlmMessage[] = [{ role: "user", content: prompt }];
    const resText = (await callLLM(messages, { maxTokens: 10, temperature: 0 }))
      .trim()
      .toUpperCase();
    return !resText.includes("YES");
  } catch (error) {
    logger.warn({ error: String(error) }, "[GUARDRAIL] Domain check failed; defaulting to safe");
    return false;
  }
}

/**
 * Thin wrapper that raises DomainGuardBlockedError so tRPC maps it to 422.
 */
export async function assertInDomain(query: string): Promise<void> {
  if (await isQueryOutOfDomain(query)) {
    throw new DomainGuardBlockedError(
      "This question falls outside the scope of German immigration, student visas, and university applications.",
    );
  }
}
