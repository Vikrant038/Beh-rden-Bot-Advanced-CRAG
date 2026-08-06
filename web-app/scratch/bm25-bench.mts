/* Reproduce the 147s BM25 hotspot at REAL production scale, and verify the fix.
 * Real corpus: 23,934 chunks, ~22 tokens/chunk, 26,158 distinct terms.
 * Run: pnpm tsx scratch/bm25-bench.mts  (needs local Postgres up) */
import { BM25Okapi, defaultTokenizer } from "../src/server/rag/retrieval/bm25";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const rows = await p.documentChunk.findMany({ select: { text: true } });
await p.$disconnect();

const corpus = rows.map((r) => defaultTokenizer(r.text));
console.log(`corpus: ${corpus.length} docs`);

const t0 = Date.now();
const bm25 = new BM25Okapi(corpus);
console.log(`index build: ${Date.now() - t0}ms`);

const SUB_QUERIES = [
  "Is the APS certificate mandatory for Indian students applying to German universities?",
  "APS certificate requirement for Indian students applying to German universities",
  "Is APS certificate necessary for Indian students applying to German universities?",
  "Bewilligungsbescheinigung fuer indische Studierende: Pflicht oder freiwillig?",
  "Ist die APS-Zertifizierung fuer indische Studierende verpflichtend?",
];

const t1 = Date.now();
for (const q of SUB_QUERIES) {
  bm25.search(defaultTokenizer(q), 15);
}
const elapsed = Date.now() - t1;
console.log(`>>> 5 sub-query search (CURRENT CODE): ${elapsed}ms`);
