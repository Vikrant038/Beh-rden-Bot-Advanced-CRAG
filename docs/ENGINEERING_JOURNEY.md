# The Engineering Journey — Behörden-Bot

> **The honest version.** Not "we built a RAG app" but the actual path: the phases, the failures, the measurements, the deployment fires, and what we'd do differently. Every number below is real — most of them are in the git history or the eval artifacts.

---

## Prologue: start with the research, not the UI

The project began as a **Python research pipeline** — because the open questions were about *retrieval quality*, not about pixels:

- **Fine-tuned embeddings.** We fine-tuned `BAAI/bge-base-en-v1.5` with Multiple-Negatives-Ranking-Loss + hard negatives on immigration triples (Apple MPS GPU, 3 epochs). Result: **MRR@10 from 75.6% → 97.5% (+21.92%)**.
- **A 3-agent ReAct orchestrator** (Research → Analyst → Writer) instead of one mega-prompt, because single-prompt multi-tasking measurably degraded each subtask.
- **RAGAS-style CI gates** — the *first* thing built was the evaluator, not the product. Faithfulness ≥ 3.5, relevance ≥ 4.0, precision ≥ 75% blocked every merge from day one.

**Lesson:** measure quality *before* you build the interface, or you'll polish a product you can't prove works.

## Phase 1: the web app — the product is the interface

The research proved the approach; now it had to become a product people would actually use. The web-app (Next.js 15 + React 19 + tRPC + Prisma) was built in documented phases (`web-app/docs/status/phase-*.md`), each with a PRD, a TDD plan, and a delivery note:

- Auth (NextAuth v5, OAuth + magic links), conversations, message history.
- The **TS RAG pipeline** — a deliberate port of the Python design so production runs without Python on Vercel. Every file carries its `Ported from src/*.py` lineage.
- Admin dashboard with real DB metrics, and a **pipeline tester** to see exactly what the pipeline does per query.
- A **truthful landing page** — we removed fabricated claims and wired real DB-backed corpus stats, because a bot that must not hallucinate shouldn't have a website that does.

## Phase 2: the multilingual migration (768 → 1024-d)

**The failure:** the English-only embedding model scored German text poorly. German questions silently degraded — the pipeline fell back to web search because retrieval confidence was low, and German answers were worse than English ones.

**The diagnosis:** the embedding space was the bottleneck, not the retriever. The fix was structural:

- Migrated the entire corpus to **BGE-M3 (multilingual, 1024-d)** — same space for English and German, one model for queries and chunks.
- Re-embedded ~24k chunks, migrated the pgvector schema, rebuilt indexes (HNSW, FTS GIN).
- Moved embeddings to **Cloudflare's serverless `@cf/baai/bge-m3`** in production — no cold model spin-up; a local `embed-server.py` speaks the identical contract for dev/ingest.

**The hidden gotcha:** the Cloudflare worker had to use **CLS pooling** (not mean pooling) to match the corpus, and the input-key/response-shape contracts had to match exactly. A subtle mismatch produces garbage vectors that *look* fine. We documented the requirement in `DEPLOYMENT.md` and added a seed-corpus step that recreates the FTS GIN index on Neon after data-only seeds.

## Phase 3: the latency hunt — 147.8 s → 29 ms

A pipeline that technically works but takes minutes is not a product. The first real query trace showed sparse search eating **147.8 seconds** (in-process BM25 scoring is O(vocabulary) per query). The fixes, each measured:

| Problem | Measured | Fix | Result |
|---|---|---|---|
| BM25 scoring hotspot | 147.8 s | Move sparse search into **Postgres FTS** (GIN index) | **29 ms** |
| Per-query embedding cold starts | seconds | Batch embeddings per request + warm chat navigation | ~0 added latency |
| Serial dense retrieval per sub-query | N × dense time | Parallel dense retrieval | linear → ~1× |
| Pipeline-tester timeout crashes | 10 s serverless cap | Tester runs **in background + polls** (no more JSON crash) | reliable |
| Dense-search cold starts on admin traces | seconds | tappable trace rows, keep-warm worker | negligible |

**Lesson:** profile before you optimize. "Dense search is slow" turned out to be wrong — sparse was the villain, and the fix was moving work into the database instead of adding servers.

## Phase 4: deployment war stories

Deploying to Vercel (Hobby tier) was where the project earned its scars:

1. **Env-var parsing crashes the build.** `next build` died because malformed/empty env vars (values with spaces, angle brackets, empty strings) weren't normalized. Fix: harden env parsing so the build never crashes on config, and validate with zod at runtime.
2. **CSP nonce → blank screen.** The security baseline (nonce-CSP) broke hydration until inline scripts were stamped with per-request nonces in `middleware.ts`. This is *why* the app is force-dynamic — and why the landing page can't be statically prerendered. We kept the security and optimized everything else instead.
3. **OAuth callbacks dying in production.** Empty `AUTH_*` env on Vercel broke NextAuth callbacks. Fix: pin `NEXTAUTH_SECRET` + `trustHost`.
4. **Hobby-tier cron limits.** The 5-minute ingest cron violated Hobby limits; a broken worker left documents stuck `INGESTING`. Fix: drain on admin poll instead of cron, and a self-heal that re-syncs stuck documents.
5. **PoLP on Neon.** Postgres role grants had to be re-created for Neon's pooled connections — the migrator (DDL) and app (DML) role split had to be re-provisioned after the migration to cloud.
6. **CI breaking on formatting.** The "latest push broke CI" incident was Prettier formatting drift across 8 files. Now `format:check` runs in CI, and `pre-commit` enforces it locally — formatting is a gate, not a suggestion.
7. **E2E failing on the build.** The pipeline-tester UI change (closed-by-default accordions) broke the E2E specs that assumed open accordions. The E2E suite caught what unit tests couldn't: a real UI-behavior regression. Fixed both the specs and the send/paste button alignment bug that the phone-view screenshot revealed.

