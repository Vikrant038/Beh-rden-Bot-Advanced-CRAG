import { runChatStream } from "@/server/rag/chat-pipeline";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const convId = "cms9qkw3000bqy3oba78ve5at"; // Use the same conversation
  const userId = "cms9qjqmp0000y3ob6grehl15"; // Same user ID from logs

  console.log("Starting stream...");
  try {
    for await (const event of runChatStream({
      conversationId: convId,
      userId,
      query: "hi again",
      mode: "agentic",
    })) {
      console.log("EVENT:", JSON.stringify(event));
    }

    console.log("Stream finished. Fetching DB messages...");
    const messages = await prisma.message.findMany({
      where: { conversationId: convId },
      orderBy: { createdAt: "desc" },
      take: 2,
    });
    console.log("DB MESSAGES:", messages);
  } catch (err) {
    console.error("CRASH:", err);
  }
}
main();
