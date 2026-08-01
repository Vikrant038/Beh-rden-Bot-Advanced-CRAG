import { test, expect } from "@playwright/test";
import { setSessionCookie } from "./helpers/auth";
import { mockChatStream, mockTrpc } from "./helpers/trpc-mock";

const CONVERSATION_ID = "conv-e2e";
const ISO = "2026-08-01T00:00:00.000Z";

// Fixture is static so StrictMode double-fetches and post-send refetches
// always return the same conversation (no message wiping, no races).
const PERSISTED_CONVERSATION = {
  id: CONVERSATION_ID,
  title: "New conversation",
  mode: "AGENTIC",
  createdAt: ISO,
  updatedAt: ISO,
  messages: [
    {
      id: "assistant-e2e",
      role: "ASSISTANT",
      content: "Welcome back to your conversation",
      sources: [],
      metadata: { stage: "done" },
      createdAt: ISO,
    },
  ],
};

const EMPTY_CONVERSATION = {
  id: CONVERSATION_ID,
  title: "New conversation",
  mode: "AGENTIC",
  createdAt: ISO,
  updatedAt: ISO,
  messages: [],
};

function mockConversationRouters(page: import("@playwright/test").Page, fixture: unknown) {
  return mockTrpc(page, {
    "conversation.create": () => ({
      id: CONVERSATION_ID,
      title: "New conversation",
      mode: "AGENTIC",
      createdAt: ISO,
      updatedAt: ISO,
    }),
    "conversation.getById": () => fixture,
    "conversation.list": () => ({ items: [], nextCursor: null }),
    "chat.sendMessage": () => ({
      messageId: "user-e2e",
      conversationId: CONVERSATION_ID,
    }),
  });
}

test("sends a message and renders the streamed assistant reply", async ({ page }) => {
  await setSessionCookie(page.context());
  await mockConversationRouters(page, PERSISTED_CONVERSATION);

  await mockChatStream(page, [
    { type: "status", stage: "retrieval" },
    { type: "token", content: "Hello from E2E assistant" },
    { type: "done", messageId: "assistant-streamed", sources: [], metadata: { stage: "done" } },
  ]);

  await page.goto("/chat");

  // /chat auto-creates a conversation and redirects to /chat/:id.
  await expect(page).toHaveURL(new RegExp(`/chat/${CONVERSATION_ID}$`));

  // The persisted assistant message renders before we send anything.
  await expect(page.getByText("Welcome back to your conversation")).toBeVisible();

  // Send a message from the input box.
  const input = page.getByPlaceholder(/Ask about visas/);
  await input.fill("What do I need for a student visa?");
  await page.getByRole("button", { name: "Send message" }).click();

  // The user bubble and the newly streamed assistant reply appear.
  await expect(page.getByText("What do I need for a student visa?")).toBeVisible();
  await expect(page.getByText("Hello from E2E assistant")).toBeVisible();
});

test("shows the empty state for a fresh conversation", async ({ page }) => {
  await setSessionCookie(page.context());
  await mockConversationRouters(page, EMPTY_CONVERSATION);

  await page.goto("/chat");
  await expect(page).toHaveURL(new RegExp(`/chat/${CONVERSATION_ID}$`));
  await expect(page.getByRole("heading", { name: "How can I help you today?" })).toBeVisible();
});

test("renders an error banner when the stream fails", async ({ page }) => {
  await setSessionCookie(page.context());
  await mockConversationRouters(page, PERSISTED_CONVERSATION);

  // A non-2xx stream response surfaces as the pipeline error.
  await page.route("**/api/chat/stream", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: '{"error":"Streaming request failed"}',
    }),
  );

  await page.goto("/chat");
  await expect(page).toHaveURL(new RegExp(`/chat/${CONVERSATION_ID}$`));

  const input = page.getByPlaceholder(/Ask about visas/);
  await input.fill("Trigger an error");
  await page.getByRole("button", { name: "Send message" }).click();

  // Scoped to the banner: Next.js also injects a hidden route announcer with role="alert".
  const alert = page.getByRole("alert").filter({ hasText: "Streaming request failed" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Streaming request failed");
});
