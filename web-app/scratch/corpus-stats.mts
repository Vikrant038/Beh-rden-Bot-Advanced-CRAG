/* Measure the REAL production corpus: chunk count, doc length, vocabulary size. */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const count = await p.documentChunk.count();
const rows = await p.documentChunk.findMany({ select: { text: true } });

let totalChars = 0;
let totalTokens = 0;
const vocab = new Set<string>();
for (const r of rows) {
  totalChars += r.text.length;
  const toks = r.text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  totalTokens += toks.length;
  for (const t of toks) vocab.add(t);
}

console.log("chunks (DocumentChunk rows):", count);
console.log("avg chars/chunk :", Math.round(totalChars / Math.max(1, rows.length)));
console.log("avg tokens/chunk:", Math.round(totalTokens / Math.max(1, rows.length)));
console.log("VOCAB SIZE (distinct terms):", vocab.size);
await p.$disconnect();
