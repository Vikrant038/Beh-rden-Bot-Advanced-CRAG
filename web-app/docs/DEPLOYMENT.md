# Deployment Runbook — Behörden-Bot Web App (Free Tier)

> **Goal:** get `web-app/` live so anyone can use it, for **$0/month** in hosting (only the
> domain costs ~$10/yr). Everything below is verified against the current codebase
> (`src/server/env.ts`, `prisma/schema.prisma`, `.github/workflows/deploy-web-app.yml`,
> `vercel.json`, `src/app/layout.tsx`).

---

## 0. The stack (all free)

| Layer | Pick | Why (vs alternatives) |
|---|---|---|
| **Hosting** | **Vercel Hobby** | Next.js is a first-class citizen; `vercel.json` cron + deploy workflow already exist; 100 GB/mo bandwidth, 1M function invocations/mo, custom domains free. |
| **Database** | **Neon Postgres (free)** | Postgres **with `pgvector`** — the schema REQUIRES it (`vector(1024)` + HNSW indexes). 0.5 GB storage, scale-to-zero, **never pauses**. Supabase free (500 MB) also works but **pauses after 1 week inactivity** — bad for a public site. Aiven free (1 GB, pgvector) is a third option. |
| **LLM** | **Google AI Studio (Gemini)** | `GEMINI_API_KEY` is the only *required* LLM key (`env.ts`). Free tier is generous. |
| **LLM (primary)** | **Groq** | `GROQ_API_KEY` free tier (14.4k req/day) powers the default `llama-3.1-8b-instant`. |
| **LLM (fallback)** | **Hugging Face** | `HF_TOKEN` optional; used for reranking/embeddings fallback. |
| **Embeddings** | **Cloudflare Workers AI** | `@cf/baai/bge-m3` (1024-dim, multilingual) served by a tiny Worker (`embeddings-worker/`) — $0, serverless, same weights as the local corpus embed (§3). |
| **File storage** | **None needed yet** | PDF uploads are parsed **in-memory** (4 MiB cap, `ingestPdf`) and stored as chunks in Postgres. Add **Cloudflare R2** (10 GB free, $0 egress) later if you keep raw files. |
| **Domain** | **Cloudflare Registrar / Porkbun** | ~$10/yr at cost. Free interim: `<project>.vercel.app`. |
| **Auth** | GitHub + Google OAuth | Free developer accounts. Email magic-link (Resend) optional. |
| **Monitoring** | Langfuse (free cloud) | Optional tracing; `LANGFUSE_*` env vars already supported. |

**Storage budget (0.5 GB Neon free):** a 1024-dim vector ≈ 4 KB/row plus HNSW index overhead
(≈ 10 KB/chunk end-to-end). Run the estimator for your own numbers:

```bash
pnpm storage:estimate                        # defaults: 1K users, 40K chunks, cache TTL 7d
pnpm storage:estimate --users 5000 --chunks 60000 --cache-ttl-days 14
```

Headline results from the model (1K users · 5 convs/user · 10 msgs/conv · 40K chunks):

| Layer | Size | % of 512 MB free tier |
|---|---|---|
| Chunks (corpus) — the constant baseline | ≈ 343 MB | 67% |
| Messages | ≈ 119 MB | 23% |
| Semantic cache (7-day TTL) | ≈ 75 MB | 15% |
| Conversations + summaries | ≈ 11 MB | 2% |
| **Total (incl. 25% PG overhead)** | **≈ 685 MB** | **134% ⚠** |

The corpus dominates at small scale; **Messages** overtakes it at ~2.9K users and the
**semantic cache** at ~4.6K users. With the default 40K-chunk corpus, total storage exceeds
the 512 MB free tier at ~324 users — so keep the chunk count lean for a public starter app
(trim sources, raise the cache-TTL-to-size tradeoff), watch the Neon dashboard, and treat
Neon paid (pay-as-you-grow) as the scaling path rather than a launch blocker.

---

## 1. Accounts to create (10–15 min each)

1. **Vercel** — `vercel.com` → *Continue with GitHub*.
2. **Neon** — `neon.tech` → GitHub sign-in → **New project** (region closest to your users;
   pick EU/APAC as needed). Note the free project's connection string (shown once; copy it).
