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
      inputs: { text: string | string[] },
    ): Promise<{ shape: number[]; data: number[][] }>;
  };
  EMBED_TOKEN: string;
}

const MODEL = "@cf/baai/bge-m3";

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
    } catch {
      // ignore — next scheduled tick retries
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check (unauthenticated — exposes model name only).
    if (request.method === "GET" && url.pathname === "/healthz") {
      return Response.json({ ok: true, model: MODEL });
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
    const result = await env.AI.run(MODEL, { text: texts });
    const vectors = result.data;

    return Response.json(vectors);
  },
};
