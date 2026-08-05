/**
 * Cloudflare Worker — query-time embeddings via Workers AI.
 *
 * Speaks the exact contract of the web-app's HfEmbeddingClient so the TS side
 * needs no custom client: it POSTs to
 * `/pipeline/feature-extraction/{model}` with `{"inputs": [...]}` and expects
 * `number[][]` (768-dim) back. Vercel points `HF_INFERENCE_URL` at this
 * worker's URL for the QUERY side; the CORPUS side embeds via the local
 * sentence-transformers server (same model → same space).
 *
 * Auth: bearer token via `EMBED_TOKEN` secret. Rejects anything without it —
 * otherwise this endpoint is free compute for anyone on the internet.
 */
export interface Env {
  AI: {
    run(model: string, inputs: { texts: string[] }): Promise<number[][]>;
  };
  EMBED_TOKEN: string;
}

const MODEL = "@cf/baai/bge-base-en-v1.5";

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
    if (!auth.startsWith("Bearer ") || !timingSafeEqual(auth.slice("Bearer ".length), env.EMBED_TOKEN)) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body: { inputs?: unknown };
    try {
      body = (await request.json()) as { inputs?: unknown };
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
    if (!Array.isArray(body.inputs) || body.inputs.length === 0 || !body.inputs.every((t) => typeof t === "string")) {
      return Response.json({ error: "inputs must be a non-empty array of strings" }, { status: 400 });
    }

    const texts = body.inputs as string[];
    const vectors = await env.AI.run(MODEL, { texts });

    return Response.json(vectors);
  },
};