3. **Google AI Studio** — `aistudio.google.com` → *Get API key* → create key.
4. **Groq** — `console.groq.com` → API key (free).
5. **Hugging Face** — `huggingface.co` → Access Token (free, `read` scope enough).
6. **GitHub OAuth app** — Settings → Developer settings → OAuth Apps → *New OAuth App*:
   - Homepage URL: `https://<your-domain>` (or your Vercel URL while testing)
   - Authorization callback URL: `https://<your-domain>/api/auth/callback/github`
7. **Google OAuth app** — Google Cloud Console → APIs & Services → Credentials → *OAuth
   client ID* (Web application):
   - Authorized redirect URIs: `https://<your-domain>/api/auth/callback/google`
8. *(Optional)* **Resend** — for email magic links (`RESEND_API_KEY` + `EMAIL_FROM`).

---

## 2. Database setup (Neon)

```bash
# From repo root (web-app/)
cd web-app
# 1. Point Prisma at the Neon DB once, then push all migrations + extension + indexes:
DATABASE_URL="postgresql://USER:PASSWORD@ep-xxx.REGION.aws.neon.tech/neondb?sslmode=require" \
pnpm prisma migrate deploy
# (migrations include CREATE EXTENSION IF NOT EXISTS "vector" + HNSW indexes — already in repo)
```

The app runtime uses `DATABASE_URL` only; migrations use `MIGRATION_DATABASE_URL` (same
value is fine on Neon free).

**Migrations are now applied automatically**: the `Database Migrate` GitHub workflow runs
`prisma migrate deploy` on every push to `main` that touches `web-app/prisma/**` (plus manual
dispatch), using the `MIGRATION_DATABASE_URL` **repository secret** (Settings → Secrets and
variables → Actions → New repository secret). Add that secret once — the same Neon pooled
connection string Vercel uses for production. The manual command above is only needed for the
initial database setup or ad-hoc runs; additive migrations (nullable columns, `CREATE INDEX
IF NOT EXISTS`) are safe to apply while the app is live.

---

## 3. Production embedding architecture (seeded corpus, not re-embed)

> The single most important deployment fact: **production never bulk-embeds the corpus.**
> The vectors (1024-dim bge-m3, pgvector) live in Postgres tables — `documents`,
> `document_parent_chunks`, `document_chunks`, `semantic_cache`. You embed the corpus
> **once, offline**, ship the rows to Neon, and at runtime Vercel only embeds 1 query
> vector per chat message + a handful per incremental admin add.

### 3.1 Three phases, three embed loads

| Phase | Embed load | Runs where | Free-tier reality |
|---|---|---|---|
| **Corpus seed (one-time)** | ~3,000+ requests (full 143-source corpus; the Residence Act alone ≈ 40 batched calls) | **Anywhere offline** — local docker, a dev box, spread over days on a free key, or one Ollama pass | The only heavy lift; happens before go-live, never again |
| **User query (chat)** | **1 embed per query** | Vercel function | Trivial — years of free-tier quota at real usage |
| **Incremental admin adds** | Tens of requests per document | Vercel cron drain (resumable ingest queue) | Fits daily caps; big PDFs span multiple ticks |

### 3.2 Seed the corpus into Neon (one-time)

Once migrations are applied on Neon (§2), transfer the vectors with
`web-app/scripts/seed-corpus.sh` — **no re-embedding**. The corpus is embedded
locally with `BAAI/bge-m3` (1024-dim, multilingual) via `mvp-python/scripts/embed-server.py`,
so both sides share the bge-m3 space:

```bash
cd web-app
NEON_DATABASE_URL="postgresql://behoerden_app:...@ep-xxx-pooler.eu-central-1.aws.neon.tech/behoerden_bot?sslmode=require" \
  ./scripts/seed-corpus.sh --replace
```

- Dumps `documents` → `document_parent_chunks` → `document_chunks` (FK order) from the
  local docker Postgres via the container's own `pg_dump`/`psql`; `--include-cache` also
  ships `semantic_cache` (and bumps its id sequence).
- **Deliberately excludes** auth, sessions, conversations, messages, `ingest_jobs` — prod
  keeps its own.
- Handles the `document_chunks.id` + `document_parent_chunks.id` sequences: `pg_dump
  --data-only` emits `setval` calls, and `--include-cache` bumps `semantic_cache_id_seq`
  after loading.
