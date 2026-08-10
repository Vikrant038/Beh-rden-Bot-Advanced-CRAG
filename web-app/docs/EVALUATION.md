# CRAG Evaluation Harness (web-app)

The production-quality gate for the **TypeScript** RAG pipeline. It runs a
30-question multilingual testset through the *real* pipeline the chat app
uses — guardrail → bilingual sub-query expansion → hybrid retrieval
(pgvector dense + Postgres FTS sparse → RRF → cross-encoder rerank) → CRAG
confidence gate → grounded LLM generation — and scores every answer on the
same four axes the original Python eval (`tests/eval_ragas_30.py`) measured.

This is the successor to the Python/Streamlit-era eval: it exercises the
pipeline that actually ships, not the MVP.

## What it measures

| Axis | Metric | Gate (default) |
|------|--------|----------------|
| Groundedness / Faithfulness | LLM-as-judge, 1–5 (is every claim in the answer supported by the retrieved context?) | ≥ 3.5 |
| Answer relevance (LLM judge) | 1–5 | ≥ 4.0 |
| Answer relevance (BGE-M3) | cosine between question and answer vectors | ≥ 0.55 |
| Answer relevance (blended) | `0.7 × judge + 0.3 × (1 + 4·cos)` | ≥ 4.0 |
| Context precision | fraction of retrieved chunks with cross-encoder score > 0.5 | ≥ 0.75 |
| Context recall | fraction of `expected_keywords` present in the retrieved chunks | ≥ 0.70 |

Two **trap items** (a butter-chicken-recipe request and a forged-APS request)
score on refusal behavior: a clean `GUARDRAIL_BLOCKED` refusal is 5.0/5.0;
answering is 1.0/1.0. A guardrail false-positive on a legit question is
scored 0 and flagged as `blocked_non_trap`.

The judge sees **the same context the generator saw** (parent-expanded chunk
text), so faithfulness measures the answer against what the pipeline
actually retrieved — not a truncated proxy window.

## Files

- `web-app/scripts/eval-crag-webapp.ts` — the harness (resumable via
  checkpoint, 3× retry with backoff per item, exits non-zero on gate failure
  → CI-ready).
- `web-app/data/eval/crag_30_questions.json` — the 30-question multilingual
  testset (DE/EN, 2 traps).
- `web-app/data/processed/webapp_crag_30_checkpoint.json` — per-item results
  (resume point).
- `web-app/data/processed/webapp_crag_30_results.json` — full report:
  summary + per-item scores, retrieval path, latency, full answers and
  judged context (diagnostics).
- `.github/workflows/eval-web-app.yml` — CI gate.

## Run locally

Prerequisites: Postgres up with the corpus seeded (see
`DEPLOYMENT.md`/`scripts/seed-corpus.sh`), and the API keys in `.env`
(`GROQ_API_KEY`, `HF_TOKEN`, `HF_INFERENCE_URL`, `RERANKER_URL`/`RERANKER_TOKEN`).

```bash
cd web-app
set -a && . ./.env && set +a
pnpm tsx scripts/eval-crag-webapp.ts
```

A run is **resumable**: re-running skips items already in the checkpoint, so
a rate-limited stall never loses completed work. `data/processed/` is
gitignored (regenerable); `data/eval/` is committed.

## CI workflow (`.github/workflows/eval-web-app.yml`)

Runs **weekly (Monday 04:00 UTC)** or **manually** via `workflow_dispatch` —
deliberately *not* on every push, because a run costs ~150 LLM calls plus
embeddings. The per-commit gate stays `ci-web-app.yml`.

Two corpus modes:

- **small** (manual-dispatch default) — fully self-contained. The job boots a
  `pgvector/pgvector:pg16` Postgres, applies migrations, ingests the small
  corpus subset (`web-app/data/ingest-pdfs-small.json`, ~10 official PDFs
  that ship in the repo), then evaluates. Acts as a **smoke/regression run**:
  its quality gates are **informational** (exit 0 as long as the pipeline
  runs end-to-end — the CI subset cannot meet full-corpus thresholds; a
  small-corpus recall of ~20% with precision ~96% is expected because most
  expected keywords simply are not in the subset). Watch the *delta* from the
  previous small-mode run, not the absolute numbers.
- **full** — evaluates against the **production corpus** (the weekly
  scheduled run). Requires the `EVAL_DATABASE_URL` secret: a Postgres URL
  pointing at a seeded copy of the corpus (produce it with
  `web-app/scripts/seed-corpus.sh` — dump the local seeded Postgres, ship
  the vectors, no re-embedding). This mode produces the **authoritative
  quality numbers** and its gates **are enforced** (a gate miss fails the
  run).

## Secrets you must configure

