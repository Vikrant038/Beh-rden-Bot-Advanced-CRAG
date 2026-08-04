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
| **Database** | **Neon Postgres (free)** | Postgres **with `pgvector`** — the schema REQUIRES it (`vector(768)` + HNSW indexes). 0.5 GB storage, scale-to-zero, **never pauses**. Supabase free (500 MB) also works but **pauses after 1 week inactivity** — bad for a public site. Aiven free (1 GB, pgvector) is a third option. |
| **LLM** | **Google AI Studio (Gemini)** | `GEMINI_API_KEY` is the only *required* LLM key (`env.ts`). Free tier is generous. |
| **LLM (primary)** | **Groq** | `GROQ_API_KEY` free tier (14.4k req/day) powers the default `llama-3.1-8b-instant`. |
| **LLM (fallback)** | **Hugging Face** | `HF_TOKEN` optional; used for reranking/embeddings fallback. |
| **File storage** | **None needed yet** | PDF uploads are parsed **in-memory** (4 MiB cap, `ingestPdf`) and stored as chunks in Postgres. Add **Cloudflare R2** (10 GB free, $0 egress) later if you keep raw files. |
| **Domain** | **Cloudflare Registrar / Porkbun** | ~$10/yr at cost. Free interim: `<project>.vercel.app`. |
| **Auth** | GitHub + Google OAuth | Free developer accounts. Email magic-link (Resend) optional. |
| **Monitoring** | Langfuse (free cloud) | Optional tracing; `LANGFUSE_*` env vars already supported. |

**Storage budget (0.5 GB Neon free):** a 768-dim vector ≈ 3 KB/row plus HNSW index overhead
(≈ 9 KB/chunk end-to-end). Run the estimator for your own numbers:

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

---

## 3. Vercel project + environment variables

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
| `GEMINI_API_KEY` | Google AI Studio key (**required** by `env.ts`) |
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

## 4. Custom domain (≈$10/yr, optional but recommended)

1. **Buy** at Cloudflare Registrar (`dash.cloudflare.com`) or Porkbun — `.com` ≈ $10/yr;
   `.in`/`.de` are cheaper if your audience is Indian students in Germany.
2. **Point DNS at Vercel** (Vercel → project → Settings → Domains → add domain):
   - Apex: `A` record → `76.76.21.21`
   - `www`: `CNAME` → `cname.vercel-dns.com`
   - Or simplest: use Vercel's nameservers.
3. Vercel issues an auto-renewing TLS cert. Keep `<project>.vercel.app` live as a fallback.
4. **Update `NEXTAUTH_URL`** to the custom domain and re-add the OAuth callback URLs.

---

## 5. Google listing (Search Console + indexing)

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

## 6. Go-live checklist (final pass)

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green locally
- [ ] `pnpm prisma migrate deploy` ran against Neon (extension `vector` created)
- [ ] All required env vars set in Vercel; `NEXTAUTH_SECRET` generated
- [ ] GitHub OAuth + Google OAuth callback URLs point at the production host
- [ ] `/api/cron/cleanup-cache` daily 4am cron registered (Hobby supports 1/day — matches) with `CRON_SECRET` set
- [ ] Custom domain + TLS live; `metadataBase`/`APP_URL` updated
- [ ] Sitemap + robots deployed; Search Console verified + sitemap submitted
- [ ] Test guest mode → sign in → **data claim** (guest conversations appear under the account)
- [ ] Test admin document ingest (URL + PDF), source browser, history export
- [ ] `npm` `pnpm`/Docker/`docker-compose.yml` only for the **Python RAG repo** — not needed for `web-app/`

## 7. Cost summary

| Item | Cost |
|---|---|
| Vercel Hobby | $0 |
| Neon Postgres free | $0 |
| Gemini / Groq / HF / GitHub / Google / Resend | $0 |
| Domain | ~$10/year |
| **Total** | **~$10/year** (or $0 while using the `.vercel.app` subdomain) |

## 8. Later upgrades (when traffic grows)

- Bump Neon to paid for PITR backups + more storage; add R2 for raw PDF storage.
- Add `@vercel/analytics` + Langfuse dashboards; enable preview deployments for PRs.
- Move semantic cache / rate limiting to Upstash Redis when the Postgres cache table grows.
