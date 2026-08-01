import { prisma } from "@/server/db";
import type { Chunk } from "@/server/rag/types";

/**
 * True Parent-Child Chunking join (§2.5.5).
 *
 * Retrieval matches short child chunks (~200 ch) for precision; the LLM must
 * instead receive the surrounding parent context (~2000 ch). Given the reranked
 * children, this fetches each parent once and returns parent-level chunks,
 * deduplicated by parentId and preserving the best child's score + snippet.
 *
 * Legacy flat chunks (parentId == null) pass through unchanged.
 */
export async function expandToParents(chunks: Chunk[]): Promise<Chunk[]> {
  const parentIds = Array.from(
    new Set(chunks.map((chunk) => chunk.parentId).filter((id): id is string => Boolean(id))),
  );
  if (parentIds.length === 0) {
    return chunks;
  }

  const parents = await prisma.documentParentChunk.findMany({
    where: { id: { in: parentIds.map(Number) } },
    select: { id: true, text: true },
  });
  const parentTextById = new Map(parents.map((parent) => [String(parent.id), parent.text]));
  const seen = new Set<string>();
  const expanded: Chunk[] = [];

  for (const child of chunks) {
    const parentText = child.parentId ? parentTextById.get(child.parentId) : undefined;
    if (parentText !== undefined) {
      if (seen.has(child.parentId!)) {
        continue;
      }
      seen.add(child.parentId!);
      expanded.push({ ...child, text: parentText, childText: child.text });
    } else {
      expanded.push(child);
    }
  }

  return expanded;
}
