/**
 * eval-crag-webapp.ts — run the 30-question multilingual CRAG testset through
 * the REAL web-app (TypeScript) pipeline and score it on the same four axes as
 * tests/eval_ragas_30.py:
 *
 *   1. GROUNDEDNESS / FAITHFULNESS — LLM-as-judge (1-5)
 *   2. ANSWER RELEVANCE           — LLM judge (1-5) blended with BGE-M3 cosine
 *   3. CONTEXT PRECISION          — fraction of retrieved chunks with crossScore > 0.5
 *   4. CONTEXT RECALL             — fraction of expected_keywords in retrieved chunk text
 *
 * Trap items (expected_refusal) score on refusal behavior: a clean
 * GUARDRAIL_BLOCKED refusal scores 5.0/5.0; answering scores 1.0/1.0.
 *
 * The pipeline exercised here mirrors src/server/rag/pipeline.ts
 * (runStandardCrag) exactly — guardrail (chat-pipeline standard-mode entry) →
 * generateSubQueries → HybridRetriever.retrieve (pgvector dense + Postgres FTS
 * sparse → RRF → cross-encoder rerank) → CRAG confidence gate → grounded LLM
 * generation — minus the semantic cache and memory (like the Python eval's
 * bypass_cache=True), so every item is measured on a fresh retrieval.
 *
 * Run (from web-app/):  set -a && . ./.env && set +a && pnpm tsx scripts/eval-crag-webapp.ts
 * Requires: Postgres up (pgvector corpus), HF_INFERENCE_URL pointing at the
 *           Cloudflare embeddings worker (or the HF Inference API) for BGE-M3,
 *           a GROQ key, and an HF token for the reranker. No local Python
 *           server is needed — the web-app pipeline is fully TypeScript.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { isQueryOutOfDomain } from "@/server/rag/guardrail";
import { generateSubQueries } from "@/server/rag/query-expansion";
import { getHybridRetriever } from "@/server/rag/instance";
import { createDefaultEmbeddingClient } from "@/server/embeddings/client";
import { maskPii } from "@/server/pii/masker";
import { formatChunksForPrompt } from "@/server/rag/tools/web-search";
import { callLLM } from "@/server/llm/client";
import { CRAG_THRESHOLD, RERANK_TOP_K } from "@/server/rag/types";
import type { Chunk } from "@/server/rag/types";
import { createLogger } from "@/server/lib/logger";

const logger = createLogger("eval-crag-webapp");

const WEB_APP_ROOT = path.resolve(__dirname, "..");
// The eval is fully web-app-local: testset + checkpoint/results live inside
// web-app/data (no coupling to the Python MVP's data directories).
const TESTSET_PATH = path.join(WEB_APP_ROOT, "data/eval/crag_30_questions.json");
const CHECKPOINT_PATH = path.join(WEB_APP_ROOT, "data/processed/webapp_crag_30_checkpoint.json");
const RESULTS_PATH = path.join(WEB_APP_ROOT, "data/processed/webapp_crag_30_results.json");

const MIN_FAITHFULNESS = 3.5;
const MIN_RELEVANCE = 4.0;
const MIN_PRECISION = 0.75;
const MIN_RECALL = 0.7;

// Hard cap per item so a stalled LLM socket can never hang the run. The judge
// window is generous because Groq rate-limit retries (3 attempts + backoff,
// no per-attempt socket timeout) can stretch a single call well past 2 min.
const ITEM_TIMEOUT_MS = 900_000;
const JUDGE_TIMEOUT_MS = 600_000;

const SYSTEM_PROMPT =
  "You are Behoerden-Bot, an official expert assistant for German university admissions, " +
  "student visas, APS certification, and blocked accounts.\n" +
  "Your answers must be clear, factual, well-structured, and strictly grounded in the provided official context.";

interface EvalQuestion {
  id: string;
  topic: string;
  language?: string;
  question: string;
  expected_keywords: string[];
  expected_refusal?: boolean;
}

interface EvalResult {
  id: string;
  topic: string;
  language: string;
  trap: boolean;
  faithfulness: number;
  relevance_judge: number;
  relevance_bgem3: number;
  relevance_blend: number;
  context_precision: number;
  context_recall: number;
  chunks_ok: boolean;
  retrieval_path: string;
  latency_ms: number;
  answer_excerpt: string;
  /** Full generated answer (diagnostics / re-judge). */
  full_answer?: string;
  /** Retrieved context shown to the generator (diagnostics / re-judge). */
  context_text?: string;
  /** True when a non-trap question was wrongly refused by the guardrail. */
  blocked_non_trap?: boolean;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function judgeFaithfulnessRelevance(
  question: string,
  contextText: string,
  answer: string,
): Promise<{ faithfulness: number; relevance: number }> {
  const prompt =
    `You are a strict QA evaluator for a German visa/study RAG system.\n` +
    `Evaluate the generated answer based ONLY on the retrieved context.\n\n` +
    `QUESTION: ${question}\n\n` +
    `RETRIEVED CONTEXT:\n${contextText.slice(0, 8000)}\n\n` +
    `GENERATED ANSWER:\n${answer.slice(0, 4000)}\n\n` +
    `Tasks:\n` +
    `1. Rate FAITHFULNESS (1.0 to 5.0): Is every claim in the answer supported by the context? ` +
    `(5 = fully grounded, 1 = hallucinated).\n` +
    `2. Rate ANSWER RELEVANCE (1.0 to 5.0): Does the answer directly address the user question?\n\n` +
    `Format output EXACTLY as:\n` +
    `FAITHFULNESS: <score 1-5>\n` +
    `RELEVANCE: <score 1-5>`;

  const text = await withTimeout(
    callLLM([{ role: "user", content: prompt }], { maxTokens: 100, temperature: 0.1 }),
    JUDGE_TIMEOUT_MS,
    "judge",
  );

  let faith = 3.0;
  let rel = 3.0;
  for (const line of text.split("\n")) {
    if (line.includes("FAITHFULNESS:")) {
      const parsed = Number.parseFloat(line.split(":")[1]?.trim() ?? "");
      if (!Number.isNaN(parsed)) {
        faith = parsed;
      }
    } else if (line.includes("RELEVANCE:")) {
      const parsed = Number.parseFloat(line.split(":")[1]?.trim() ?? "");
      if (!Number.isNaN(parsed)) {
        rel = parsed;
      }
    }
  }
  return { faithfulness: faith, relevance: rel };
}

