import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  NEXTAUTH_URL: z.string().url().default("http://localhost:3000"),
  NEXTAUTH_SECRET: z.string().min(1, "NEXTAUTH_SECRET is required"),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default("llama-3.1-8b-instant"),
  HF_TOKEN: z.string().optional(),
  HF_LLM_MODEL: z.string().default("meta-llama/Llama-3.1-8B-Instruct"),
  RERANKER_MODEL: z.string().default("BAAI/bge-reranker-base"),
  GEMINI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("BAAI/bge-base-en-v1.5"),
  /** Which embed client the app constructs by default: "gemini" or "hf". */
  EMBEDDING_PROVIDER: z.enum(["gemini", "hf"]).default("gemini"),
  HF_INFERENCE_URL: z.string().url().default("https://api-inference.huggingface.co"),
  UPSTASH_REDIS_URL: z.string().optional(),
  UPSTASH_REDIS_TOKEN: z.string().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().url().default("https://cloud.langfuse.com"),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

function loadServerEnv(): z.infer<typeof serverEnvSchema> {
  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid server environment variables: ${missing}`);
  }
  return parsed.data;
}

export const env = loadServerEnv();
