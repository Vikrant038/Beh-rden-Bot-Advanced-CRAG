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

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXTAUTH_URL: z.preprocess(normalizeUrl, z.string().url().default("http://localhost:3000")),
  NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("llama-3.1-8b-instant"),
  HF_TOKEN: z.string().optional(),
  HF_LLM_MODEL: z.string().default("meta-llama/Llama-3.1-8B-Instruct"),
  /** HF Inference API base for the LLM fallback — separate from
   * HF_INFERENCE_URL, which now points at the Cloudflare embeddings worker. */
  HF_LLM_URL: z.preprocess(
    normalizeUrl,
    z.string().url().default("https://api-inference.huggingface.co"),
  ),
  RERANKER_MODEL: z.string().default("BAAI/bge-reranker-v2-m3"),
  /**
   * Cross-encoder endpoint — deliberately SEPARATE from HF_INFERENCE_URL.
   * HF_INFERENCE_URL now points at the Cloudflare embeddings worker, which
   * only serves /pipeline/feature-extraction (it cannot run bge-reranker).
   * The reranker must always target a real text-classification endpoint.
   */
  RERANKER_URL: z.preprocess(
    normalizeUrl,
    z.string().url().default("https://api-inference.huggingface.co"),
  ),
  /** Token for the reranker endpoint; falls back to HF_TOKEN when unset. */
  RERANKER_TOKEN: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("BAAI/bge-m3"),
  /** Which embed client the app constructs by default: "gemini" or "hf".
   * The corpus is embedded with BAAI/bge-base-en-v1.5 (same-space rule), so
   * "hf" is the safe default — queries must use the same model as the corpus.
   * "gemini" is ONLY correct if the corpus was embedded with a Gemini model. */
  EMBEDDING_PROVIDER: z.enum(["gemini", "hf"]).default("hf"),
  HF_INFERENCE_URL: z.preprocess(
    normalizeUrl,
    z.string().url().default("https://api-inference.huggingface.co"),
  ),
  UPSTASH_REDIS_URL: z.string().optional(),
  UPSTASH_REDIS_TOKEN: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_HOST: z.preprocess(normalizeUrl, z.string().url().default("https://cloud.langfuse.com")),
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
