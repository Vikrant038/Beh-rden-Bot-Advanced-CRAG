# Phase I — bge-base Embedding Architecture (Cloudflare + local sentence-transformers)

> **Status:** Built, smoke-tested, tests green. **Corpus re-ingest and worker deploy are the
> remaining manual steps** (both need the user's machine/accounts — see §6).
> **Date:** 2026-08-05

## 1. Decision (ADR-style)

| Option | Verdict | Why rejected/chosen |
|---|---|---|
| **Gemini (previous default)** | Rejected for the corpus pass | Free-tier daily quota paces a ~3,000-request corpus seed over **~10–12 days**; fine for query-time (1 embed/query) but painful for a one-time bulk load. |
| **Ollama (local, nomic-embed-text)** | Rejected | Requires a **self-hosted endpoint reachable from Vercel** — an always-on VM/box to babysit. |
| **Cloudflare Workers AI — bge-base** | ✅ **Chosen** | `@cf/baai/bge-base-en-v1.5` is 768-dim (fits `vector(768)` with zero migration), served by a tiny token-auth'd Worker, **$0** (10k neurons/day free ≈ millions of query embeds). Same `BAAI/bge-base-en-v1.5` weights as the local corpus embed → **same vector space**. |

### Why "same model on both sides" is non-negotiable

pgvector cosine retrieval compares corpus vectors against query vectors. Every embedding
model maps text into its **own vector space** — same dimensionality ≠ same space. Corpus in
bge-base space + queries in Gemini space returns **garbage answers with no error**. The
`createDefaultEmbeddingClient()` factory (`EMBEDDING_PROVIDER=gemini|hf`) forces one choice
used by **both** the ingest pipeline and the query retriever.

### BGE prefix rule (asymmetric model)

- **Corpus side:** chunk text embedded as-is, **no prefix**.
- **Query side:** `HfEmbeddingClient.embedQuery` prepends `QUERY_EMBEDDING_PREFIX`
  (`"Represent this sentence for searching relevant passages: "`). Getting this backwards
  silently degrades retrieval.

### Fine-tuned model note

The repo's fine-tuned BGE (`bge_base_german_visa`, +21.92% MRR@10) **cannot run on
Cloudflare** — LoRA adapters are text-generation (Llama/Mistral/Gemma) only, and ~400 MB
ONNX weights exceed Worker asset limits. Production use would require a VM +
text-embeddings-inference **and a full corpus re-embed** with that model. The web-app
doesn't use it today; revisit only if retrieval quality demands it.

## 2. What was built

| Piece | Path | Purpose |
|---|---|---|
| Provider switch | `src/server/env.ts` (`EMBEDDING_PROVIDER`), `src/server/embeddings/client.ts` (`createDefaultEmbeddingClient()`) | One env decision selects the embed client for ingest **and** queries |
| Wiring | `src/server/ingest/pipeline.ts`, `src/server/rag/instance.ts` | Replace hardcoded `new GeminiEmbeddingClient()` with the factory |
| Local corpus embed server | `mvp-python/scripts/embed-server.py` | FastAPI + sentence-transformers `BAAI/bge-base-en-v1.5` on MPS; speaks the exact `HfEmbeddingClient` contract (`/pipeline/feature-extraction/{model}` → `number[][]`) so **zero ingest-code changes** |
| Cloudflare query worker | `embeddings-worker/` (wrangler.toml + src/index.ts + README) | Same contract; Workers AI `@cf/baai/bge-base-en-v1.5`; bearer-token auth with constant-time compare |
| Neon seed script | `scripts/seed-corpus.sh` (existing, verified) | Ships the embedded corpus to Neon without re-embedding |
| Docs | `.env.example`, `docs/DEPLOYMENT.md` §3/§4/§7/§8 | Env vars + provider decision + go-live checklist |

## 3. Verification performed

- **Smoke test (local, end-to-end):** Schengen visa form PDF ingested through
  `embed-server.py` → **1 document, 138 chunks, all 768-dim, unit norms 1.000**
  (client normalizes; matches what pgvector cosine expects).
- **Full suite:** 407/407 unit tests, coverage **85.62% lines / 82.43% funcs** (thresholds
  80%), 23/23 Playwright e2e specs, typecheck green, lint 0 errors, Prettier clean.
- **Unit coverage added:** embeddings-client tests for the provider factory + HF contract;
  rag-instance mock updated for the factory.

## 4. Corpus state

The old Gemini-embedded corpus was **wiped** from local docker Postgres
(698 chunks / 69 parents / 33 docs → **0/0/0**; semantic cache cleared — it was
embedding-derived and stale in the new space). `ingest_jobs` is untouched (no FK to
documents). The corpus is ready for a clean bge-base re-ingest.

## 5. Still to do (manual, needs your machine/accounts)

1. **Re-ingest the full corpus through the local server** (~30–60 min, $0):
   ```bash
   cd "/Users/vikranty/Documents/Project/OLD Lap Work/Repo-2"
   .venv/bin/python mvp-python/scripts/embed-server.py --port 8765   # terminal 1

   cd "/Users/vikranty/Documents/Project/OLD Lap Work/Repo-2/web-app"
   export EMBEDDING_PROVIDER=hf
   export HF_INFERENCE_URL=http://127.0.0.1:8765
   export HF_TOKEN=local
   pnpm ingest --file data/sources.json --force
   ```
2. **Deploy the Cloudflare worker** (query side):
   ```bash
   cd web-app/embeddings-worker
   npx wrangler login
   npx wrangler secret put EMBED_TOKEN      # long random string
   npx wrangler deploy                      # prints the worker URL
   ```
3. **Seed Neon** once the corpus pass finishes:
   ```bash
   cd web-app
   NEON_DATABASE_URL="postgresql://behoerden_app:...@ep-xxx-pooler....neon.tech/behoerden_bot?sslmode=require" \
     ./scripts/seed-corpus.sh --replace
   ```
4. **Production env (Vercel):** `EMBEDDING_PROVIDER=hf`,
   `HF_INFERENCE_URL=https://<worker>.workers.dev`, `HF_TOKEN=<same EMBED_TOKEN>`,
   `EMBEDDING_MODEL=BAAI/bge-base-en-v1.5`.

URL sources behind bot protection will fail as `failed` — that's scraping, not the
pipeline; the 43 PDFs are the substantive corpus.

## 6. Risk / notes

- **Migrating providers later** (e.g. to the fine-tuned model) means switching **both**
  sides at the same instant **and** re-embedding + re-seeding the corpus — never just one
  side.
- The Cloudflare free-tier neuron budget covers roughly **16M query tokens/day** — no
  realistic limit for query-time embedding.
- Worker deploy and corpus re-ingest are outside the committed code; this doc is the
  handoff for those steps.
