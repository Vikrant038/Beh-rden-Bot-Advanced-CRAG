/**
 * Cloudflare Worker — query-time embeddings via Workers AI.
 *
 * Speaks the exact contract of the web-app's HfEmbeddingClient so the TS side
 * needs no custom client: it POSTs to
 * `/pipeline/feature-extraction/{model}` with `{"inputs": [...]}` and expects
 * `number[][]` (1024-dim) back. Vercel points `HF_INFERENCE_URL` at this
 * worker's URL for the QUERY side; the CORPUS side embeds via the local
 * sentence-transformers server (same model → same space).
 *
 * Model: @cf/baai/bge-m3 — multilingual (covers the German corpus). The local
 * corpus server must load the same BAAI/bge-m3 weights so query and corpus
 * vectors live in one space (bge-m3 pools via CLS on both sides).
 *
 * Auth: bearer token via `EMBED_TOKEN` secret. Rejects anything without it —
 * otherwise this endpoint is free compute for anyone on the internet.
 */
export interface Env {
  AI: {
    run(
      model: string,
      inputs: { text: string | string[] } | { query: string; contexts: string[] },
    ): Promise<
      { shape: number[]; data: number[][] } | { result: Array<{ index: number; score: number }> }
    >;
  };
  EMBED_TOKEN: string;
}

const MODEL = "@cf/baai/bge-m3";
const RERANKER_MODEL = "@cf/baai/bge-reranker-base";
// Workers AI reranker contract: max 50 documents, each ≤ 4000 chars.
const RERANK_MAX_DOCS = 50;
const RERANK_MAX_DOC_CHARS = 4000;

/**
 * Minimal scheduled-event shape — avoids depending on @cloudflare/workers-types
 * (not installed in the web-app workspace, whose tsconfig still globs this
 * file for `pnpm typecheck`).
 */
interface ScheduledEventLike {
  scheduledTime: number;
  cron: string;
}

