# First-Principles Engineering — Behörden-Bot

> **Why does this project look the way it does?** Because every significant decision was derived from a small set of first principles about the *user*, the *domain*, and the *medium* (LLM systems) — not copied from a template or chosen because "everyone uses it."

This document is the reasoning trail. Each section starts from a principle so basic it can't be argued with, then derives the concrete decisions that followed. If a future change contradicts a derivation here, the change should win — but it should explain which principle it overrides and why.

---

## 0. The two ground truths

Before anything else, two facts about the problem domain anchor everything:

1. **German immigration bureaucracy is high-stakes and low-tolerance.** A wrong blocked-account amount or a missed APS deadline can void a semester or a visa. The cost of a confident wrong answer is *material*.
2. **LLMs will confidently say things they don't know.** That's not a bug in a particular model; it's the mechanism. A language model generates the *most plausible next tokens*, and plausibility is not the same as truth.

From these two facts, every architectural choice below follows.

---

## 1. Answers must be grounded in retrieved evidence

**Principle:** If the cost of a wrong answer is a lost semester, the system must not answer from the model's priors. The model may only answer from evidence we can point to.

**Derived decisions:**

- **RAG over a curated corpus, not free-form generation.** We answer only from ~24k chunks of vetted German immigration sources (BAMF, DAAD, KMK, uni-assist, Residence Act, …).
- **The CRAG (Corrective RAG) gate.** Retrieval returns a *confidence* (cross-encoder score). Below the threshold, the pipeline refuses to bluff — it degrades honestly instead of confabulating.
- **Mandatory citations.** Every answer carries source chips with relevance scores. This is not decoration: citations are the user's mechanism for *verifying* the claim, and the mechanism for *us* to audit failures.
- **Faithfulness is a measured gate, not a hope.** We don't assert "answers are grounded" — we score every answer against its retrieved context with a faithfulness judge in CI (see [Testing & Quality](TESTING_AND_QUALITY.md)). 3.69/5.0 on the 30-question eval, with a documented diagnosis for every miss.

## 2. Hybrid retrieval because no single signal is sufficient

**Principle:** A query is a poor description of intent, and no single representation captures all of it. Semantic vectors capture meaning but miss exact tokens; keywords capture exact tokens but miss meaning.

**Derived decisions:**

- **Dense + sparse, always.** German compounds (Aufenthaltserlaubnis, Zulassungsbescheid) are exact-token problems *and* semantic problems. Dense-only misses the compound; sparse-only misses the paraphrase.
- **RRF fusion instead of score blending.** Reciprocal Rank Fusion combines *rankings* rather than incomparable scores (cosine vs. BM25 vs. cross-encoder), so no retriever's scale dominates.
- **Cross-encoder re-rank at the top.** We re-rank a wide fused pool (40+ candidates) with a cross-encoder — the most accurate-but-expensive signal — and keep only the top 5. Spend the expensive model where it matters.
- **Bilingual sub-query expansion.** The corpus is German; many users ask in English. A query expanded into EN *and* DE variants surfaces entities under both names — measured by the fused candidate pool growing from ~30 to 59–225 chunks on hard questions.

## 3. Latency is a feature, not a nicety

**Principle:** A chat assistant that takes minutes to answer is not a chat assistant. Users judge the product in the first second.

**Derived decisions:**

- **Sparse search in Postgres FTS, not Python BM25.** Measured hotspot: BM25 scoring was O(vocabulary) per query — **147.8 s**. Postgres FTS with a GIN index: **29 ms**. Same semantics, two orders of magnitude faster, zero extra infrastructure.
- **Batch embedding + parallel dense retrieval.** Embed all sub-queries in one request; run dense retrieval per sub-query in parallel.
- **Kill cold starts.** The dense-search path used to pay a cold model load per query; the fix: warm the navigation, keep the embed worker warm, and move the 768→1024-d migration onto Cloudflare's serverless BGE-M3 so no cold model spin-up exists at all.
- **Semantic cache before the LLM.** Exact-hash + pgvector-cosine cache (7-day TTL) answers known and near-duplicate questions in ~0 ms. Repeat questions are the majority of real traffic.
- **Latency honesty:** every stage's duration is measured and shown (admin pipeline tester, Langfuse). You can't optimize what you don't measure.

## 4. Security is a baseline, not a feature toggle

**Principle:** This product handles people's immigration lives — PII (passports, IBANs, addresses) and sensitive legal situations. GDPR applies. A security bug is a product bug.

**Derived decisions:**