**Lesson:** serverless deployment is a different runtime, not "the same app in the cloud." Test the *build*, the *hydration*, the *cron*, and the *role model* — not just the code.

## Phase 5: the modern AI redesign

With the plumbing solid, the product needed to *feel* like a modern AI product (Claude/ChatGPT-grade), not a generic form app:

- **Design system:** evolved the Tailwind v4 CSS-first tokens (no config file) into a luminous dark palette — aurora backgrounds, gradient identity, glass surfaces, dark-first with light mode intact.
- **Landing:** animated aurora hero, live-type chat mockup, real DB stats with CountUp, gradient CTAs.
- **Chat:** borderless assistant answers in a centered column (the signature "modern AI" look), gradient user bubbles, floating glass composer, streaming cursor, hover-reveal actions.
- **Responsiveness done properly:** a **150-item responsive audit — with no sampling** — plus touch targets ≥ 44px, safe-area insets, and overflow guards. The follow-up phone-screenshot check caught a misaligned send/paste button and an accordion whose chevron was the only clickable part; both were fixed and the chevron moved consistently to the far right.
- **Reduced-motion as a requirement:** every animation is `useReducedMotion`-guarded (OS pref + a force-reduced-motion data attribute) — accessibility is not a corner case.

## Phase 6: the evaluation journey — 30 questions, two pipelines

The most instructive phase. We built a **30-question multilingual testset** (`data/eval/crag_30_questions.json`: 24 EN + 6 DE, 18 real topics, 2 adversarial traps) and a RAGAS-style evaluator scoring faithfulness, relevance, precision, recall, and refusal handling — first on the Python reference, then on the **production TS pipeline** itself.

What the evals taught us:

1. **Judge noise is real.** Two German items scored 1.0/5.0 in the first run — pure Groq rate-limit judge failures (items taking 10–23 minutes). Re-judged cleanly: 5.0/5.0. Fix: per-item `asyncio.wait_for` timeouts + an **atomic resumable checkpoint** so interrupted runs skip finished items. The whole eval now completes in minutes instead of hours.
2. **Context-truncation artifacts.** The TS eval's judge got a 5×400-char summary while the generator saw full parent-expanded chunks — so perfect answers scored 2.0. Fix: feed the judge the *real* generator context. Scores jumped 2.0 → 5.0 on the same answers.
3. **The guardrail was genuinely missing, and the traps proved it.** The first run: the bot *wrote a butter-chicken recipe* and *offered to arrange a faked APS*. Both traps scored as failures — and the failure was verified against real responses, not just scores. The fix: a deterministic negative-term cache + a safety term class that fails closed (ported from the TS production guardrail back into Python). Traps went **0/2 → 2/2** with zero false positives on the 28 legit questions.
4. **Context recall is a structural tradeoff, not a bug.** Multi-entity synthesis questions (name 4–6 official bodies) can't fit a 5-chunk answer window. We verified every missing keyword exists in the corpus *and* in the fused candidate pool — the rerank-to-5 compression is the bottleneck. Diagnosis over speculation.

## Phase 7: architecture reviews — no sacred cows

The project ran formal architecture reviews (including a full-repo redundancy audit) and acted on the findings:

- **Centralized the DB layer** — row→domain mapping, analytics SQL, conversation ownership policy, and the sparse retriever moved out of routers into `src/server/db/` (thin adapters in, duplicated raw SQL out).
- **Deleted dead code and deduped** — a single PII mask, one message-count quota query instead of 4 copies, one cache-payload parser instead of 3.
- **Caught a latent bug in review:** `toVectorLiteral` now rejects malformed short embedding vectors that previously would have *silently inserted* into the `vector(1024)` column.

## What we'd do differently

- **Build the eval harness *before* the guardrail port.** The traps would have caught the missing safety class months earlier.
- **Profile the sparse path sooner.** The 147.8 s hotspot was discoverable with a single trace; we found it via user complaint, not measurement.
- **Add E2E earlier.** The accordion regression was invisible to unit tests. E2E from the start would have caught the whole class of UI-regression bugs.
- **Standardize the two-pipeline drift earlier.** The TS and Python pipelines drifted (guardrail, sub-queries) precisely because they shared no code and no cross-pipeline eval. The dual eval harness is the corrective.

## The numbers that matter

| Metric | Value |
|---|---|
| Sparse search latency | 147.8 s → **29 ms** |
| Embedding MRR@10 (fine-tuned) | 75.6% → **97.5%** |
| Corpus size (web-app pgvector) | **~24k chunks** |
| Test suite | 600+ tests, 60+ files, **85% coverage gate** |
| Eval traps handled (after fix) | **2/2** clean refusals (both pipelines) |
| Eval faithfulness | Python **3.69** · web-app **3.98** / 5.0 |
| Eval context recall | Python 59.8% · web-app **72.1%** (gate 70%) |
| Eval gates passed | web-app **6/6** · Python 5/6 |
| Responsive audit | **150 items, zero sampling** |
| Pipeline-tester retention | latest **5** runs, by design |

---

*The journey is the product. Every number above was earned by measuring something that was once wrong.*
