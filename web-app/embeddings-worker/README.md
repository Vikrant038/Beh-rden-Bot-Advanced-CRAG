# beheorden-embeddings — Cloudflare Worker (query-time embedding + rerank)

Serves **two** models for the web-app via Workers AI:

- **Embedding:** `@cf/baai/bge-m3` — 1024-dim, multilingual (covers the German corpus).
- **Reranker:** `@cf/baai/bge-reranker-base` — Workers AI's only cross-encoder, used by the
  hybrid-retrieval rerank stage.

Both are token-auth'd (`EMBED_TOKEN`), so the endpoint is not free compute for anyone on the
internet. The web-app points `HF_INFERENCE_URL` at this worker for the **query side**; the
**corpus** is seeded into Neon (see `docs/DEPLOYMENT.md` §3) with the same `BAAI/bge-m3`
weights, so query and corpus vectors share one vector space — the non-negotiable rule for
pgvector cosine retrieval.

## Routes

| Method + path | Purpose | Auth |
|---|---|---|
| `GET /healthz` | Health + model names (`{ model, reranker }`) | none |
| `POST /pipeline/feature-extraction/{model}` | Embed `{ "inputs": [strings] }` → `number[][]` (1024-dim) | `Bearer EMBED_TOKEN` |
| `POST /pipeline/text-classification/bge-reranker-base` | Rerank `{ "inputs": [[query, doc], …] }` → `[[{ label, score }], …]` | `Bearer EMBED_TOKEN` |

The worker speaks the exact Hugging Face Inference API contract the web-app's
`HfEmbeddingClient` / `HfReranker` already parse, so no client changes are needed.

## Deploy (one-time)

```bash
cd web-app/embeddings-worker
npx wrangler login                      # opens browser; authorizes the CLI
npx wrangler secret put EMBED_TOKEN     # pick a long random string
npx wrangler deploy                     # prints the worker URL
```

A scheduled keep-warm cron re-runs both models every 5 minutes so real queries don't pay the
10–20s Workers AI cold start.

## Wire the web-app to it (production)

In Vercel env vars:

| Var | Value |
|---|---|
| `EMBEDDING_PROVIDER` | `hf` (use the HTTP contract, not Gemini) |
| `HF_INFERENCE_URL` | `https://<your-worker-subdomain>.workers.dev` |
| `HF_TOKEN` | the same `EMBED_TOKEN` value |
| `EMBEDDING_MODEL` | `@cf/baai/bge-m3` (worker's model; drives the feature-extraction path) |

The reranker inherits the same endpoint/token: `RERANKER_URL` / `RERANKER_TOKEN` fall back to
`HF_INFERENCE_URL` / `HF_TOKEN` when unset. Do **not** set `EMBEDDING_PROVIDER=gemini` while
the corpus is bge-m3 — mixing spaces silently breaks retrieval.

## Test locally before deploy

```bash
# embed one text through the HF contract
curl -s https://<your-worker-subdomain>.workers.dev/pipeline/feature-extraction/@cf/baai/bge-m3 \
  -H "Authorization: Bearer $EMBED_TOKEN" -H 'Content-Type: application/json' \
  -d '{"inputs": ["student visa Germany"]}'
# → [[...1024 floats...]]

# rerank query/document pairs
curl -s https://<your-worker-subdomain>.workers.dev/pipeline/text-classification/bge-reranker-base \
  -H "Authorization: Bearer $EMBED_TOKEN" -H 'Content-Type: application/json' \
  -d '{"inputs":[["blocked account visa","A blocked account is required."],["blocked account visa","Health insurance is optional."]]}'
# → [[{label:"RELEVANT",score:...}], [{...}]]
```