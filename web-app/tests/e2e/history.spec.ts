import { test, expect } from "@playwright/test";
import { setSessionCookie } from "./helpers/auth";
import { mockTrpc } from "./helpers/trpc-mock";

const ISO = "2026-08-01T00:00:00.000Z";

const CONVERSATIONS = [
  {
    id: "conv-1",
    title: "Student visa documents",
    mode: "AGENTIC",
    updatedAt: ISO,
    createdAt: ISO,
    preview: "What documents do I need for a German student visa?",
    messageCount: 4,
  },
  {
    id: "conv-2",
    title: "Blocked account amounts",
    mode: "STANDARD",
    updatedAt: ISO,
    createdAt: ISO,
    preview: "How much do I need in a blocked account for 2026?",
    messageCount: 2,
  },
];

test("lists conversations and filters by search", async ({ page }) => {
  await setSessionCookie(page.context());

  await mockTrpc(page, {
    "conversation.list": (input) => {
      const search = typeof input.search === "string" ? input.search.toLowerCase() : "";
      const items = search
        ? CONVERSATIONS.filter((item) => item.title.toLowerCase().includes(search))
        : CONVERSATIONS;
      return { items, nextCursor: null };
    },
    "conversation.stats": () => ({
      totalConversations: 2,
      pinnedConversations: 0,
      deletedConversations: 0,
      totalMessages: 6,
    }),
    // The app sidebar lists knowledge-base sources on every page.
    "source.list": () => [],
  });

  await page.goto("/history");

  await expect(page.getByText("Conversation history")).toBeVisible();
  await expect(page.getByText("Student visa documents")).toBeVisible();
  await expect(page.getByText("Blocked account amounts")).toBeVisible();

  const searchBox = page.getByPlaceholder("Search conversations…");
  await searchBox.fill("blocked");
  await searchBox.press("Enter");

  await expect(page.getByText("Blocked account amounts")).toBeVisible();
  await expect(page.getByText("Student visa documents")).toHaveCount(0);

  await searchBox.fill("visa");
  await searchBox.press("Enter");
  await expect(page.getByText("Student visa documents")).toBeVisible();
});

test("shows the empty state when there are no conversations", async ({ page }) => {
  await setSessionCookie(page.context());

  await mockTrpc(page, {
    "conversation.list": () => ({ items: [], nextCursor: null }),
    "conversation.stats": () => ({
      totalConversations: 0,
      pinnedConversations: 0,
      deletedConversations: 0,
      totalMessages: 0,
    }),
    // The app sidebar lists knowledge-base sources on every page.
    "source.list": () => [],
  });

  await page.goto("/history");
  await expect(page.getByText("No conversations yet")).toBeVisible();
});
