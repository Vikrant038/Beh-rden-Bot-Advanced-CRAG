import { z } from "zod";

/**
 * Normalizes an env URL before zod validation. Platform dashboards (Vercel)
 * store unset vars as "" and users sometimes paste a bare host without a
 * scheme ("my-app.vercel.app" instead of "https://..."). Both would otherwise
 * fail `z.string().url()` and crash `next build` with "Invalid server
 * environment variables". Returns undefined when the value is unusable so
 * `.default()` applies.
 */
export function normalizeUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    // Strip trailing slash so auth/redirect logic never double-slashes.
    return parsed.origin + parsed.pathname.replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/** URL env var with normalization + default. */
const url = (def: string) => z.preprocess(normalizeUrl, z.string().url().default(def));

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXTAUTH_URL: url("http://localhost:3000"),
  NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
  HF_TOKEN: z.string().optional(),
  /** Bearer token for the Cloudflare embeddings/reranker worker
   * (its EMBED_TOKEN secret). Falls back to HF_TOKEN for backward compat. */
  EMBED_TOKEN: z.string().optional(),
  HF_LLM_MODEL: z.string().default("meta-llama/Llama-3.1-8B-Instruct"),
  /** HF Inference API base for the LLM fallback — separate from
   * HF_INFERENCE_URL, which now points at the Cloudflare embeddings worker. */
  HF_LLM_URL: url("https://api-inference.huggingface.co"),
  RERANKER_MODEL: z.string().default("@cf/baai/bge-reranker-base"),
  /**
   * Cross-encoder endpoint. The Cloudflare worker (behoerden-embeddings)
   * serves BOTH /pipeline/feature-extraction (bge-m3) AND
   * /pipeline/text-classification (bge-reranker-base) behind one token, so
   * RERANKER_URL defaults to HF_INFERENCE_URL — one URL, one token, zero
   * Hugging Face dependency. An explicit RERANKER_URL pointing elsewhere
   * (e.g. a different provider) still wins when set.
   */
  RERANKER_URL: z.preprocess((val) => {
    // Treat the legacy HF default as "unset" — it is unreachable from Vercel
    // and CI and was the cause of the silent [RERANK] fallback in prod.
    const unset = val === undefined || val === "" || val === "https://api-inference.huggingface.co";
    const raw = unset
      ? (process.env.HF_INFERENCE_URL ?? "https://api-inference.huggingface.co")
      : val;
    return normalizeUrl(raw);
  }, z.string().url()),
  /** Token for the reranker endpoint; falls back to EMBED_TOKEN, then
   * HF_TOKEN when unset. */
  RERANKER_TOKEN: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("BAAI/bge-m3"),
  /** Which embed client the app constructs by default: "gemini" or "hf".
   * The corpus is embedded with BAAI/bge-base-en-v1.5 (same-space rule), so
   * "hf" is the safe default — queries must use the same model as the corpus.
   * "gemini" is ONLY correct if the corpus was embedded with a Gemini model. */
  EMBEDDING_PROVIDER: z.enum(["gemini", "hf"]).default("hf"),
  HF_INFERENCE_URL: url("https://api-inference.huggingface.co"),
  UPSTASH_REDIS_URL: z.string().optional(),
  UPSTASH_REDIS_TOKEN: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_HOST: url("https://cloud.langfuse.com"),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

function loadServerEnv(): z.infer<typeof serverEnvSchema> {
  /**
   * Platform dashboards (Vercel/Neon) often store "empty" vars as "".
   * Treat an empty string exactly like an unset var so `.default()` values
   * apply — otherwise `z.string().url().default(...)` rejects "" with an
   * "Invalid server environment variables" build error.
   */
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    env[key] = typeof value === "string" && value.trim() === "" ? undefined : value;
  }
  const parsed = serverEnvSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid server environment variables: ${missing}`);
  }
  return parsed.data;
}

export const env = loadServerEnv();