- **Recreates the FTS GIN index** (`document_chunks_text_fts_idx`, migration
  `20260806000001`) on the target as step 5/6: the dump is data-only, so a fresh seed
  needs the index re-created for the Postgres sparse-search path
  (`vectorQueries.sparseSearch`) to work. Guarded with a `pg_indexes` check inside a
  `DO` block — plain `CREATE INDEX IF NOT EXISTS` would error when the target role is
  not the table owner, even when the index already exists.
- Safety gates: aborts if the target already has corpus rows unless `--replace` is given;
  connection strings are redacted from all output; counts are verified local → target and
  a mismatch fails the run.
- Re-running with `--replace` is always safe (wipe + reload) when the corpus changes.

### 3.3 Query-time embedding (1 per query)

Each chat query embeds once (a single request) to search the seeded vectors — the only embed
Vercel does at runtime, a handful of requests/day at real usage. With
`EMBEDDING_PROVIDER=hf`, the `HfEmbeddingClient` POSTs the query (prefixed per §3.5) to
`HF_INFERENCE_URL` — the deployed Cloudflare embeddings worker (`embeddings-worker/`) —
which runs `@cf/baai/bge-m3` via Workers AI and returns the 1024-dim vector.

### 3.4 Incremental adds (admin → ingest queue → on-demand drain)

Documents added via the admin UI are **enqueued** as `ingest_jobs`, then drained serially
(concurrency 1, embedding-rate-limit friendly). The queue is **resumable**: a per-job
progress cursor + mid-tick time-budget check lets a large PDF finish across several drain
ticks instead of dying on Vercel's 60 s serverless cap. Design:
`docs/status/phase-h-resumable-ingest.md` + `../../docs/status/adr-resumable-ingest-queue.md`.

**How the drain is triggered on the free plan:** Vercel Hobby permits **daily** crons
only — a `*/5 * * * *` entry in `vercel.json` **fails the deployment build** with
*"Hobby accounts are limited to daily cron jobs"*. So `vercel.json` registers only
`/api/cron/cleanup-cache` (daily 4 am), and the ingest queue is drained **on demand** by
the admin UI's own 2.5 s poll loop: `document.jobGet` / `document.jobStats` call
`drainPendingJobs()` (a bounded `processIngestJobs` tick, max 3 jobs / 20 s) on every
poll while the admin watches progress. Uploads and sync-all therefore process in the
background exactly as with a cron — the timer is just replaced by the poll that is
already open. `drainPendingJobs()` no-ops on an empty queue (one cheap count query).

> **Pro option (optional):** with Vercel Pro you can re-add the `*/5 * * * *`
> `process-ingest-jobs` cron to `vercel.json` — the route already exists and wraps the
> same worker. It is deliberately absent from the Hobby config.

### 3.5 Provider decision

The schema pins `vector(1024)`, the bge-m3 space (migrated from 768-dim bge-base in
`20260805000002_bge_m3_1024_dim` — the English-only bge-base scored the German corpus
poorly and forced CRAG web-search fallbacks). Options that fit:

