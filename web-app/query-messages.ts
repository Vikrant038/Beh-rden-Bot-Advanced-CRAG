import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const convId = "cms9qkw3000bqy3oba78ve5at";
  const messages = await prisma.message.findMany({
    where: { conversationId: convId },
    orderBy: { createdAt: "asc" },
  });
  console.log("MESSAGES IN DB:", JSON.stringify(messages, null, 2));
}
main();