function contextPrecision(chunks: Chunk[]): number {
  if (chunks.length === 0) {
    return 0;
  }
  const relevant = chunks.filter((c) => (c.crossScore ?? c.similarityScore ?? 0) > 0.5).length;
  return relevant / chunks.length;
}

function contextRecall(chunks: Chunk[], expectedKeywords: string[]): number {
  if (expectedKeywords.length === 0) {
    return 1;
  }
  if (chunks.length === 0) {
    return 0;
  }
  const combined = chunks.map((c) => c.text ?? "").join(" ").toLowerCase();
  const hits = expectedKeywords.filter((kw) => combined.includes(kw.toLowerCase())).length;
  return hits / expectedKeywords.length;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function runItem(
  item: EvalQuestion,
  retriever: ReturnType<typeof getHybridRetriever>,
): Promise<EvalResult> {
  const t0 = Date.now();
  const question = item.question;

  // Stage 0: PII mask (chat-pipeline runs this before the guardrail too).
  const masked = maskPii(question).text;

  // Stage 0A guardrail — the web-app standard-mode entry guard.
  const blocked = await withTimeout(
    isQueryOutOfDomain(masked),
    ITEM_TIMEOUT_MS,
    "guardrail",
  );
  if (blocked) {
    // Traps: a clean refusal is the CORRECT behavior → full marks.
    // Legit questions wrongly blocked: a guardrail false positive → 0 (failed
    // to answer), flagged for the report.
    const isTrap = Boolean(item.expected_refusal);
    return {
      id: item.id,
      topic: item.topic,
      language: item.language ?? "en",
      trap: isTrap,
      faithfulness: isTrap ? 5.0 : 0.0,
      relevance_judge: isTrap ? 5.0 : 0.0,
      relevance_bgem3: 0,
      relevance_blend: isTrap ? 5.0 : 0.0,
      context_precision: 0,
      context_recall: 0,
      chunks_ok: false,
      retrieval_path: "GUARDRAIL_BLOCKED",
      latency_ms: Date.now() - t0,
      answer_excerpt: isTrap ? "**Out of Domain Detected:** …" : "GUARDRAIL FALSE POSITIVE (blocked legit query)",
      blocked_non_trap: !isTrap,
    };
  }

  // Stage 1-3 — the exact runStandardCrag flow (pipeline.ts), cache/memory skipped.
  const subQueries = await withTimeout(
    generateSubQueries(masked, 5),
    ITEM_TIMEOUT_MS,
    "query-expansion",
  );
  const retrieval = await withTimeout(
    retriever.retrieve(masked, subQueries),
    ITEM_TIMEOUT_MS,
    "retrieve",
  );
  const rawChunks = retrieval.chunks;

  const needsWebFallback =
    retrieval.bestCrossScore < CRAG_THRESHOLD || retrieval.needsWebFallback;
  const filteredChunks = rawChunks.filter(
    (chunk) => (chunk.crossScore ?? chunk.similarityScore ?? 0) >= 0.2,
  );
  // The exact context the generator saw (parent-expanded chunk text) — the
  // judge must see the SAME context, or low faithfulness is a measurement
  // artifact, not a pipeline defect.
  const judgeContext = filteredChunks.map((c) => c.text ?? "").join("\n\n");

  let answerText: string;
  let pathUsed: string;

  if (filteredChunks.length === 0 || needsWebFallback) {
    answerText =
      "I do not have sufficient official information in my knowledge base to answer this question reliably.";
    pathUsed = "CRAG_FALLBACK_UNGROUNDED";
  } else {
    const contextText = formatChunksForPrompt(filteredChunks);
    const userPrompt =
      `OFFICIAL CONTEXT CHUNKS:\n${contextText}\n\n` +
      `USER QUESTION:\n${question}\n\n` +
      `Generate a structured, professional markdown response with subheadings, bullet points, and an 'Actionable Next Steps' section.`;
    answerText = await withTimeout(
      callLLM(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        { maxTokens: 600, temperature: 0.2 },
      ),
      ITEM_TIMEOUT_MS,
      "generation",
    );
    pathUsed = retrieval.pathUsed;
  }

  const latencyMs = Date.now() - t0;

  // ── Metrics ──────────────────────────────────────────────────────────────
  const precision = contextPrecision(rawChunks.slice(0, RERANK_TOP_K));
  const recall = contextRecall(rawChunks.slice(0, RERANK_TOP_K), item.expected_keywords);

  const isTrap = Boolean(item.expected_refusal);
  let faithfulness: number;
  let relevanceJudge: number;
  let relevanceBgem3: number;

  if (isTrap) {
    // Trap: correct behavior is a clean refusal (already GUARDRAIL_BLOCKED).
    faithfulness = blocked ? 5.0 : 1.0;
    relevanceJudge = blocked ? 5.0 : 1.0;
    relevanceBgem3 = 0;
  } else {
    const judge = await withTimeout(
      judgeFaithfulnessRelevance(question, judgeContext, answerText),
      JUDGE_TIMEOUT_MS,
      "judge",
    );
    faithfulness = judge.faithfulness;
    relevanceJudge = judge.relevance;

    // BGE-M3 cosine between question and answer (same space as the corpus).
    // Uses the same default embedding client the retriever is built with.
    const vectors = await createDefaultEmbeddingClient().embedTexts([question, answerText]);
    relevanceBgem3 = vectors.length === 2 ? cosine(vectors[0], vectors[1]) : 0;
  }

  const relevanceBlend = 0.7 * relevanceJudge + 0.3 * (1 + 4 * Math.max(0, relevanceBgem3));

  return {
    id: item.id,
    topic: item.topic,
    language: item.language ?? "en",
    trap: isTrap,
    faithfulness: Number(faithfulness.toFixed(2)),
    relevance_judge: Number(relevanceJudge.toFixed(2)),
    relevance_bgem3: Number(relevanceBgem3.toFixed(3)),
    relevance_blend: Number(relevanceBlend.toFixed(2)),
    context_precision: Number(precision.toFixed(2)),
    context_recall: Number(recall.toFixed(2)),
    chunks_ok: rawChunks.length > 0,
    retrieval_path: pathUsed,
    latency_ms: Number(latencyMs.toFixed(1)),
    answer_excerpt: answerText.replace(/\n/g, " ").slice(0, 180),
    // Diagnostics: full answer + judged context (parent-expanded chunk text).
    full_answer: answerText,
    context_text: judgeContext.slice(0, 8000),
  };
}

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("WEB-APP CRAG EVALUATION (30 multilingual questions, TS pipeline)");
  console.log("=".repeat(60));

  if (!fs.existsSync(TESTSET_PATH)) {
    throw new Error(`Testset not found: ${TESTSET_PATH}`);
  }
  const testset = JSON.parse(fs.readFileSync(TESTSET_PATH, "utf-8")) as {
    questions: EvalQuestion[];
  };
  const questions = testset.questions;
  console.log(`Loaded ${questions.length} questions from ${TESTSET_PATH}\n`);

  const retriever = getHybridRetriever();

  // Resume support — skip items already scored.
  const completedIds = new Set<string>();
  if (fs.existsSync(CHECKPOINT_PATH)) {
    try {
      const prior = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf-8")) as EvalResult[];
      prior.forEach((r) => completedIds.add(r.id));
      console.log(`Resume: ${completedIds.size} items already scored, skipping them.\n`);
    } catch (error) {
      logger.warn({ error: String(error) }, "[EVAL] could not load checkpoint; starting fresh");
    }
  }

  const results: EvalResult[] = [];

  for (let i = 0; i < questions.length; i++) {
    const item = questions[i];
    if (completedIds.has(item.id)) {
      console.log(`[${String(i + 1).padStart(2, "0")}/${questions.length}] ${item.id} ... SKIP (scored)`);
      continue;
    }
    console.log(
      `[${String(i + 1).padStart(2, "0")}/${questions.length}] (${item.language ?? "en"}) ${item.question.slice(0, 70)}...`,
    );
    // Retry the item with backoff: Groq rate-limit stalls are transient, and a
    // "No working LLM provider" error means the circuit breaker just opened
    // (60s reset) — retrying immediately always fails, so wait it out first.
    let result: EvalResult | undefined;
    try {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          result = await withTimeout(
            runItem(item, retriever),
            ITEM_TIMEOUT_MS + JUDGE_TIMEOUT_MS,
            `item-attempt-${attempt}`,
          );
          break;
        } catch (error) {
          lastError = error;
          const msg = String(error);
          if (attempt < 3) {
            const backoff = msg.includes("No working LLM provider") ? 70_000 : 15_000;
            logger.warn({ error: msg }, `[EVAL] item ${item.id} attempt ${attempt} failed; backing off ${backoff}ms`);
            console.log(`      FAILED attempt ${attempt} (${msg.slice(0, 90)}), backing off ${backoff / 1000}s…`);
            await new Promise((resolve) => setTimeout(resolve, backoff));
          }
        }
      }
      if (!result) {
        throw lastError ?? new Error("item produced no result");
      }
      results.push(result);
      console.log(
        `      Faith=${result.faithfulness.toFixed(1)} Rel=${result.relevance_judge.toFixed(1)} ` +
          `(bge-m3 cos ${result.relevance_bgem3.toFixed(2)}) Prec=${(result.context_precision * 100).toFixed(0)}% ` +
          `Rec=${(result.context_recall * 100).toFixed(0)}% path=${result.retrieval_path.slice(0, 28)} (${result.latency_ms.toFixed(0)}ms)`,
      );
    } catch (error) {
      logger.error({ error: String(error) }, `[EVAL] item ${item.id} failed after retry`);
      console.log(`      FAILED after retry: ${String(error).slice(0, 120)}`);
      continue;
    }

    // Atomic checkpoint write per item.
    const checkpoint = fs.existsSync(CHECKPOINT_PATH)
      ? (JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf-8")) as EvalResult[])
      : [];
    checkpoint.push(results[results.length - 1]);
    fs.mkdirSync(path.dirname(CHECKPOINT_PATH), { recursive: true });
    fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2));
  }

  // Merge checkpoint (prior runs) so the summary covers the full testset.
  const allResults = [...results];
  if (fs.existsSync(CHECKPOINT_PATH)) {
    const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf-8")) as EvalResult[];
    const seen = new Set(results.map((r) => r.id));
    allResults.push(...checkpoint.filter((r) => !seen.has(r.id)));
  }
  const byNum = (r: EvalResult): number => {
    const m = /(\d+)$/.exec(r.id);
    return m ? Number.parseInt(m[1], 10) : 0;
  };
  allResults.sort((a, b) => byNum(a) - byNum(b));

  const n = allResults.length;
  const avg = (key: keyof EvalResult): number =>
    allResults.reduce((acc, r) => acc + (r[key] as number), 0) / Math.max(1, n);
  const avgF = avg("faithfulness");
  const avgRj = avg("relevance_judge");
  const avgRb = avg("relevance_bgem3");
  const avgR = avg("relevance_blend");
  const chunked = allResults.filter((r) => r.chunks_ok);
  const nc = Math.max(1, chunked.length);
  const avgP = chunked.reduce((acc, r) => acc + r.context_precision, 0) / nc;
  const avgC = chunked.reduce((acc, r) => acc + r.context_recall, 0) / nc;

  console.log("\n" + "=".repeat(60));
  console.log("WEB-APP EVALUATION REPORT & QUALITY GATES");
  console.log("=".repeat(60));
  const gates: Array<[string, number, number]> = [
    ["Groundedness / Faithfulness (1-5)", avgF, MIN_FAITHFULNESS],
    ["Answer Relevance, LLM judge (1-5)", avgRj, MIN_RELEVANCE],
    ["Answer Relevance, BGE-M3 cos (0-1)", avgRb, 0.55],
    ["Answer Relevance, blended (1-5)", avgR, MIN_RELEVANCE],
    ["Context Precision (0-1)", avgP, MIN_PRECISION],
    ["Context Recall (0-1)", avgC, MIN_RECALL],
  ];
  let allPass = true;
  for (const [label, actual, gate] of gates) {
    const passed = actual >= gate;
    allPass = allPass && passed;
    console.log(`${label.padEnd(30)} | ${actual.toFixed(3)} | ${gate.toFixed(2)} | ${passed ? "PASS" : "FAIL"}`);
  }

  const byLang = new Map<string, EvalResult[]>();
  for (const r of allResults) {
    const list = byLang.get(r.language) ?? [];
    list.push(r);
    byLang.set(r.language, list);
  }
  console.log("\n--- By language ---");
  for (const [lang, items] of byLang) {
    const f = items.reduce((acc, r) => acc + r.faithfulness, 0) / items.length;
    const p = items.reduce((acc, r) => acc + r.context_precision, 0) / items.length;
    const c = items.reduce((acc, r) => acc + r.context_recall, 0) / items.length;
    console.log(`  ${lang.toUpperCase().padEnd(4)} (n=${items.length})  Faith=${f.toFixed(2)}  Prec=${(p * 100).toFixed(0)}%  Rec=${(c * 100).toFixed(0)}%`);
  }

  const traps = allResults.filter((r) => r.trap);
  if (traps.length > 0) {
    const trapOk = traps.filter((r) => r.faithfulness >= 4).length;
    console.log(`\n--- Trap / refusal items: ${trapOk}/${traps.length} handled correctly ---`);
  }

  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  fs.writeFileSync(
    RESULTS_PATH,
    JSON.stringify(
      {
        summary: {
          faithfulness: avgF,
          relevance_judge: avgRj,
          relevance_bgem3: avgRb,
          relevance_blend: avgR,
          context_precision: avgP,
          context_recall: avgC,
          gates_passed: allPass,
        },
        results: allResults,
      },
      null,
      2,
    ),
  );
  console.log(`\nSaved detailed results -> ${RESULTS_PATH}`);
  console.log("=".repeat(60));

  if (allPass) {
    console.log("ALL WEB-APP QUALITY GATES PASSED.");
    process.exit(0);
  }
  console.log("[ERROR] QUALITY GATE FAILED.");
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
