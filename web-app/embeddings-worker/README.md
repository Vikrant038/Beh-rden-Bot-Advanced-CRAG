# beheorden-embeddings — Cloudflare Worker (query-time embedding)

Serves `@cf/baai/bge-base-en-v1.5` embeddings (768-dim) for the web-app's
query side. The **corpus** is embedded locally with the same model
(`web-app/scripts/embed-server.py` + sentence-transformers), so both sides
live in the same vector space — required for pgvector cosine retrieval.

> **Pooling must match the corpus.** The local model's `1_Pooling` config uses
> `pooling_mode_cls_token: true` (CLS). Cloudflare's default is `mean`, and
> the two are **not** compatible — so this worker passes `pooling: "cls"`
> explicitly. If you ever re-embed the corpus with a different pooling,
> change it here too and re-seed.

## Deploy (one-time)

```bash
cd web-app/embeddings-worker
npx wrangler login                      # opens browser; authorizes the CLI
npx wrangler secret put EMBED_TOKEN     # pick a long random string
npx wrangler deploy                     # prints the worker URL
```

## Wire the web-app to it (production)

Point the query side at the worker. In Vercel env vars:

| Var | Value |
|---|---|
| `EMBEDDING_PROVIDER` | `hf` (use the HTTP contract, not Gemini) |
| `HF_INFERENCE_URL` | `https://<your-worker-subdomain>.workers.dev` |
| `HF_TOKEN` | the same `EMBED_TOKEN` value |
| `EMBEDDING_MODEL` | `BAAI/bge-base-en-v1.5` (default already) |

Both sides now use bge-base → corpus (local server) and queries (worker) are
the same space. Do **not** set `EMBEDDING_PROVIDER=gemini` while the corpus is
bge-base — mixing spaces silently breaks retrieval.

## Test locally before deploy

```bash
# start the local sentence-transformers server (corpus-side embed)
cd /Users/vikranty/Documents/Project/OLD\ Lap\ Work/Repo-2
.venv/bin/python web-app/scripts/embed-server.py --port 8765

# in another terminal, embed one text through the HF contract
curl -s http://127.0.0.1:8765/pipeline/feature-extraction/BAAI/bge-base-en-v1.5 \
  -H 'Content-Type: application/json' \
  -d '{"inputs": ["student visa Germany"]}'
# → [[...768 floats...]]
```