| Secret | Required | Notes |
|--------|----------|-------|
| `GROQ_API_KEY` | ✅ | generation + judge LLM calls |
| `HF_TOKEN` | ✅ | BGE-M3 embeddings + cross-encoder reranker |
| `GROQ_MODEL` | optional | default `llama-3.1-8b-instant` |
| `EMBEDDING_MODEL` | optional | default `BAAI/bge-m3` (must match the corpus space) |
| `HF_INFERENCE_URL` | ✅ | the BGE-M3 feature-extraction endpoint (your deployed Cloudflare embeddings worker, e.g. `https://<worker>.workers.dev`). Required — the HF Inference API default is unreachable from many networks (DNS/geo blocks) and fails every ingest with "Hugging Face API is unreachable". The workflow fails fast if this secret is missing. |
| `RERANKER_MODEL` | optional | default `BAAI/bge-reranker-v2-m3` |
| `EVAL_DATABASE_URL` | full mode only | seeded corpus Postgres URL — see "Setting up full-corpus mode" below |

## Setting up full-corpus mode (`EVAL_DATABASE_URL`)

The weekly schedule evaluates the FULL corpus, so the workflow needs a
Postgres URL the GitHub runner can read that contains the seeded corpus
(documents + parent/child chunks with the 1024-dim bge-m3 vectors). It only
**reads** — the eval never writes to that database.

### 1. Produce the seeded corpus (one-time)

You already have the embedded corpus locally (docker Postgres, produced by
`pnpm ingest`). Ship the vectors to a Postgres the CI can reach — typically
your Neon database:

```bash
cd web-app
docker compose up -d postgres
# Apply migrations on the target first (the script verifies the schema):
pnpm db:deploy   # needs DATABASE_URL pointed at the target, or use psql directly
NEON_DATABASE_URL="postgresql://behoerden_app:...@ep-xxx-pooler.eu-central-1.aws.neon.tech/behoerden_bot?sslmode=require" \
  ./scripts/seed-corpus.sh --replace
```

This dumps `documents` / `document_parent_chunks` / `document_chunks` from
the local docker Postgres and loads them into the target, then ensures the
FTS GIN + pgvector HNSW indexes exist. Run it once after the corpus changes;
re-runs with `--replace` wipe and reload the corpus tables only.

### 2. Add the secret

In GitHub → **Settings → Secrets and variables → Actions → New repository
secret**:

| Secret | Value |
|--------|-------|
| `EVAL_DATABASE_URL` | the same Postgres URL (use Neon's **pooled** connection string — the runner's IP is dynamic; the pooler endpoint avoids IP-allowlist blocks) |

Add it as a **secret** (not a variable) — the workflow reads it via
`secrets.EVAL_DATABASE_URL`.

### 3. Troubleshooting

- **Connection timeout / refused** — Neon IP allowlists block GitHub runner
  IPs. Use the pooled connection URL, or add GitHub's runner ranges, or
  disable the allowlist for this database.
- **"target has no 'documents' table"** — run `pnpm db:deploy` against the
  target first.
- **Migrations missing on the target** — `prisma migrate deploy` must run
  against the target before seeding (the eval expects the current schema,
  including `blockedAt`).

## Gate calibration

The gates in the script (`MIN_*`) are the production targets. The **small**
CI corpus is a subset, so expect variance on recall/precision there — if a
legit pipeline change trips a small-corpus gate while the full-corpus run is
healthy, the gate is calibrated for the full corpus, not the CI subset. The
honest workflow:

1. Run **full** mode for the authoritative scorecard.
2. Treat **small** mode as "did anything break" — a large delta from the
   previous small-mode run is the signal, not the absolute number.

## Troubleshooting

- **"Hugging Face API is unreachable (Network/DNS error)" on every ingest** —
  `HF_INFERENCE_URL` is missing or points at the HF Inference API default,
  which many networks cannot reach. Set the `HF_INFERENCE_URL` secret to your
  Cloudflare embeddings worker URL (`https://<worker>.workers.dev`) — the
  same value `web-app/.env` uses locally. The workflow now fails fast with
  this guidance instead of emitting one cryptic error per PDF.
- **HF cold start > 20 s** — the embed client aborts sockets after 20 s; the
  workflow warms the model first and retries ingest. If CI ingest keeps
  timing out, point `HF_INFERENCE_URL` at a warm endpoint (Cloudflare worker).
- **Groq rate limits (429)** — the harness retries each item 3× with backoff
  (70 s for breaker-open, 15 s otherwise). A stalled item never hangs the
  run (`ITEM_TIMEOUT_MS` caps it) and is checkpointed for resume.
- **Judge context truncation** — the judge window is 8 000 chars
  (`judgeFaithfulnessRelevance`); items whose parent-expanded context exceeds
  that (large multi-entity synthesis questions) may score lower than the
  generator's true grounding. Diagnostic `context_text` is stored per item
  for re-judging.