/** Constant-time string equality (prevents timing side channels on the token). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export default {
  /**
   * Keep the bge-m3 model loaded between real requests. Workers AI evicts
   * models after a short idle window, so the first query after a gap pays a
   * 10-20s cold start — which shows up as the "Dense Search (pgvector)"
   * stage in the admin pipeline tester. A 5-minute cron re-runs the model with
   * a throwaway input so the warm worker answers real queries in ~100-300ms.
   * Best-effort: a failed warm-up tick is harmless (the next tick retries).
   */
  async scheduled(_event: ScheduledEventLike, env: Env): Promise<void> {
    try {
      await env.AI.run(MODEL, { text: "keep-warm" });
      await env.AI.run(RERANKER_MODEL, { query: "keep-warm", contexts: ["keep-warm"] });
    } catch (error) {
      // Best-effort: a failed tick must not crash the worker, but log it so a
      // silently broken keep-warm (wrong input shape, model evicted forever)
      // is diagnosable from wrangler logs instead of looking healthy.
      console.warn(`[keep-warm] warm-up failed: ${String(error)}`);
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check (unauthenticated — exposes model names only).
    if (request.method === "GET" && url.pathname === "/healthz") {
      return Response.json({ ok: true, model: MODEL, reranker: RERANKER_MODEL });
    }

    if (request.method === "POST" && url.pathname.startsWith("/pipeline/text-classification/")) {
      return handleRerank(request, env);
    }

    if (request.method !== "POST" || !url.pathname.startsWith("/pipeline/feature-extraction/")) {
      return new Response("Not Found", { status: 404 });
    }

    // Token auth — reject without a valid bearer token. Constant-time
    // comparison so the comparison itself leaks nothing about the token.
    const auth = request.headers.get("Authorization") ?? "";
    if (
      !auth.startsWith("Bearer ") ||
      !timingSafeEqual(auth.slice("Bearer ".length), env.EMBED_TOKEN)
    ) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body: { inputs?: unknown };
    try {
      body = (await request.json()) as { inputs?: unknown };
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (
      !Array.isArray(body.inputs) ||
      body.inputs.length === 0 ||
      !body.inputs.every((t) => typeof t === "string")
    ) {
      return Response.json(
        { error: "inputs must be a non-empty array of strings" },
        { status: 400 },
      );
    }

    const texts = body.inputs as string[];
    // Workers AI returns { shape, data } for embedding models — unwrap data.
    // bge-m3 takes `text` (string | string[]) and pools with CLS internally.
    let result: { shape: number[]; data: number[][] };
    try {
      result = (await env.AI.run(MODEL, { text: texts })) as { shape: number[]; data: number[][] };
    } catch (error) {
      return Response.json(
        { error: `Workers AI embedding failed: ${String(error)}` },
        { status: 502 },
      );
    }
    if (!("data" in result)) {
      return Response.json({ error: "unexpected embedding response" }, { status: 502 });
    }
    const vectors = result.data;

    return Response.json(vectors);
  },
};

/**
 * Reranker route — serves the web-app's HfReranker with zero client changes.
 *
 * The client speaks the Hugging Face Inference API contract:
 *   POST {inputs: [[query, doc], ...], options: {wait_for_model: true}}
 *   → [[{label, score}], ...]  (one row per pair, in input order)
 *
 * Workers AI's only reranker (@cf/baai/bge-reranker-base) speaks a different
 * shape: `{query, contexts}` in, `{result: [{index, score}]}` out (indices in
 * relevance order). This handler translates both ways and returns the HF shape
 * so the app's `extractScores` keeps working unchanged.
 */
async function handleRerank(request: Request, env: Env): Promise<Response> {
  // Token auth — same secret as the embedding route.
  const auth = request.headers.get("Authorization") ?? "";
  if (
    !auth.startsWith("Bearer ") ||
    !timingSafeEqual(auth.slice("Bearer ".length), env.EMBED_TOKEN)
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { inputs?: unknown };
  try {
    body = (await request.json()) as { inputs?: unknown };
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.inputs) || body.inputs.length === 0) {
    return Response.json(
      { error: "inputs must be a non-empty array of [query, document] pairs" },
      { status: 400 },
    );
  }

  const pairs = body.inputs as unknown[];
  let query = "";
  const documents: string[] = [];
  for (const pair of pairs) {
    if (
      !Array.isArray(pair) ||
      pair.length < 2 ||
      typeof pair[0] !== "string" ||
      typeof pair[1] !== "string"
    ) {
      return Response.json(
        { error: "each input must be a [query, document] string pair" },
        { status: 400 },
      );
    }
    if (query === "") {
      query = pair[0] as string;
    }
    documents.push(pair[1] as string);
  }

  // Enforce the model's input contract (≤50 docs, ≤4000 chars each) so a
  // long candidate list degrades gracefully instead of erroring.
  const capped = documents
    .slice(0, RERANK_MAX_DOCS)
    .map((doc) => doc.slice(0, RERANK_MAX_DOC_CHARS));

  let result: { result: Array<{ index: number; score: number }> };
  try {
    // The Workers AI reranker contract is { query, contexts } — `documents`
    // is rejected with a 5006 schema error (the exact failure we hit).
    result = (await env.AI.run(RERANKER_MODEL, {
      query,
      contexts: capped,
    })) as { result: Array<{ index: number; score: number }> };
  } catch (error) {
    // Surface the real Workers AI error — a bare 1101 tells the operator
    // nothing (that was exactly the failure mode being debugged).
    return Response.json(
      { error: `Workers AI reranker failed: ${String(error)}` },
      { status: 502 },
    );
  }
  if (!("result" in result)) {
    return Response.json({ error: "unexpected reranker response" }, { status: 502 });
  }

  // Workers AI returns {index, score} sorted by relevance — map back to input
  // order and wrap each in the HF single-label shape the client parses.
  const scores = new Array<number>(capped.length).fill(0);
  for (const entry of result.result) {
    if (entry.index >= 0 && entry.index < scores.length) {
      scores[entry.index] = entry.score;
    }
  }
  return Response.json(scores.map((score) => [{ label: "RELEVANT", score }]));
}