| Option | Dim | Fits schema | Runs on Vercel? | Notes |
|---|---|---|---|---|
| **Cloudflare Workers AI (chosen)** | `@cf/baai/bge-m3` = 1024 | ✅ | ✅ via a tiny Worker (`embeddings-worker/`) | $0 (10k neurons/day free ≈ millions of query embeds). Multilingual — covers the German corpus. Same bge-m3 weights as the local corpus embed → same vector space. Token-auth'd endpoint. |
| **Gemini** | 768 (client sets `outputDimensionality: 768`) | ❌ different space | ✅ natively | Works, but its vectors live in Gemini's 768-dim space — incompatible with the bge-m3 corpus without a full re-embed. |
| **HF Inference** | 1024 (bge-m3) | ✅ | ✅ (Vercel's network is fine; the local HTTP-000 block was machine-specific) | 30k req/month ceiling — workable, but Cloudflare's free tier is higher on the same model. |
| **Ollama (local)** | bge-m3 = 1024 | ✅ | ❌ needs a **self-hosted endpoint reachable from Vercel** (small VM/Railway/Fly) | $0/unlimited, best quality, but an always-on box to babysit. |

**Decision: Cloudflare bge-m3 — the same model on both sides.** The corpus is embedded
locally with `BAAI/bge-m3` via `mvp-python/scripts/embed-server.py` (FastAPI +
sentence-transformers, MPS GPU), and queries are embedded on Vercel by the deployed worker
running the same weights. Same model = same vector space — the non-negotiable rule for
pgvector cosine retrieval (a mix, e.g. Ollama corpus + Gemini queries, returns garbage
with no error).

Two sides, two prefixes (BGE is asymmetric):

- **Corpus side (embed-server):** chunk text embedded **as-is, no prefix**.
- **Query side (client):** `HfEmbeddingClient.embedQuery` prepends
  `QUERY_EMBEDDING_PREFIX` — `"Represent this sentence for searching relevant passages: "`.
  Getting this backwards silently degrades retrieval.

**Pooling:** bge-m3 pools internally (CLS) and takes no `pooling` parameter — the worker
passes only `{ text }`, and the local server pools the same way, so both sides agree with
no extra config. (For bge-base this was a real trap: Cloudflare defaulted to `mean` while
the local model was CLS — the worker passed `pooling: "cls"` explicitly. bge-m3 removes
that footgun.) If you ever change the model on one side, change it on the other **and
re-seed** (`--replace`).

Wiring (Vercel env): `EMBEDDING_PROVIDER=hf`,
`HF_INFERENCE_URL=https://<worker>.workers.dev`, `HF_TOKEN=<worker EMBED_TOKEN>`,
`EMBEDDING_MODEL=BAAI/bge-m3`. The worker itself is token-auth'd
(constant-time compare) — an open `/pipeline/feature-extraction` would be free compute for
anyone on the internet.

> **Fine-tuned model note:** the repo's fine-tuned BGE (`bge_base_german_visa`, +21.92%
> MRR@10) **cannot run on Cloudflare** — LoRA adapters are text-generation
> (Llama/Mistral/Gemma) only, and the ~400 MB ONNX weights exceed Worker asset limits.
> Serving it in production means a VM + text-embeddings-inference, and the corpus must be
> re-embedded with that model (same-space rule again). The web-app doesn't use the
> fine-tuned model today; revisit only if retrieval quality demands it.

---

## 4. Vercel project + environment variables

**Option A (recommended — the repo workflow already deploys via GitHub Actions):**

1. In Vercel: **Add New → Project → import this GitHub repo**, framework preset *Next.js*,
   root directory **`web-app`**. Let it run one build.
2. In the project → **Settings → Environment Variables**, add **every** key below.
3. Set the three workflow secrets in GitHub (repo → Settings → Secrets and variables →
   Actions): `VERCEL_TOKEN` (Vercel → Account → Settings → Tokens, `vercel` scope),
   `VERCEL_ORG_ID` (Account settings → ID), `VERCEL_PROJECT_ID` (Vercel project → Settings →
   General → Project ID). The existing `deploy-web-app.yml` then deploys on push to
   `main`/`web-app`.

**Option B:** `vercel link` + `vercel env add` per key (also fine, manual deploys).