- **PII masking at the entry point.** Structured PII (IBAN, passport, DOB, phone, email) and names are masked *before any LLM call*. No raw PII ever leaves the server. (Python reference: regex + spaCy NER; web-app: a single shared masking utility.)
- **A guardrail that is deterministic first, probabilistic second.** Spam/off-topic queries (recipes, crypto, sports) are rejected by an instant negative-term cache — zero LLM cost, zero prompt-injection surface. The LLM classifier is only the *fallback* for what the cache misses.
- **Safety class fails closed.** Fraud requests ("pay someone to fake my APS") are refused *deterministically* — never subject to an LLM's judgment under load or error. Traps in the eval went 0/2 → 2/2 after this.
- **Principle of least privilege in the database.** The app runtime role is DML-only; migrations run as a separate DDL role. A SQL injection can't alter the schema.
- **CSP with per-request nonce.** We accept a dynamic-rendering cost (no static prerender) because the nonce-CSP prevents XSS through inline scripts — a security baseline the project refuses to trade away.
- **Secrets never in the repo.** Husky pre-commit scans staged files for credential patterns; CI runs Gitleaks. `.env` is gitignored.

## 5. One product, two languages, one quality bar

**Principle:** The sources are German; the users are international. Neither group may get a second-class assistant.

**Derived decisions:**

- **Multilingual embeddings (BGE-M3, 1024-d).** The original English-only model scored German text poorly, which *forced* web-search fallbacks and degraded German answers. Migrating the whole corpus to BGE-M3 (768 → 1024-d) put German and English in the same embedding space.
- **German parity is measured.** The 30-question eval includes 6 German items, and the scorecard reports them separately — DE and EN hold parity (faithfulness 3.5 / 3.5 at the time of writing).
- **Bilingual sub-queries** (principle 2) exist specifically so an English question finds the German-named entity.

## 6. Trust must be earned, and transparency is the mechanism

**Principle:** Users should never wonder *why* the bot said something. Administrators should never wonder *what* the pipeline did.

**Derived decisions:**

- **The admin pipeline tester shows every stage** — Stage 0 split, pre/post-processing (PII mask, cache lookup/write), per-agent cost, retrieval path, and every duration. It's a window into the pipeline, not a black box.
- **Retention by design:** the tester keeps only the latest 5 runs — enough to debug, not enough to hide problems behind history.
- **Langfuse traces on every request** with typed spans (retriever, guardrail, generation, agent) so production issues are reproducible after the fact.

## 7. Tests define "done"

**Principle:** If you can't verify a change didn't break the product, you haven't finished the change.

**Derived decisions:**

- **A four-layer quality system** — lint/format, typecheck, unit+integration with an **85% coverage gate**, and Playwright E2E — all enforced in CI *before* merge. Details: [Testing & Quality](TESTING_AND_QUALITY.md).
- **Behavioral tests, not just coverage.** The RAG tests include 9 real queries through the pipeline (in-scope *and* out-of-scope) so the guardrail is tested as behavior, not as a mocked unit.
- **RAG quality is a CI gate, not a manual ritual.** The Python eval (faithfulness ≥ 3.5, relevance ≥ 4.0, precision ≥ 75%) runs against the real corpus, and a parallel eval harness tests the production TS pipeline the same way.
- **Adversarial tests on purpose.** The eval includes trap questions — things users *shouldn't* be able to get the bot to do. A test suite that never tries to break the product isn't testing the product.

## 8. Ship the same design in both languages, deliberately

**Principle:** The production runtime (Vercel/serverless) and the research runtime (Python notebooks/evals) have different constraints. Duplicate the *design*, never the *effort*.

**Derived decisions:**

- The TS pipeline in `web-app/` is a deliberate port of the Python design (every file carries a `Ported from src/*.py` note) — so production runs without Python.
- The Python side remains the *research lab*: fine-tuning, benchmarks, and the evaluation harness live there, where they're fastest to iterate.
- When the TS side proved a better design (deterministic guardrail term-cache, safety terms, sub-query fusion), we **ported it back** into Python. The two sides converge instead of drifting.

---

## Anti-principles (what we deliberately did *not* do)

| Temptation | Why we refused |
|---|---|
| "Just use a bigger LLM prompt" | A bigger model with no retrieval is still a hallucinating model. Grounding is an architecture property, not a prompt property. |
| "Dense-only retrieval, it's simpler" | The measured cost of missing German compounds outweighed the simplicity. |
| "Ship it, add tests later" | With an 85% coverage gate in CI, "later" never happens. |
| "Static-render the landing page for speed" | The nonce-CSP security baseline requires per-request rendering. Speed at the cost of the XSS posture is the wrong trade for this product. |
| "One guardrail is enough" | A single LLM classifier is fail-open under load and error; the deterministic cache makes the *safety* class fail-closed. |

---

*First principles are not rules — they're the reasons the rules exist. When the reasons change, the rules should.*
