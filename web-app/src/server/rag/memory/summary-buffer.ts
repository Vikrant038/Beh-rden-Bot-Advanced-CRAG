import { prisma } from "@/server/db";
import { callLLM } from "@/server/llm/client";
import type { LlmMessage } from "@/server/llm/client";
import { createLogger } from "@/server/lib/logger";
import {
  LLM_MAX_TOKENS_SUMMARY,
  LLM_TEMPERATURE_LOW,
  MAX_VERBATIM_MESSAGES,
  MEMORY_SUMMARY_MAX_CHARS,
} from "@/config/app";

const logger = createLogger("memory");

export interface MemoryTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Summary-buffer conversational memory (ported from `src/memory.py`):
 * keeps the last 8 messages verbatim, rolls older turns into a rolling
 * summary. Verbatim turns are rebuilt from the persisted Message rows; the
 * rolling summary is stored on ConversationMemory.
 */
export class SummaryBufferMemory {
  private verbatimBuffer: MemoryTurn[] = [];
  private rollingSummary = "";
  private loaded = false;

  constructor(
    private readonly conversationId: string,
    private readonly maxVerbatim: number = MAX_VERBATIM_MESSAGES,
  ) {}

  async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const [state, recentMessages] = await Promise.all([
        prisma.conversationMemory.findUnique({
          where: { conversationId: this.conversationId },
        }),
        prisma.message.findMany({
          where: { conversationId: this.conversationId },
          orderBy: { createdAt: "asc" },
          select: { role: true, content: true },
          take: this.maxVerbatim,
        }),
      ]);

      this.rollingSummary = state?.summaryText ?? "";
      this.verbatimBuffer = recentMessages
        .filter((message) => message.role === "USER" || message.role === "ASSISTANT")
        .map((message) => ({
          role: message.role === "USER" ? "user" : ("assistant" as const),
          content: message.content,
        }));
    } catch (error) {
      logger.warn({ error: String(error) }, "[MEMORY] load failed");
    }
  }

  async addTurn(userQuery: string, assistantResponse: string): Promise<void> {
    await this.ensureLoaded();
    this.verbatimBuffer.push({ role: "user", content: userQuery });
    this.verbatimBuffer.push({ role: "assistant", content: assistantResponse });

    if (this.verbatimBuffer.length > this.maxVerbatim) {
      await this.pruneAndSummarize();
    }

    await this.saveToDb();
  }

  async getContextFormatted(): Promise<string> {
    await this.ensureLoaded();
    const parts: string[] = [];
    if (this.rollingSummary) {
      parts.push(`=== ROLLING BACKGROUND SUMMARY ===\n${this.rollingSummary}`);
    }
    if (this.verbatimBuffer.length > 0) {
      parts.push("=== RECENT CONVERSATION HISTORY ===");
      for (const message of this.verbatimBuffer) {
        const role = message.role === "user" ? "User" : "Assistant";
        parts.push(`${role}: ${message.content}`);
      }
    }
    return parts.join("\n\n");
  }

  async clear(): Promise<void> {
    this.verbatimBuffer = [];
    this.rollingSummary = "";
    await this.saveToDb();
  }

  private async pruneAndSummarize(): Promise<void> {
    const oldestUser = this.verbatimBuffer.shift();
    const oldestAssistant = this.verbatimBuffer.shift();
    if (!oldestUser || !oldestAssistant) {
      return;
    }

    const prompt =
      `You are a conversational summary engine.\n` +
      `Current Background Summary: '${this.rollingSummary}'\n\n` +
      `New messages to integrate:\n` +
      `User: ${oldestUser.content}\n` +
      `Assistant: ${oldestAssistant.content.slice(0, MEMORY_SUMMARY_MAX_CHARS)}\n\n` +
      `Update the background summary into 2-3 bullet points focusing ONLY on key user details ` +
      `(nationality, degree goal, university, visa stage). Keep under 100 words.`;

    try {
      const messages: LlmMessage[] = [{ role: "user", content: prompt }];
      const summary = await callLLM(messages, {
        maxTokens: LLM_MAX_TOKENS_SUMMARY,
        temperature: LLM_TEMPERATURE_LOW,
      });
      this.rollingSummary = summary.trim();
    } catch (error) {
      logger.warn({ error: String(error) }, "[MEMORY] summary update failed");
    }
  }

  private async saveToDb(): Promise<void> {
    try {
      await prisma.conversationMemory.upsert({
        where: { conversationId: this.conversationId },
        update: { summaryText: this.rollingSummary },
        create: { conversationId: this.conversationId, summaryText: this.rollingSummary },
      });
    } catch (error) {
      logger.warn({ error: String(error) }, "[MEMORY] save failed");
    }
  }
}

export function createMemory(conversationId: string): SummaryBufferMemory {
  return new SummaryBufferMemory(conversationId);
}