### Required env vars (production values)

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon connection string (`?sslmode=require`) |
| `MIGRATION_DATABASE_URL` | Same Neon string |
| `NEXTAUTH_URL` | `https://<your-domain>` (must match OAuth callback host) |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `EMBEDDING_PROVIDER` | `gemini` (default) or `hf`. **Set `hf` for the Cloudflare path.** |
| `HF_INFERENCE_URL` | Cloudflare worker URL, e.g. `https://embed-worker.<you>.workers.dev` |
| `HF_TOKEN` | The worker's `EMBED_TOKEN` secret (set via `wrangler secret put`) |
| `EMBEDDING_MODEL` | `BAAI/bge-base-en-v1.5` (default; must match the worker's model) |
| `GEMINI_API_KEY` | Google AI Studio key — only needed while `EMBEDDING_PROVIDER=gemini` |
| `CRON_SECRET` | Random string; matches the `/api/cron/cleanup-cache` guard |

### Optional env vars (fill as you create accounts)

`GROQ_API_KEY` (+ `GROQ_MODEL`), `HF_TOKEN`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`,
`UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN` (rate limiting), `LANGFUSE_PUBLIC_KEY`,
`LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`.

> ⚠️ `src/app/layout.tsx` hardcodes `APP_URL = "https://behoerden-bot.vercel.app"` for
> `metadataBase`/OG. **Update it to your real domain** before the SEO step or social links
> will point at the wrong site.

---

## 5. Custom domain (≈$10/yr, optional but recommended)

1. **Buy** at Cloudflare Registrar (`dash.cloudflare.com`) or Porkbun — `.com` ≈ $10/yr;
   `.in`/`.de` are cheaper if your audience is Indian students in Germany.
2. **Point DNS at Vercel** (Vercel → project → Settings → Domains → add domain):
   - Apex: `A` record → `76.76.21.21`
   - `www`: `CNAME` → `cname.vercel-dns.com`
   - Or simplest: use Vercel's nameservers.
3. Vercel issues an auto-renewing TLS cert. Keep `<project>.vercel.app` live as a fallback.
4. **Update `NEXTAUTH_URL`** to the custom domain and re-add the OAuth callback URLs.

---

## 6. Google listing (Search Console + indexing)

1. **sitemap + robots** — add `src/app/sitemap.ts` and `src/app/robots.ts`
   (App Router conventions; base URL = your domain). Rebuild & deploy.
2. **Google Search Console** (`search.google.com/search-console`) → **Add property** →
   *Domain* → paste `https://yourdomain.com`.
3. **Verify ownership** with a DNS TXT record at your registrar (Cloudflare makes this a
   one-click add). For a Google OAuth-enabled app this also proves domain ownership for OAuth.
4. **Submit the sitemap** → `https://yourdomain.com/sitemap.xml` under *Sitemaps*.
5. **Request indexing** for `/` (landing is public — the app pages behind auth won't index,
   which is fine/expected).
6. *(Later)* Performance report in Search Console informs Core Web Vitals work; your meta/OG
   tags are already in `layout.tsx`.

---

## 7. Go-live checklist (final pass)

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green locally
- [ ] `pnpm prisma migrate deploy` ran against Neon (extension `vector` created)
- [ ] **Corpus seeded**: `NEON_DATABASE_URL=… ./scripts/seed-corpus.sh --replace` verified (counts OK, no re-embed)
- [ ] **Cloudflare worker deployed**: `wrangler secret put EMBED_TOKEN` + `wrangler deploy` (§3.5); `EMBEDDING_PROVIDER=hf` + `HF_INFERENCE_URL`/`HF_TOKEN` set in Vercel
- [ ] All required env vars set in Vercel; `NEXTAUTH_SECRET` generated
- [ ] GitHub OAuth + Google OAuth callback URLs point at the production host
- [ ] Cron plan: `cleanup-cache` (daily) is the only cron in `vercel.json` — Hobby-legal; ingest drains on-demand via the admin poll loop (`drainPendingJobs`), `CRON_SECRET` set
- [ ] Custom domain + TLS live; `metadataBase`/`APP_URL` updated
- [ ] Sitemap + robots deployed; Search Console verified + sitemap submitted
- [ ] Test guest mode → sign in → **data claim** (guest conversations appear under the account)
- [ ] Test admin document ingest (URL + PDF), source browser, history export
- [ ] `npm` `pnpm`/Docker/`docker-compose.yml` only for the **Python RAG repo** — not needed for `web-app/`

## 8. Cost summary

| Item | Cost |
|---|---|
| Vercel Hobby | $0 |
| Neon Postgres free | $0 |
| Gemini / Groq / HF / Cloudflare Workers AI / GitHub / Google / Resend | $0 |
| Domain | ~$10/year |
| **Total** | **~$10/year** (or $0 while using the `.vercel.app` subdomain) |

> Vercel **Pro ($20/mo)** is only needed if you want the timer-based 5-minute ingest
> cron (§3.4). On Hobby the ingest queue drains on-demand through the admin poll loop,
> so runtime cost stays $0 either way.

## 9. Later upgrades (when traffic grows)

- Bump Neon to paid for PITR backups + more storage; add R2 for raw PDF storage.
- Add `@vercel/analytics` + Langfuse dashboards; enable preview deployments for PRs.
- Move semantic cache / rate limiting to Upstash Redis when the Postgres cache table grows.
