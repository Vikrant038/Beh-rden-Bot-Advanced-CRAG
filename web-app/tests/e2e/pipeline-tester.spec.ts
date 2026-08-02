import { test, expect } from "@playwright/test";
import { setSessionCookie } from "./helpers/auth";
import { mockTrpc } from "./helpers/trpc-mock";

const fullTrace = {
  userQuery: "What documents are required for a German student visa?",
  maskedQuery: "What documents are required for a German student visa?",
  guardrail: { passed: true, reason: "In-domain" },
  finalAnswer: "You need a valid passport, proof of funds, and a university admission letter.",
  researchSteps: [
    {
      iteration: 1,
      thought: "Retrieve documents about visa requirements.",
      action: "Hybrid Retrieval",
      observation: "Found 3 relevant sources.",
    },
  ],
  analysisMatrix: {
    summary: "Required documents include passport, proof of funds, admission.",
    structured_table: "| Document | Required |\n| Passport | Yes |",
    key_insights: ["Proof of funds is mandatory."],
    verified_facts: ["Blocked account is accepted."],
  },
  sources: [
    {
      name: "visa-guide.pdf",
      url: "pdf://abc/visa-guide.pdf",
      score: 0.82,
      documentId: "doc-1",
      childText: "Matched child snippet about blocked account.",
      parentText: "Expanded parent context with the full blocked account section.",
    },
  ],
  totalLatencyMs: 2400,
};

async function openTester(page: import("@playwright/test").Page) {
  await setSessionCookie(page.context(), { role: "ADMIN" });
  await mockTrpc(page, {
    "admin.testPipeline": () => fullTrace,
    "admin.metrics": () => ({
      totalUsers: 1,
      totalMessages: 1,
      queriesToday: 0,
      cacheHitRate: 0,
      avgLatencyMs: 0,
    }),
  });
  await page.goto("/admin/pipeline-tester");
  await expect(page.getByRole("heading", { name: "Pipeline tester" })).toBeVisible();
}

test("renders all four stages after running a trace", async ({ page }) => {
  await openTester(page);

  await page.getByLabel("Test pipeline query").fill("What documents are required?");
  await page.getByRole("button", { name: "Run trace" }).click();

  await expect(page.getByText("Pipeline trace")).toBeVisible({ timeout: 10_000 });

  await expect(
    page.getByRole("heading", { name: /Stage 0 — Query disambiguation/ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /Stage 1 — Research agent/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Stage 2 — Analyst/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Stage 3 — Writer/ })).toBeVisible();

  await expect(page.getByText("Guardrail: PASSED")).toBeVisible();
  await expect(page.getByText("Hybrid Retrieval")).toBeVisible();

  const sourceCard = page.getByRole("button", { name: /visa-guide\.pdf/i });
  await expect(sourceCard).toBeVisible();
  await sourceCard.click();

  await expect(page.getByText("Expanded parent context", { exact: true })).toBeVisible();
  await expect(page.getByText(fullTrace.finalAnswer, { exact: true })).toBeVisible();
});

test("shows the child snippet and expanded parent context", async ({ page }) => {
  await openTester(page);

  await page.getByLabel("Test pipeline query").fill("blocked account requirement");
  await page.getByRole("button", { name: "Run trace" }).click();

  const sourceCard = page.getByRole("button", { name: /visa-guide\.pdf/i });
  await expect(sourceCard).toBeVisible({ timeout: 10_000 });
  await sourceCard.click();

  const sourcePanel = page.getByText("Matched child snippet about blocked account.");
  await expect(sourcePanel).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/full blocked account section/)).toBeVisible();
});

test("surfaces an out-of-domain guardrail block", async ({ page }) => {
  await setSessionCookie(page.context(), { role: "ADMIN" });
  await mockTrpc(page, {
    "admin.testPipeline": () => ({
      ...fullTrace,
      userQuery: "Tell me about cooking pasta",
      maskedQuery: "Tell me about cooking pasta",
      guardrail: { passed: false, reason: "Out of domain" },
      finalAnswer: "**Out of Domain Detected:** I cannot help with general queries.",
      researchSteps: [
        {
          iteration: 1,
          thought: "Check domain validity of the query.",
          action: "Stage 0A Guardrail",
          observation: "Query rejected as Out of Domain.",
        },
      ],
      analysisMatrix: {
        summary: "Out of domain.",
        structured_table: "",
        key_insights: [],
        verified_facts: [],
      },
      sources: [],
      totalLatencyMs: 120,
    }),
    "admin.metrics": () => ({
      totalUsers: 1,
      totalMessages: 1,
      queriesToday: 0,
      cacheHitRate: 0,
      avgLatencyMs: 0,
    }),
  });
  await page.goto("/admin/pipeline-tester");

  await page.getByLabel("Test pipeline query").fill("cooking pasta");
  await page.getByRole("button", { name: "Run trace" }).click();

  await expect(page.getByText("Guardrail: BLOCKED")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("out of domain", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Pipeline short-circuited — downstream agents never ran."),
  ).toBeVisible();
  await expect(page.getByText(/Sources \(0\)/)).toBeVisible();
});

test("marks a cache-hit trace with a badge", async ({ page }) => {
  await setSessionCookie(page.context(), { role: "ADMIN" });
  await mockTrpc(page, {
    "admin.testPipeline": () => ({
      ...fullTrace,
      finalAnswer: "Served from cache.",
      researchSteps: [
        {
          iteration: 0,
          thought: "Check cache.",
          action: "Semantic Cache Hit",
          observation: "Found matching response in cache.",
        },
      ],
      analysisMatrix: {
        summary: "Served from cache.",
        structured_table: "",
        key_insights: [],
        verified_facts: [],
      },
      totalLatencyMs: 45,
    }),
    "admin.metrics": () => ({
      totalUsers: 1,
      totalMessages: 1,
      queriesToday: 0,
      cacheHitRate: 0,
      avgLatencyMs: 0,
    }),
  });
  await page.goto("/admin/pipeline-tester");

  await page.getByLabel("Test pipeline query").fill("visa fee germany");
  await page.getByRole("button", { name: "Run trace" }).click();

  await expect(page.getByText("cache hit", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Semantic Cache Hit")).toBeVisible();
});

test("shows the empty state before the first run", async ({ page }) => {
  await openTester(page);
  await expect(page.getByText("No trace yet")).toBeVisible();
});
