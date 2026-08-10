import { chromium } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { setSessionCookie } from "../tests/e2e/helpers/auth";
import { mockTrpc, mockChatStream } from "../tests/e2e/helpers/trpc-mock";

loadEnv({ path: ".env" });
process.env.NEXTAUTH_SECRET ??= "e2e-local-secret-not-for-production";

const CONVERSATION_ID = "conv-e2e";
const ISO = "2026-08-01T00:00:00.000Z";

const browser = await chromium.launch();
const context = await browser.newContext();
await setSessionCookie(context, { role: "ADMIN" });

const page = await context.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("CONSOLE:", msg.text().slice(0, 400));
});
page.on("pageerror", (err) => console.log("PAGEERROR:", err.stack ?? String(err)));
page.on("request", (req) => {
  if (req.url().includes("/api/trpc")) console.log("REQ:", req.method(), req.url());
});
page.on("response", (res) => {
  if (res.url().includes("/api/trpc")) console.log("RES:", res.status(), res.url().slice(0, 120));
});

await mockTrpc(page, {
  "conversation.create": () => ({
    id: CONVERSATION_ID,
    title: "New conversation",
    mode: "AGENTIC",
    createdAt: ISO,
    updatedAt: ISO,
  }),
  "conversation.getById": () => ({
    id: CONVERSATION_ID,
    title: "New conversation",
    mode: "AGENTIC",
    createdAt: ISO,
    updatedAt: ISO,
    readOnly: false,
    messages: [],
  }),
  "conversation.list": () => ({ items: [], nextCursor: null }),
  "chat.sendMessage": () => ({ messageId: "user-e2e", conversationId: CONVERSATION_ID }),
  "admin.metrics": () => ({
    totalUsers: 12,
    totalMessages: 340,
    queriesToday: 23,
    cacheHitRate: 0.68,
    avgLatencyMs: 1450,
  }),
  "admin.dailyQueries": () => [],
  "admin.modeSplit": () => [],
  "admin.recentQueries": () => [],
});
await mockChatStream(page, [
  { type: "status", stage: "retrieval" },
  { type: "token", content: "hello" },
  { type: "done", messageId: "m1", sources: [], metadata: {} },
]);

await page.goto("http://localhost:3000/admin/dashboard");
await page.waitForTimeout(3500);
console.log("ADMIN URL:", page.url());

await page.goto("http://localhost:3000/chat");
await page.waitForTimeout(3500);
console.log("CHAT URL:", page.url());

await browser.close();
