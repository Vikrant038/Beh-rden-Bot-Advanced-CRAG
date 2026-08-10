# Behörden-Bot — Vision

> *"Your personal expert guide through German bureaucracy — always grounded,
> always cited, never a guess."*

---

## The Problem This Solves

Moving to Germany as a student or skilled migrant means navigating a maze of
overlapping systems that nobody designed to work together: the Residence Act
(Aufenthaltsgesetz) and its sub-ordinances, BAMF processing timelines, the APS
certificate pathway for applicants from India and China, the blocked-account
(Sperrkonto) requirement and how much you actually need to deposit, uni-assist
application windows, Anmeldung (address registration), health insurance
obligations, recognition of foreign degrees, and the EU Blue Card salary
threshold that quietly changes every year.

The information exists. It is scattered across dozens of official German
government portals (BAMF, DAAD, KMK, Studienkolleg websites, individual
university admissions pages), mostly in German, updated without notice, and
written for administrative staff rather than first-time applicants.

The stakes are high. Getting the blocked-account amount wrong, missing the APS
application window by two weeks, or submitting the wrong visa document set can
cost a semester — or a year.

Generic AI assistants (ChatGPT, Gemini) can seem helpful here, but they
hallucinate specific figures with total confidence. A language model that has
not read the current BAMF guidance cannot reliably tell you the current
§16b visa processing time. It will give you a number anyway. That number may
be wrong. In this domain, a confident wrong answer is worse than no answer.

---

## What Behörden-Bot Is

Behörden-Bot is an enterprise-grade Corrective RAG (CRAG) assistant that
answers German immigration, student-visa, APS, blocked-account, and
university-admission questions in both **English and German** — with
verifiable citations to the actual source documents it retrieved.

Every answer is grounded. Every claim maps to a source you can verify.
When the system is not confident enough to give a grounded answer, it says so
honestly rather than guessing.

It is not a chatbot that sounds authoritative. It is a retrieval system
that *proves* its answers.

---

## How It Is Different

| Approach | What you get |
| -------- | ------------ |
| **Google it** | 20 tabs, half outdated, mostly in German, no guarantee of accuracy |
| **Ask ChatGPT / Gemini** | Fluent, confident, occasionally hallucinated figures — no citations |
| **Behörden-Bot** | Grounded answers with inline citations to the actual source page, honest "I don't know" when confidence is low, German + English at parity |

The key architectural difference: before generating any answer, the system
scores its own retrieved evidence. If the retrieval confidence is too low,
the answer is flagged as uncertain or falls back to a live web search rather
than generating a fluent guess from weak evidence. This is what "Corrective"
means in CRAG.

Additionally:

- **PII never reaches an LLM.** If you include your name, IBAN, or passport
  number in a question, it is masked before the query touches any external
  provider.
- **The answer quality is measured.** A 30-question multilingual evaluation
  harness (including adversarial traps) runs in CI and gates every release.
  The current scores are published openly in the README — not marketing claims,
  measured numbers.
- **German is a first-class language.** The embedding model (BGE-M3) was
  specifically chosen because it handles German compound terms
  (Aufenthaltserlaubnis, Zulassungsbescheid, Immatrikulationsbescheinigung)
  in the same vector space as their English equivalents. Bilingual sub-query
  expansion means a question asked in English still surfaces German-language
  source documents.

---

## Who This Is For

**Primary audience:** International students and skilled migrants navigating
the German immigration or university application process — most commonly
from India, China, and other countries where the APS certificate pathway
applies, but anyone facing the German bureaucratic system.

**Secondary audience:** Academic advisors, immigration consultants, and
university international offices that want a reliable, citable reference tool
rather than a confident hallucinator.

**Technical audience:** AI and data engineers interested in a worked, measured
example of a production CRAG system — fine-tuned embeddings, hybrid retrieval
with quantified performance improvements, a multilingual evaluation harness,
and a full TypeScript production implementation alongside a Python research
reference.

---

## What This Project Is Not

- It is **not legal advice.** Answers are grounded in public official sources
  and cited so you can verify. For individual legal decisions, consult a
  qualified Rechtsanwalt (immigration lawyer).
- It is **not a replacement for official sources.** It is a faster, more
  navigable entry point to them — every answer links back to the original.
- It is **not always right.** Official guidance changes. The knowledge base
  reflects the corpus at ingestion time. Always verify critical dates and
  figures directly with the issuing authority.

---

## Where It Is Going

The immediate roadmap:

- **Corpus expansion** — adding more official German university and immigration
  sources, keeping the knowledge base current with automated freshness checks.
- **User personalisation** — allowing users to save their application context
  (target university, nationality, visa type) so answers are pre-filtered to
  their situation without repeating it every conversation.
- **Stronger guardrail** — replacing the LLM-based safety classifier with a
  fine-tuned text-classification model that is harder to prompt-inject.
- **German language parity improvement** — closing the faithfulness gap between
  English and German answers (currently 4.21 vs. 3.08 — known, measured,
  being addressed).

The longer vision: a tool that genuinely makes the German immigration and
education system more accessible to international applicants — not by
simplifying it (the system is what it is) but by making trustworthy,
cited information available in seconds rather than hours of research.

---

## The Engineering Philosophy

Every architectural decision in this project was made with evidence, not
assumption. Retrieval accuracy was measured before and after every change.
Embedding models were benchmarked. Latency was profiled. The evaluation harness
gates releases.

The reason the README leads with benchmark numbers and the CRAG evolution
narrative is not marketing — it is the record of the decisions that were made
and the measurements that justified them. That is the engineering standard
this project holds itself to.

Full details: [First Principles Engineering](FIRST_PRINCIPLES.md) ·
[The Engineering Journey](ENGINEERING_JOURNEY.md) ·
[Testing & Quality](TESTING_AND_QUALITY.md)

---

*Built for the people who have to figure out German bureaucracy from scratch.*
*🇩🇪 For international students, by someone who understands the problem.*
