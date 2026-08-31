# Frequently Asked Questions — Behörden-Bot

---

## For Users

### What is Behörden-Bot?

Behörden-Bot is an AI assistant that answers questions about German
immigration, student visas, APS certificates, blocked accounts (Sperrkonto),
and university applications — in English and German, with citations to the
official sources it retrieved. It is built on a Corrective RAG (CRAG)
pipeline that scores its own retrieval confidence and says "I'm not sure"
rather than guessing when evidence is weak.

---

### Is it free to use?

Yes. Guest mode is free with a message-count limit. Creating a free account
(GitHub, Google, or email magic link) removes the limit and saves your
conversation history.

---

### Do I need to sign up to use it?

No. You can use it as a guest immediately. Sign-up unlocks unlimited
conversations and saved history.

---

### What languages can I use?

English and German. Ask in either language and you will get an answer in the
same language. The system retrieves German-language source documents even
for English questions, so you get answers grounded in German official sources
regardless of the language you use.

---

### Why am I seeing three option cards instead of an answer?

This is the **disambiguation step**. When a question is very short or vague
(three words or fewer), the system offers three specific interpretations
rather than guessing which one you meant. Click the card that matches your
actual question for a full grounded answer.

---

### What does "I'm not confident enough to answer this reliably" mean?

