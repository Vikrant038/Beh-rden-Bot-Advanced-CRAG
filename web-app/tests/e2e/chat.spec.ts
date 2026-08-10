import { test, expect } from "@playwright/test";
import { setSessionCookie } from "./helpers/auth";
import { mockTrpc } from "./helpers/trpc-mock";

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
  readOnly: false,
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
  readOnly: false,
  messages: [],
};

function mockConversationRouters(
  page: import("@playwright/test").Page,
  fixture: unknown,
  onCreate?: () => void,
) {
  return mockTrpc(page, {
    "conversation.create": () => {
      onCreate?.();
      return {
        id: CONVERSATION_ID,
        title: "New conversation",
        mode: "AGENTIC",
        createdAt: ISO,
        updatedAt: ISO,
      };
    },
    "conversation.getById": () => fixture,
    "conversation.list": () => ({ items: [], nextCursor: null }),
    // The app sidebar lists knowledge-base sources on every chat page.
    "source.list": () => [],
  });
}

test("composer stays put until a message is sent (no eager conversation)", async ({ page }) => {
  await setSessionCookie(page.context());
  let createCalls = 0;
  await mockConversationRouters(page, EMPTY_CONVERSATION, () => {
    createCalls += 1;
  });

  await page.goto("/chat");

  // /chat is a lazy composer: no auto-create, no redirect, empty state shown.
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("heading", { name: "How can I help you today?" })).toBeVisible();
  expect(createCalls).toBe(0);
});

test("sends the first message, creates the conversation, and renders the streamed reply", async ({
  page,
}) => {
  await setSessionCookie(page.context());

  // The stream route flips this flag; once consumed, getById returns the
  // conversation as the server would persist it (user message + full answer),
  // so the post-stream invalidateConversation refetch doesn't wipe the text.
  let streamed = false;
  const POST_STREAM_CONVERSATION = {
    ...PERSISTED_CONVERSATION,
    readOnly: false,
    messages: [
      {
        id: "user-e2e",
        role: "USER",
        content: "What do I need for a student visa?",
        metadata: { mode: "agentic" },
        createdAt: ISO,
      },
      {
        id: "assistant-streamed",
        role: "ASSISTANT",
        content: "Hello from E2E assistant",
        sources: [],
        metadata: { stage: "done" },
        createdAt: ISO,
      },
    ],
  };

  await mockTrpc(page, {
    "conversation.create": () => ({
      id: CONVERSATION_ID,
      title: "New conversation",
      mode: "AGENTIC",
      createdAt: ISO,
      updatedAt: ISO,
    }),
    "conversation.getById": () => (streamed ? POST_STREAM_CONVERSATION : PERSISTED_CONVERSATION),
    "conversation.list": () => ({ items: [], nextCursor: null }),
    "source.list": () => [],
  });

  // Inline the stream route so we can flip the persisted-state flag exactly
  // when the SSE payload is consumed (mockChatStream can't signal that).
  const streamEvents = [
    { type: "status", stage: "retrieval" },
    { type: "token", content: "Hello from E2E assistant" },
    { type: "done", messageId: "assistant-streamed", sources: [], metadata: { stage: "done" } },
  ];
  const body = streamEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  await page.route("**/api/chat/stream", async (route) => {
    streamed = true;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body,
    });
  });

  await page.goto("/chat");

  // Send a message from the composer input.
  const input = page.getByPlaceholder(/Ask about visas/);
  await input.fill("What do I need for a student visa?");
  await page.getByRole("button", { name: "Send message" }).click();

  // The first message creates the conversation and redirects to it. The URL's
  // ?q= param is stripped immediately by the interface after the handoff, so
  // we only assert the conversation URL — the auto-sent user bubble below is
  // what proves the handoff itself worked.
  await expect(page).toHaveURL(new RegExp(`/chat/${CONVERSATION_ID}$`));

  // The handed-off query is auto-sent; the streamed assistant reply appears.
  await expect(page.getByText("What do I need for a student visa?")).toBeVisible();
  await expect(page.getByText("Hello from E2E assistant")).toBeVisible();
});

test("shows the empty state for a fresh conversation without creating another", async ({
  page,
}) => {
  await setSessionCookie(page.context());
  let createCalls = 0;
  await mockConversationRouters(page, EMPTY_CONVERSATION, () => {
    createCalls += 1;
  });

  await page.goto(`/chat/${CONVERSATION_ID}`);
  await expect(page.getByRole("heading", { name: "How can I help you today?" })).toBeVisible();
  // Merely viewing a conversation must never create a new one.
  expect(createCalls).toBe(0);
});

test("admin sees another user's conversation read-only (no composer, no write actions)", async ({
  page,
}) => {
  await setSessionCookie(page.context(), { role: "ADMIN" });

  // conversation.getById returns readOnly: true for a conversation owned by
  // someone else (the admin read bypass in the server router).
  const READ_ONLY_CONVERSATION = {
    id: CONVERSATION_ID,
    title: "User's conversation",
    mode: "AGENTIC",
    createdAt: ISO,
    updatedAt: ISO,
    readOnly: true,
    messages: [
      {
        id: "user-other",
        role: "USER",
        content: "What do I need for a student visa?",
        sources: [],
        metadata: { mode: "agentic" },
        createdAt: ISO,
      },
      {
        id: "assistant-other",
        role: "ASSISTANT",
        content: "A passport, proof of funds, and a university admission.",
        sources: [],
        metadata: { stage: "done" },
        createdAt: ISO,
      },
    ],
  };

  await mockTrpc(page, {
    "conversation.getById": () => READ_ONLY_CONVERSATION,
    "conversation.list": () => ({ items: [], nextCursor: null }),
    "source.list": () => [],
  });

  await page.goto(`/chat/${CONVERSATION_ID}`);

  // The read-only notice is visible and the thread is still readable.
  await expect(page.getByText(/Read-only view/)).toBeVisible();
  await expect(page.getByText("What do I need for a student visa?")).toBeVisible();
  await expect(
    page.getByText("A passport, proof of funds, and a university admission."),
  ).toBeVisible();

  // No composer, no send button, no regenerate/follow-up write surfaces.
  await expect(page.getByPlaceholder(/Ask about visas/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send message" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Regenerate answer" }),
  ).toHaveCount(0);
  // The follow-up chips are hidden too (they would send a message).
  await expect(page.getByText("How long does a German student visa take to process?")).toHaveCount(0);

  // Write actions are unreachable on every breakpoint. Desktop shows them in
  // the header (clear is disabled in read-only); mobile hides the header and
  // moves copy/delete into the overflow menu — where read-only drops delete.
  const isMobile = (page.viewportSize()?.width ?? 0) < 768;
  if (isMobile) {
    await page.getByRole("button", { name: "Conversation actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Copy conversation" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete conversation" })).toHaveCount(0);
  } else {
    // Present but inert — the server would reject it for a conversation the
    // admin does not own.
    await expect(page.getByRole("button", { name: "Clear conversation" })).toBeDisabled();
    // Copy stays available: reading + exporting is the point of the view.
    await expect(page.getByRole("button", { name: "Copy conversation" })).toBeVisible();
  }
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
  await expect(page).toHaveURL(/\/chat$/);

  const input = page.getByPlaceholder(/Ask about visas/);
  await input.fill("Trigger an error");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page).toHaveURL(new RegExp(`/chat/${CONVERSATION_ID}`));

  // Scoped to the banner: Next.js also injects a hidden route announcer with role="alert".
  const alert = page.getByRole("alert").filter({ hasText: "Streaming request failed" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Streaming request failed");
});
