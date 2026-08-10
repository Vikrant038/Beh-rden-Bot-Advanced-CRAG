# User Guide — Behörden-Bot

> Your AI assistant for German immigration, student visas, APS certificates,
> blocked accounts (Sperrkonto), and university applications.
> Answers in **English and German** — always with citations, never a guess.

---

## Table of Contents

1. [What Behörden-Bot Can Help With](#1-what-behörden-bot-can-help-with)
2. [Getting Started](#2-getting-started)
3. [Starting a Conversation](#3-starting-a-conversation)
4. [Understanding the Answer](#4-understanding-the-answer)
5. [Disambiguation Cards](#5-disambiguation-cards)
6. [Choosing a Mode: Standard vs Agentic](#6-choosing-a-mode-standard-vs-agentic)
7. [Conversation History](#7-conversation-history)
8. [Using the App in German](#8-using-the-app-in-german)
9. [What the Bot Will Not Do](#9-what-the-bot-will-not-do)
10. [Your Privacy](#10-your-privacy)
11. [Guest Mode vs Signed-In Account](#11-guest-mode-vs-signed-in-account)
12. [Troubleshooting](#12-troubleshooting)
13. [Giving Feedback](#13-giving-feedback)

---

## 1. What Behörden-Bot Can Help With

Behörden-Bot answers questions about the German bureaucratic processes that
international students and migrants encounter most. The knowledge base covers:

**Visas & residence permits**
- Student visa (§16b Aufenthaltsgesetz) — documents, timelines, appointment booking
- Language course visa (§16f)
- Job-seeker visa and transition from student visa
- EU Blue Card — eligibility, salary thresholds, application process
- Freelance / self-employment permit

**University applications**
- uni-assist — what it does, how to apply, timelines, document requirements
- Studienkolleg — who needs it, how to apply, entrance exam (Feststellungsprüfung)
- Direct university applications vs. uni-assist
- Zulassungsbescheid (admission letter) — how to read it, what to do next

**APS Certificate (Academic Evaluation Centre)**
- Who needs an APS certificate (India, China, Vietnam, Mongolia)
- Application process, documents, interview, timelines
- What to do if your APS application is delayed

**Blocked account (Sperrkonto)**
- What a Sperrkonto is and why it is required
- How much to deposit (current required amount)
- Which providers to use (Fintiba, Expatrio, Deutsche Bank)
- How to open one and how long it takes

**Life in Germany**
- Anmeldung (address registration) — how it works, documents needed
- Health insurance — public vs. private, student options, TK, AOK, Barmer
- Tax ID (Steueridentifikationsnummer) — how to get one
- Recognition of foreign degrees (anabin database, KMK)

**Language requirements**
- TestDaF — format, scoring, registration
- Goethe-Zertifikat — levels, exam centres, online options
- DSH — university-administered test, exemptions

If your question falls outside this domain, the system will tell you rather
than guess. See [What the Bot Will Not Do](#9-what-the-bot-will-not-do).

---

## 2. Getting Started

### Option A — Use it immediately (no account needed)

Visit the app and start typing. As a guest you can send a limited number of
messages to try the system. Guest conversations are not saved after your
session ends.

### Option B — Create a free account

Sign in with **GitHub**, **Google**, or an **email magic link** (no password
required). A signed-in account gives you:

- Unlimited conversations
- Saved conversation history — pick up where you left off
- Access to conversation history across devices

To sign in: click **Sign in** at the top right → choose your method → follow
the prompts. That is it. No form to fill out, no password to remember.

---

## 3. Starting a Conversation

Type your question naturally into the chat input at the bottom of the screen
and press **Enter** or click the send button.

**Good questions to ask:**

- *"What documents do I need to apply for a student visa in India?"*
- *"How much money do I need in my blocked account in 2026?"*
- *"What is the difference between uni-assist and applying directly to a university?"*
- *"Ich brauche eine Aufenthaltserlaubnis nach § 16b — welche Unterlagen brauche ich?"*
- *"My APS interview is in 3 weeks — what should I prepare?"*
- *"Which health insurance is best for international students in Germany?"*

**Tips for better answers:**

- Include relevant context: your nationality, your target university or city,
  and your current stage (e.g. "I have a Zulassungsbescheid from TU Munich").
- Be specific about the visa category if you know it (§16b, §16f, EU Blue Card).
- If you are asking about a current requirement (blocked account amount, salary
  threshold), mention the year so the answer can flag if the figure may have
  been updated.
- You can ask follow-up questions — the bot remembers the context of the
  current conversation.

---

## 4. Understanding the Answer

Every answer has three parts:

### The answer text

A structured response in the same language you asked in (English or German),
written to be actionable — not a wall of legal text. It covers:

- The direct answer to your question
- Step-by-step instructions where relevant
- Important caveats or things to watch out for
- What to do next

### Source citations

Below the answer text you will see the sources the system retrieved to generate
the answer. Each citation shows:

- The **document title** (e.g. "BAMF — Student Visa Requirements")
- A **relevance indicator** — how closely the source matched your question
- A **link** to the original source where possible

**You should verify important figures and dates directly from the cited
official source.** The app is a research tool, not a legal authority. Guidance
from BAMF, DAAD, and embassies changes. Always confirm from the source before
submitting an application.

### The confidence signal

If the system retrieves sources but is not confident they contain the specific
answer you need, it will say so explicitly — something like: *"I found some
relevant information but I am not fully confident this covers your specific
situation. Please verify with the official BAMF page."*

This is intentional. A hedged answer you can verify is more useful than a
confident wrong answer.

---

## 5. Disambiguation Cards

If your question is short or vague (three words or fewer), the system may
respond with **three clarifying options** instead of a guess.

**Example:** You type *"blocked account"*

The system responds with three cards:
1. *How much money do I need to deposit in a blocked account for a student visa?*
2. *Which blocked account providers (Fintiba, Expatrio) are accepted for German visas?*
3. *How do I open a blocked account and how long does it take?*

Click the card that matches your actual question and the system will answer
that specific question with full retrieval and citations.

This prevents the system from guessing which of three different questions you
meant and giving you the answer to the wrong one.

---

## 6. Choosing a Mode: Standard vs Agentic

The chat input has a **mode switch** (Standard / Agentic). Here is the
difference:

### Standard mode (default)

- Retrieves relevant document chunks, reranks them, and generates a direct
  grounded answer.
- Fast — typically answers in 3–8 seconds.
- Best for: specific factual questions with a known answer in the corpus
  (*"What is the current blocked account requirement?"*).

### Agentic mode

- Runs a three-agent pipeline: a Research Agent that searches the corpus and
  web iteratively, an Analyst Agent that structures the findings, and a Writer
  Agent that produces a detailed cited response.
- Slower — typically 15–40 seconds.
- Best for: complex multi-part questions that require synthesising information
  from several sources (*"Compare the APS application process for applicants
  from India vs. China — what are the differences in documents, timelines, and
  interview formats?"*).

For most questions, Standard mode is sufficient and faster. Switch to Agentic
when you need a thorough, structured deep-dive.

---

## 7. Conversation History

All conversations from your signed-in account are saved and accessible from
the **sidebar on the left**. Conversations are grouped by date (Today,
Yesterday, Last 7 days, etc.).

**To continue a past conversation:** Click it in the sidebar. The full history
loads and you can ask follow-up questions — the bot remembers the context.

**To start a new conversation:** Click the **New Chat** button at the top of
the sidebar or navigate to the home page.

**To delete a conversation:** Open the conversation → click the options menu
(three dots) → **Delete**. Deletion is permanent.

The bot maintains a **rolling memory** of your current conversation — it
remembers what was said earlier in the same chat and can answer follow-up
questions like *"What about the fee for that?"* in context. Memory does not
carry across separate conversations.

---

## 8. Using the App in German

You can ask questions in German and the app will answer in German. The
underlying embedding model (BGE-M3) handles German technical terms natively —
compound words like *Aufenthaltserlaubnis*, *Zulassungsbescheid*, and
*Immatrikulationsbescheinigung* are understood without translation.

**Bilingual retrieval:** Even if you ask in English, the system generates
German sub-queries internally and searches German-language source documents.
This means you get answers grounded in German official sources even when
asking in English — which matters because much of the authoritative guidance
only exists in German.

**Language switching mid-conversation** works — you can ask in English, get
an answer in English, then follow up in German and the response will switch.

---

## 9. What the Bot Will Not Do

**Out-of-domain questions**

Behörden-Bot is scoped to German immigration, student visa, and university
application topics. Questions outside this domain — cooking, general travel,
other countries' visa systems, coding help — will be declined with an
explanation rather than answered with a hallucinated guess.

**Fraudulent or illegal requests**

The system has a safety guardrail that refuses requests involving forgery,
bribery, or circumvention of immigration law — for example:
- *"How do I fake an APS certificate?"*
- *"Can I get a visa without the blocked account?"*

These are refused cleanly with no partial answer.

**Legal or financial advice**

The app provides information grounded in official sources. It does not provide
legal advice, immigration consultancy, or financial recommendations. For
individual legal decisions, consult a qualified Rechtsanwalt (lawyer) or
registered immigration consultant.

**Personal data interpretation**

The app will not interpret your specific visa decision letter, rejection
notice, or legal correspondence. It can explain what a document type means
in general, but it cannot advise on your individual case.

---

## 10. Your Privacy

**Your questions are masked before reaching any AI provider.**

If you include your name, passport number, IBAN, or email in a question, those
values are automatically replaced with placeholders before your query is sent
to Groq or any other external service. The AI provider never sees your raw
personal data.

**We do not train on your conversations.**

Your conversations are used to generate answers and to power your history. They
are not used to train or fine-tune any AI model.

**You can delete everything.**

Settings → Delete Account removes your account, all conversations, and all
associated data immediately.

Full details: [PRIVACY_AND_GDPR.md](PRIVACY_AND_GDPR.md)

---

## 11. Guest Mode vs Signed-In Account

| Feature | Guest | Signed-in |
| ------- | ----- | --------- |
| Ask questions | ✅ (limited) | ✅ (unlimited) |
| Conversation history saved | ❌ | ✅ |
| History accessible across devices | ❌ | ✅ |
| Follow-up questions in same session | ✅ | ✅ |
| Agentic mode | ✅ | ✅ |
| Account settings | ❌ | ✅ |
| Delete your data | Session ends automatically | ✅ via Settings |

Guest mode is useful for a quick one-off question. For anything involving
research across multiple sessions, a free account is worth setting up —
sign-in takes under 30 seconds with Google or GitHub.

---

## 12. Troubleshooting

**"The answer seems outdated"**

The knowledge base is built from official sources ingested at a point in time.
Immigration rules and requirements change. If an answer references a figure
(blocked account amount, salary threshold, processing time) that does not match
what you see on the official source, trust the official source. You can flag
this by using the feedback mechanism so the corpus can be updated.

**"I got a disambiguation card but none of the options match my question"**

Rephrase your question with more detail. Instead of *"APS"*, try *"What is the
APS certificate application process for applicants from India?"*

**"The answer says it is not confident"**

This is the system being honest. It means the corpus does not contain a strong
match for your specific question. Try rephrasing, or check the official source
directly (BAMF, DAAD, your target university's international office).

**"The page is slow to respond"**

The agentic pipeline can take 15–40 seconds. Standard mode is faster. If
Standard mode is also slow, it may be a temporary provider issue — try again
after a minute.

**"I cannot sign in with my magic link"**

Magic links expire after 10 minutes. Request a new one. Check your spam folder.
If you are using a corporate email that filters external links, try Google or
GitHub sign-in instead.

**"I see an error message in the chat"**

Refresh the page and try again. If the error persists, the underlying LLM
provider (Groq) may be experiencing an outage. The system has a fallback
provider, but both may occasionally be unavailable simultaneously. Check
[status.groq.com](https://status.groq.com) for provider status.

---

## 13. Giving Feedback

Found an answer that was wrong, outdated, or unhelpful? Have a suggestion?

- **GitHub Discussions** (if enabled) — the preferred channel for feature
  requests and general feedback.
- **GitHub Issues** — for reproducible bugs (wrong answer for a specific
  question, UI problem, broken feature).
- **Do not** post personal data (your visa case details, passport information)
  in public GitHub issues.

For security issues, see [SECURITY.md](../../SECURITY.md).

---

*Last updated: 2026-08-04*
*Questions? Open an issue or start a GitHub Discussion.*