It means the retrieval system found related information but the relevance
score was below the confidence threshold. Rather than fabricating an answer
from loosely related chunks, the system tells you honestly that it cannot
give a well-grounded response for your specific question. Try rephrasing with
more detail, or check the official source directly (BAMF, DAAD, your
university's international office).

---

### The answer has a number (blocked account amount, salary threshold) — is it current?

Immigration requirements change. The knowledge base reflects the corpus at
ingestion time. Always verify current figures directly from the cited official
source before submitting an application. If you see a figure that looks
outdated, the citation will show you exactly which source to check.

---

### Can I upload my own documents (visa letter, rejection notice)?

Not directly as user uploads in the current version. The document corpus is
managed by administrators. You can describe the contents of a document in
your question and the system will try to help, but it cannot parse the
specific letter you received.

---

### Is my personal data safe?

Your questions are **PII-masked** before they reach any external AI provider.
Names, passport numbers, IBANs, email addresses, and phone numbers are
replaced with typed placeholders before the query leaves the app. The AI
provider (Groq) never sees your raw personal data. Full details:
[`web-app/docs/PRIVACY_AND_GDPR.md`](../web-app/docs/PRIVACY_AND_GDPR.md).

---

### Can I delete my data?

Yes. Settings → **Delete Account** removes your account, all conversations,
and all associated data immediately and permanently.

---

### The bot refused my question. Why?

Two reasons the system refuses:

1. **Out of domain** — the question is not about German immigration,
   university applications, or related bureaucratic topics. The bot is
   scoped intentionally; a refusal here is correct behaviour.
2. **Safety guardrail** — the question involves forgery, bribery, or
   circumvention of immigration law. These are refused with no partial answer.

---

### Can I use this for legal advice?

No. Behörden-Bot provides information grounded in official public sources,
with citations you can verify. It is not legal advice and does not replace
a qualified Rechtsanwalt (immigration lawyer) or registered consultant for
individual legal decisions.

---

### Standard mode vs Agentic mode — which should I use?

**Standard** (default): fast (3–8 seconds), direct grounded answers for
specific factual questions. Use this for 90% of questions.

**Agentic**: slower (15–40 seconds), runs a three-agent research/analysis/
writing pipeline. Use this for complex multi-part questions that require
synthesising information across several topics (e.g. comparing APS processes
across different countries).

---

## For Technical Readers / Contributors

### Why TypeScript for the production app, not Python?

The Python reference implementation (`mvp-python/`) was the research and
evaluation sandbox. When it came time to build the production web app, the
requirement was zero cold-start Python processes on a serverless platform
(Vercel). Re-implementing the RAG pipeline in TypeScript meant the entire
system — frontend, API, and pipeline — runs in a single Node.js process with
no Python subprocess calls at runtime. The TS pipeline was ported method by
method from the Python reference and evaluated against the same 30-question
testset to confirm parity.

---

### Why Groq instead of OpenAI?

Three reasons: **speed** (~800 tokens/second vs. ~50–80 for OpenAI-class
APIs — latency is a product feature in a chat application), **cost** (roughly
10× cheaper per token on the 8b model), and **API compatibility**
(OpenAI-compatible, so the provider abstraction layer required minimal
changes). The circuit breaker falls back to Hugging Face Inference if Groq is
unavailable.

---

### Why pgvector instead of Pinecone or Weaviate?

Operational simplicity. The app already requires PostgreSQL for conversation
and user data. Adding `pgvector` to the same database means one infrastructure
dependency instead of two, no extra network hop for vector lookups, and
transactional consistency between document metadata and embeddings. At the
scale of ~24k chunks the query performance (HNSW cosine, ~10ms) is more than
adequate.

---

### Why BGE-M3 instead of OpenAI's text-embedding-ada-002?

Two reasons: **cost** (zero per-embedding API cost — BGE-M3 runs on a
self-hosted Cloudflare Workers AI endpoint or a local server for development)
and **multilingual quality** (BGE-M3 handles German compound terms and
produces the same vector space for English and German queries, which is
essential for the bilingual sub-query expansion). OpenAI embeddings are
English-dominant and would have required a separate German embedding model or
accepted degraded German retrieval quality.

---

### Why CRAG instead of vanilla RAG?

Vanilla RAG generates an answer from whatever chunks it retrieves — even if
those chunks are only loosely related to the question. In a high-stakes
domain like immigration law, a confident hallucinated answer is actively
harmful. The CRAG gate scores the reranked chunks before generation. If
confidence is below threshold, the system either falls back to live web
search or returns an honest uncertainty message. The benchmark numbers
(context precision +25pp, answer relevance +26.9% vs baseline) are in the
README.

---

### Why did you fine-tune embeddings?

The pre-trained `BAAI/bge-base-en-v1.5` model scored MRR@10 of 75.6% on the
domain corpus. After fine-tuning with MNRL + hard-negative mining on 150
domain triples (3 epochs, Apple MPS), MRR@10 rose to 97.5% — a +21.92%
improvement. The hard negatives (the most misleading chunk per query, mined
by BM25) forced the model to learn fine-grained domain distinctions that the
general-purpose base model conflated.

---

### What is the 30-question evaluation harness?

A set of 30 hand-built questions covering 18 real topics from the corpus,
in 24 English + 6 German, including 2 adversarial traps (a recipe request
and a forged-document request). The harness runs the real production pipeline
end-to-end, scores answers on faithfulness, relevance, context precision, and
context recall via an LLM-as-judge, and checks that traps trigger the
guardrail. It runs weekly in CI and gates releases. Full details:
[`web-app/docs/EVALUATION.md`](../web-app/docs/EVALUATION.md).

---

### Why are the two pipelines (Python and TypeScript) not sharing code?

The Python `mvp-python/` implementation is a research and evaluation reference.
The TypeScript `web-app/` is the production system. Sharing runtime code
would require either a Python sidecar process (rejected — serverless cold
start), a microservice split (over-engineering for this scale), or compiling
Python to WASM (immature toolchain). Instead, the two sides share a **design
contract** — the same pipeline stages, thresholds, and evaluation harness —
and the TS implementation was ported and validated to achieve identical or
better eval scores on the same 30-question testset.

---

### How do I run the evaluation harness locally?

```bash
# Production TS pipeline
cd web-app
pnpm tsx scripts/eval-crag-webapp.ts

# Python reference pipeline
cd mvp-python
../.venv/bin/python -m tests.eval_ragas
```

Full runbook with environment requirements and interpretation of scores:
[`web-app/docs/EVALUATION.md`](../web-app/docs/EVALUATION.md).

---

### Where is the roadmap?

[`web-app/docs/ROADMAP.md`](../web-app/docs/ROADMAP.md) — future work,
known limitations, and the prioritised improvement backlog.

---

### How do I contribute?

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) at the repo root.

---

*Last updated: 2026-08-04*
