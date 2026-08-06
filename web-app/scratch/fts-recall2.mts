import { prisma } from "@/server/db";
import { vectorQueries } from "@/server/db/vector-queries";
import { buildBm25 } from "@/server/rag/retrieval/bm25";

const queries = [
  "Is the APS certificate mandatory for Indian students applying to German universities?",
  "Brauchen indische Studierende eine APS-Zertifizierung für die Zulassung an deutschen Universitäten?",
  "Blocked account amount needed for the Germany visa for 2026",
  "Sperrkonto für das Visum Deutschland",
  "Goethe Zertifikat B2 Prüfung Anforderungen",
];

const chunks = await prisma.documentChunk.findMany({
  select: {
    id: true,
    parentId: true,
    documentId: true,
    sourceName: true,
    sourceUrl: true,
    text: true,
  },
});
const bm25 = buildBm25(chunks);

for (const q of queries) {
  const fts = await vectorQueries.sparseSearch(prisma, q, { topK: 200 });
  const ftsIds = new Set(fts.map((c) => c.id)); // string ids
  const bm15 = bm25.search(q, 15).map((c) => ({ ...c, id: String(c.id) }));
  const recalled = bm15.filter((c) => ftsIds.has(c.id)).length;
  const bmAll = bm25.search(q, 200).map((c) => ({ ...c, id: String(c.id) }));
  const bmIds = new Set(bmAll.map((c) => c.id));
  const common = [...ftsIds].filter((id) => bmIds.has(id)).length;
  console.log(`\nQ: ${q.slice(0, 60)}`);
  console.log(`  BM25 top-15 recalled in FTS top-200: ${recalled}/15`);
  console.log(`  FTS top-200 ∩ BM25 top-200: ${common}/200`);
}
process.exit(0);
