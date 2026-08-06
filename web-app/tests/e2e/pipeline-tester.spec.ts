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
  stages: [
    { index: 0, name: "Query disambiguation & guardrail", durationMs: 400, status: "executed" },
    { index: 1, name: "Research agent (ReAct)", durationMs: 1200, status: "executed" },
    { index: 2, name: "Analyst (comparison matrix)", durationMs: 500, status: "executed" },
    { index: 3, name: "Writer (markdown synthesis)", durationMs: 300, status: "executed" },
  ],
  llmCalls: [
    {
      stage: "Stage 2 — Analyst (comparison matrix)",
      provider: "groq",
      model: "llama-3.1-8b-instant",
      latencyMs: 500,
      promptTokens: 900,
      completionTokens: 220,
      totalTokens: 1120,
      costUsd: 0.0000626,
    },
  ],
  totalCostUsd: 0.0000626,
};

const noRuns = { items: [], nextCursor: null };

const storedRun = {
  id: "run-1",
  prompt: "Stored visa question",
  traceJson: fullTrace,
  latencyMs: 2400,
  status: "SUCCESS",
  error: null,
  createdAt: "2026-08-01T10:00:00.000Z",
};

/**
 * Base mocks for the background-execution contract: `admin.testPipeline` now
 * returns `{ runId }` instantly and the client polls `admin.getTestRun` until
 * the row reaches a terminal state, so the trace is delivered via the poll.
 */
type MockRun = Omit<typeof storedRun, "error"> & { error: string | null };

async function mockTesterBasics(page: import("@playwright/test").Page, run: MockRun) {
  await mockTrpc(page, {
    "admin.testPipeline": () => ({ runId: run.id }),
    "admin.getTestRun": () => run,
    "admin.listTestRuns": () => noRuns,
    "admin.metrics": () => ({
      totalUsers: 1,
      totalMessages: 1,
      queriesToday: 0,
      cacheHitRate: 0,
      avgLatencyMs: 0,
    }),
  });
}

async function openTester(page: import("@playwright/test").Page) {
  await setSessionCookie(page.context(), { role: "ADMIN" });
  await mockTesterBasics(page, storedRun);
  await page.goto("/admin/pipeline-tester");
  await expect(page.getByRole("heading", { name: "Pipeline tester" })).toBeVisible();
}

test("renders all pipeline stages after running a trace", async ({ page }) => {
  await openTester(page);

  await page.getByLabel("Test pipeline query").fill("What documents are required?");
  await page.getByRole("button", { name: "Run trace" }).click();

  await expect(page.getByText("Pipeline trace")).toBeVisible({ timeout: 10_000 });

  await expect(
    page.getByRole("heading", { name: /Stage 0A — Query Disambiguation/ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /Stage 0B — Domain Guardrail/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Stage 1A\/B\/C\/D — Query Expansion & Hybrid Retrieval/ }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /Stage 1E — Research Agent/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Stage 2 — Analyst/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Stage 3 — Writer/ })).toBeVisible();

  await expect(page.getByText("Guardrail: PASSED")).toBeVisible();
  await expect(page.getByText("Hybrid Retrieval", { exact: true })).toBeVisible();

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
  await mockTesterBasics(page, {
    ...storedRun,
    traceJson: {
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
    },
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
  await mockTesterBasics(page, {
    ...storedRun,
    traceJson: {
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
    },
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
  await expect(
    page.getByText("No stored runs yet — run a trace above and it will appear here."),
  ).toBeVisible();
});

test("loads a stored trace from the recent-runs list", async ({ page }) => {
  await setSessionCookie(page.context(), { role: "ADMIN" });
  await mockTrpc(page, {
    "admin.testPipeline": () => ({ runId: storedRun.id }),
    "admin.getTestRun": () => storedRun,
    "admin.listTestRuns": () => ({ items: [storedRun], nextCursor: null }),
    "admin.metrics": () => ({
      totalUsers: 1,
      totalMessages: 1,
      queriesToday: 0,
      cacheHitRate: 0,
      avgLatencyMs: 0,
    }),
  });
  await page.goto("/admin/pipeline-tester");

  await expect(page.getByText("Stored visa question")).toBeVisible();
  await page.getByRole("button", { name: "View" }).click();

  await expect(page.getByText("Stored trace")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Pipeline trace")).toBeVisible();
  await expect(page.getByText(fullTrace.finalAnswer, { exact: true })).toBeVisible();
});

test("developer mode surfaces the full pipeline error detail", async ({ page }) => {
  await setSessionCookie(page.context(), { role: "ADMIN" });
  // The server stores the formatted debug detail (name/message/cause/stack) on
  // the run row, so the mock returns a FAILED run carrying that detail.
  await mockTesterBasics(page, {
    ...storedRun,
    id: "run-err",
    status: "FAILED",
    error:
      "[Error] LLM provider down (groq 429)\nCause: Error: rate limited\nStack:\nError: LLM provider down (groq 429)\n    at runResearch (src/server/rag/agents/orchestrator.ts:42:9)",
  });
  await page.goto("/admin/pipeline-tester");

  await page.getByLabel("Toggle developer mode").click();
  await page.getByLabel("Test pipeline query").fill("visa documents");
  await page.getByRole("button", { name: "Run trace" }).click();

  await expect(page.getByText("Pipeline error — developer mode")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/\[Error\] LLM provider down \(groq 429\)/)).toBeVisible();
  await expect(page.getByText(/Cause: Error: rate limited/)).toBeVisible();
  await expect(
    page.getByText(/at runResearch \(src\/server\/rag\/agents\/orchestrator\.ts:42:9\)/),
  ).toBeVisible();
});

test("without developer mode the raw error message is shown but no stack", async ({ page }) => {
  await setSessionCookie(page.context(), { role: "ADMIN" });
  await mockTesterBasics(page, {
    ...storedRun,
    id: "run-err",
    status: "FAILED",
    error: "LLM provider down",
  });
  await page.goto("/admin/pipeline-tester");

  await page.getByLabel("Test pipeline query").fill("visa documents");
  await page.getByRole("button", { name: "Run trace" }).click();

  await expect(page.getByText("LLM provider down")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Pipeline error — developer mode")).not.toBeVisible();
  await expect(page.getByText(/Stack:/)).not.toBeVisible();
});
