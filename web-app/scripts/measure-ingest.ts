/**
 * Diagnostic corpus measurement — sizes the resumable-ingest batch/budget
 * numbers from real data before code changes.
 *
 * Measures, end-to-end on one large PDF:
 *   1. parsePdf / cleanText / chunkParentChild timings + counts
 *   2. per-PARENT-BLOCK embed latency (the unit the resumable worker commits),
 *      via the same embedding client the pipeline uses (Gemini if
 *      GEMINI_API_KEY is active, else HF BGE)
 *   3. real per-block store transaction cost against Postgres (document
 *      parent insert + document_chunks raw insert + chunkCount update),
 *      cleaned up afterwards so the corpus is untouched
 *   4. derived sizing: blocks/tick within a Vercel-safe budget, ticks to
 *      completion, estimated background wall time
 *
 * Usage:
 *   pnpm exec tsx scripts/measure-ingest.ts [--file=data/pdfs/laws/englisch_aufenthg.pdf]
 *                                          [--provider=gemini|hf]
 *                                          [--max-blocks=N]   # cap embed loop (default: all)
 *                                          [--store-blocks=N] # real-DB sample size (default 10)
 */
import type { Prisma } from "@prisma/client";
import { config as loadEnv } from "dotenv";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";

// Load .env BEFORE importing any server module (env.ts validates process.env
// at import time and does not read .env itself).
loadEnv();

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}
function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`;
}

function parseArgs(argv: string[]) {
  const get = (name: string, fallback: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  return {
    file: get("file", "data/pdfs/laws/englisch_aufenthg.pdf"),
    provider: get("provider", process.env.GEMINI_API_KEY ? "gemini" : "hf"),
    maxBlocks: Number(get("max-blocks", "0")), // 0 = all
    storeBlocks: Number(get("store-blocks", "10")),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Dynamic imports so dotenv is loaded first.
  const { parsePdf } = await import("@/server/ingest/pdf-parser");
  const { cleanText } = await import("@/server/ingest/cleaner");
  const { chunkParentChild } = await import("@/server/ingest/chunker");
  const { HfEmbeddingClient, GeminiEmbeddingClient } = await import("@/server/embeddings/client");
  const { prisma } = await import("@/server/db");
  const { Prisma } = await import("@prisma/client");

  const buffer = await fs.readFile(args.file);
  console.log(`\n=== Loaded PDF: ${(buffer.length / 1024 / 1024).toFixed(2)} MB (${args.file})`);

  // ---- 1. parse / clean / chunk ----
  const t0 = performance.now();
  const parsed = await parsePdf(buffer);
  const t1 = performance.now();
  const cleaned = cleanText(parsed.text);
  const t2 = performance.now();
  const structure = chunkParentChild(cleaned);
  const t3 = performance.now();

  const childCount = structure.reduce((n, b) => n + b.children.length, 0);
  console.log(
    `parsePdf:      ${fmt(t1 - t0)} (${parsed.pages} pages, ${parsed.text.length} chars)`,
  );
  console.log(`cleanText:     ${fmt(t2 - t1)}`);
  console.log(
    `chunkParentChild: ${fmt(t3 - t2)} (${structure.length} parent blocks, ${childCount} children)`,
  );

  const childrenPerBlock = structure.map((b) => b.children.length).sort((a, b) => a - b);
  console.log(
    `children/parent: median ${median(childrenPerBlock)}, max ${Math.max(...childrenPerBlock)}`,
  );

  if (structure.length === 0) {
    console.log("No chunks; aborting.");
    return;
  }

  // ---- 2. per-parent-block embed (the worker's commit unit) ----
  const provider = args.provider;
  // `sim` uses synthetic normalized 1024-d vectors — for measuring the store
  // path only when no embed provider is reachable (e.g. HF blocked locally).
  const simClient = {
    embedTexts: async (texts: string[]): Promise<number[][]> =>
      texts.map(() => {
        const v = Array.from({ length: 1024 }, () => Math.random() * 2 - 1);
        const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        return v.map((x) => x / mag);
      }),
  };
  const client =
    provider === "gemini"
      ? new GeminiEmbeddingClient(process.env.GEMINI_API_KEY)
      : provider === "hf"
        ? new HfEmbeddingClient()
        : simClient;
  console.log(
    `\n=== Embedding via ${provider.toUpperCase()} (per parent block, serial — mimics the worker) ===`,
  );

  const blocksToEmbed =
    args.maxBlocks > 0 ? Math.min(args.maxBlocks, structure.length) : structure.length;
  const blockLatencies: number[] = [];
  const batchLatencies: number[] = []; // every 100 children, the Gemini cap — for comparison
  let embeddedChildren = 0;
  const childBatch: string[] = [];

  const t4 = performance.now();
  for (let i = 0; i < blocksToEmbed; i++) {
    const block = structure[i];
    const childTexts = block.children.map((c) => c.text);
    const s = performance.now();
    let vectors: number[][] = [];
    try {
      vectors = await client.embedTexts(childTexts);
    } catch (err) {
      console.error(
        `Embedding failed at block ${i}: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (blockLatencies.length === 0) {
        console.error("No blocks embedded — aborting.");
        process.exitCode = 1;
        return;
      }
      break;
    }
    const e = performance.now();
    blockLatencies.push(e - s);
    embeddedChildren += vectors.length;

    // Track cumulative children against the 100-per-request cap for the
    // batched-alternative comparison.
    childBatch.push(...childTexts);
    if (childBatch.length >= 100 || i === blocksToEmbed - 1) {
      if (childBatch.length > 1) {
        const bs = performance.now();
        await client.embedTexts(childBatch);
        const be = performance.now();
        batchLatencies.push(be - bs);
      }
      childBatch.length = 0;
    }
  }
  const t5 = performance.now();

  const totalEmbedMs = t5 - t4;
  console.log(
    `embedded: ${embeddedChildren}/${childCount} children across ${blockLatencies.length} parent-block calls`,
  );
  console.log(`total embed (block-level): ${fmt(totalEmbedMs)}`);
  if (blockLatencies.length > 0) {
    console.log(
      `per-block embed: first ${fmt(blockLatencies[0])}, median ${fmt(median(blockLatencies))}, p95 ${fmt(p95(blockLatencies))}`,
    );
  }
  if (batchLatencies.length > 0) {
    console.log(
      `per-100 batch: first ${fmt(batchLatencies[0])}, median ${fmt(median(batchLatencies))}, p95 ${fmt(p95(batchLatencies))}`,
    );
  }

  // ---- 3. real store sample (exact pipeline tx shape) with cleanup ----
  const storeBlocks = Math.min(args.storeBlocks, blocksToEmbed, structure.length);
  console.log(
    `\n=== Real store sample: ${storeBlocks} blocks through the pipeline transaction ===`,
  );

  const measureKey = `pdf://measure-${Date.now()}/englisch_aufenthg.pdf`;
  let docId: string | null = null;
  const storeLatencies: number[] = [];
  try {
    const t6 = performance.now();
    const doc = await prisma.document.create({
      data: {
        url: measureKey,
        title: "MEASURE",
        hash: "measure",
        chunkCount: 0,
        status: "INGESTING",
      },
      select: { id: true },
    });
    docId = doc.id;
    console.log(`test document created: ${fmt(performance.now() - t6)}`);

    for (let i = 0; i < storeBlocks; i++) {
      const block = structure[i];
      const childTexts = block.children.map((c) => c.text);
      const vectors = await client.embedTexts(childTexts); // re-embed just for store sample
      const s = performance.now();
      await prisma.$transaction(async (tx) => {
        const parent = await tx.documentParentChunk.create({
          data: { documentId: docId!, text: block.parent.text },
          select: { id: true },
        });
        const rows = block.children
          .map((child, idx) => {
            const v = vectors[idx];
            if (!v) return null;
            return Prisma.sql`(${docId}, ${parent.id}, ${"MEASURE"}, ${measureKey}, ${child.text}, ${`[${v.join(",")}]`}::vector, NOW())`;
          })
          .filter((row): row is Prisma.Sql => row !== null);
        if (rows.length > 0) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO document_chunks ("documentId","parentId","sourceName","sourceUrl","text","embedding","createdAt")
            VALUES ${Prisma.join(rows, ", ")}
          `);
        }
        await tx.document.update({ where: { id: docId! }, data: { chunkCount: rows.length } });
      });
      storeLatencies.push(performance.now() - s);
    }
    console.log(
      `store tx: first ${fmt(storeLatencies[0])}, median ${fmt(median(storeLatencies))}, p95 ${fmt(p95(storeLatencies))}`,
    );
  } catch (err) {
    console.error(`Store sample failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (docId) {
      await prisma.documentChunk.deleteMany({ where: { documentId: docId } });
      await prisma.documentParentChunk.deleteMany({ where: { documentId: docId } });
      await prisma.document.delete({ where: { id: docId } });
      console.log("test document + chunks cleaned up (corpus untouched)");
    }
    await prisma.$disconnect();
  }

  // ---- 4. derived sizing ----
  const embedMed = median(blockLatencies);
  const storeMed = median(storeLatencies);
  const perBlock = embedMed + storeMed;
  const VERCEL_CAP_MS = 60_000;
  const BUDGET_MS = Math.floor(VERCEL_CAP_MS * 0.75); // 75% safety margin
  const blocksPerTick = Math.max(1, Math.floor(BUDGET_MS / Math.max(1, perBlock)));
  const ticks = Math.ceil(structure.length / blocksPerTick);

  console.log(`\n=== SIZING (derived from data) ===`);
  console.log(
    `Vercel hard cap: ${VERCEL_CAP_MS / 1000}s → safe worker budget: ${BUDGET_MS / 1000}s (75%)`,
  );
  console.log(`per-block cost: embed ${fmt(embedMed)} + store ${fmt(storeMed)} = ${fmt(perBlock)}`);
  console.log(`blocks per tick: ${blocksPerTick}`);
  console.log(
    `ticks to complete ${structure.length} blocks: ${ticks} (each ~1 min cron cadence → ~${ticks} min background)`,
  );
  if (blockLatencies.length > 0) {
    console.log(
      `whole doc, single tick (no resume): ${fmt(totalEmbedMs)} embed-only → ${totalEmbedMs > BUDGET_MS ? "EXCEEDS budget ✗" : "fits ✓"}`,
    );
  }
  if (batchLatencies.length > 0) {
    const batchBlocks = Math.floor(BUDGET_MS / Math.max(1, median(batchLatencies)));
    console.log(
      `if children were batched 100/call instead: ~${batchBlocks} × 100-child batches per tick (different cursor granularity)`,
    );
  }
  console.log(
    `\nProvider note: production default is HF/BGE-M3 (corpus space); these timings are ${provider.toUpperCase()}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
