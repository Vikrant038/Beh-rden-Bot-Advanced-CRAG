import { NextResponse } from "next/server";
import { runAgenticRag } from "@/server/rag/agents/orchestrator";
import { getHybridRetriever } from "@/server/rag/instance";
import { semanticCache } from "@/server/rag/cache/semantic-cache";
import { createMemory } from "@/server/rag/memory/summary-buffer";

export const runtime = "nodejs";

export async function GET() {
  try {
    const memory = createMemory("test");
    const result = await runAgenticRag("hi", {
      hybridRetriever: getHybridRetriever(),
      cache: semanticCache,
      memory,
    });
    return NextResponse.json({ success: true, result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause ? String(error.cause) : null;
    const stack = error instanceof Error ? error.stack : undefined;
    return NextResponse.json({
      success: false,
      error: message,
      cause,
      stack,
    });
  }
}
