/**
 * One-off cleanup for the "infinite New conversation" bug.
 *
 * Before the /chat lazy-composer fix, every mount of /chat auto-created an
 * empty conversation (twice under React StrictMode), flooding history with
 * "New conversation · 0 messages" rows. The composer fix stops new ones;
 * this script removes the ones already in the database.
 *
 * Only conversations with ZERO messages are deleted — no user content is ever
 * removed. Soft-deleted (trashed) rows are left untouched.
 *
 * Usage: pnpm tsx scripts/cleanup-empty-conversations.ts
 */
import "dotenv/config";
import { prisma } from "../src/server/db";

async function main(): Promise<void> {
  const where = { deletedAt: null, messages: { none: {} } } as const;

  const [total, guestOwned] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.conversation.count({ where: { ...where, user: { email: { startsWith: "guest:" } } } }),
  ]);

  console.log(
    `Empty conversations found: ${total} (${guestOwned} guest-owned, ${total - guestOwned} signed-in)`,
  );

  if (total === 0) {
    console.log("Nothing to clean up.");
    await prisma.$disconnect();
    return;
  }

  const result = await prisma.conversation.deleteMany({ where });
  console.log(`Deleted ${result.count} empty conversations.`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("Cleanup failed:", error);
  process.exit(1);
});
