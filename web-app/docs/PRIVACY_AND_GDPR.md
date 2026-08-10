# Privacy & GDPR — Behörden-Bot

> **Plain-language summary:** We collect the minimum data needed to make the
> app work. Your questions are masked before they touch any external AI
> provider. You can delete your account and all data at any time. We do not
> sell data. We do not train models on your conversations.

---

## 1. Who Is Responsible for Your Data

Behörden-Bot is operated by Vikrant Yadav ("we", "us"). For GDPR purposes this
is the **data controller** for data collected through the web application.

Contact for privacy matters: raise a **private** GitHub Security Advisory via
the Security tab, or use the contact details in [`SECURITY.md`](../../SECURITY.md).

---

## 2. What Data We Collect and Why

### 2.1 Account Data (registered users)

| Data | Why we collect it | Legal basis |
| ---- | ----------------- | ----------- |
| Email address | Authentication (magic link sign-in) | Contract (account access) |
| Name / display name | Shown in the UI | Contract |
| OAuth provider ID (GitHub / Google) | Federated authentication — we receive only an opaque ID and your email, never your OAuth password | Contract |
| Session JWT | Keeps you signed in across page loads | Contract |

We do **not** collect: phone number, address, payment information, date of
birth, nationality, passport or visa details.

### 2.2 Conversation Data

| Data | Why we collect it | Legal basis |
| ---- | ----------------- | ----------- |
| Your chat messages (questions) | Needed to generate answers; stored so you can revisit conversation history | Contract |
| Assistant responses + source citations | Displayed in the UI; stored for conversation continuity | Contract |
| Conversation metadata (timestamps, pipeline mode, latency) | Powers the admin analytics dashboard and evaluation harness | Legitimate interest |

### 2.3 Semantic Cache

A vector representation of your query (an embedding — a list of numbers, not
raw text) may be stored in the semantic cache with a **7-day TTL**. If a
future user asks a sufficiently similar question, the cached response may be
returned. No personal identifying information is stored in the cache — only
the embedding vector and the anonymised answer text.

### 2.4 Guest Sessions

If you use the app without signing in, a temporary guest session token is
stored in a browser cookie. Guest conversations are not linked to any account
and are subject to a message-count limit. Guest conversation data is not
retained beyond the session.

### 2.5 Technical / Operational Data

Standard web server logs (IP address, request path, timestamp, HTTP status)
are collected for security monitoring and debugging. These are not linked to
conversation content. Retention: 30 days.

---

## 3. What Happens to Your Questions Before They Reach an AI Model

This is the most important section for users asking about sensitive
immigration situations.

**PII masking runs before any LLM call.**

Before your question is sent to any external AI provider (Groq, Hugging Face),
it passes through `src/server/pii/masker.ts`, which detects and replaces:

- Full names
- Email addresses
- Phone numbers
- IBAN / bank account numbers
- Passport and national ID numbers
- Dates of birth

These values are replaced with typed placeholders (`[NAME]`, `[IBAN]`, etc.)
in the query that reaches the LLM. The original unmasked text is used only
for the local semantic cache lookup and is never transmitted externally.

**Practical example:** If you ask *"My name is Arjun Sharma and my passport
number is X1234567 — what documents do I need for a §16b visa?"*, the query
sent to Groq is: *"My name is [NAME] and my passport number is [PASSPORT] —
what documents do I need for a §16b visa?"*

---

## 4. Third-Party Services We Use

| Service | What data reaches it | Their privacy policy |
| ------- | -------------------- | -------------------- |
| **Groq** | PII-masked query text + retrieved document chunks for answer generation | [groq.com/privacy](https://groq.com/privacy) |
| **Hugging Face Inference** | PII-masked query text (fallback LLM only) | [huggingface.co/privacy](https://huggingface.co/privacy) |
| **Cloudflare Workers AI** | Query text for embedding generation (PII-masked) | [cloudflare.com/privacypolicy](https://www.cloudflare.com/privacypolicy/) |
| **Neon (PostgreSQL)** | All conversation and account data (EU region) | [neon.tech/privacy](https://neon.tech/privacy) |
| **Vercel** | Application hosting; standard request logs | [vercel.com/legal/privacy-policy](https://vercel.com/legal/privacy-policy) |
| **GitHub / Google OAuth** | Only the opaque OAuth ID and email you grant; we request minimal scopes | [github.com/privacy](https://github.com/privacy) · [policies.google.com/privacy](https://policies.google.com/privacy) |
| **Langfuse** | Pipeline execution traces for observability (query text + model outputs) | [langfuse.com/privacy](https://langfuse.com/privacy) |
| **Upstash Redis** | Rate-limiting counters (IP hash, no conversation content) | [upstash.com/trust/privacy](https://upstash.com/trust/privacy) |

We do not use advertising networks, social media tracking pixels, or
third-party analytics scripts.

---

## 5. Data Retention

| Data type | Retention period |
| --------- | ---------------- |
| Account data | Until you delete your account |
| Conversation history | Until you delete the conversation or your account |
| Semantic cache entries | 7 days (automatic TTL) |
| Guest session data | Session only (cleared on browser close or expiry) |
| Server / access logs | 30 days |
| Langfuse traces | Per Langfuse's data retention settings (configurable) |

---

## 6. Your Rights Under GDPR

If you are in the European Economic Area or the United Kingdom, you have the
following rights regarding your personal data:

| Right | What it means | How to exercise it |
| ----- | ------------- | ------------------ |
| **Access** | Request a copy of the data we hold about you | Contact us via the Security tab |
| **Rectification** | Correct inaccurate data | Update your profile in Settings, or contact us |
| **Erasure ("right to be forgotten")** | Delete your account and all associated data | Settings → Delete Account (immediately deletes conversations, account, and profile data) |
| **Restriction** | Ask us to stop processing your data while a dispute is resolved | Contact us |
| **Portability** | Receive your conversation data in a machine-readable format | Contact us — we can export as JSON |
| **Objection** | Object to processing based on legitimate interest | Contact us |
| **Withdraw consent** | Where processing is consent-based, withdraw at any time | Contact us or delete your account |

We will respond to verified requests within **30 days**.

You also have the right to lodge a complaint with your national data protection
authority (in Germany: the **Bundesbeauftragte für den Datenschutz und die
Informationsfreiheit**, [bfdi.bund.de](https://www.bfdi.bund.de)).

---

## 7. Data Security

We take reasonable technical and organisational measures to protect your data:

- All data in transit uses TLS 1.2+.
- The database uses **principle-of-least-privilege roles** — the app runtime
  has DML-only access (no `DROP`, no `ALTER`).
- Authentication uses short-lived JWT sessions with CSRF protection.
- Secrets are managed via environment variables, never committed to source
  control. CI scans for leaked credentials on every push (Gitleaks).
- A Content Security Policy (CSP) nonce is applied to all HTML responses.

Known security limitations are documented in
[`docs/security/SECURITY_EXCEPTIONS.md`](security/SECURITY_EXCEPTIONS.md).

No security measure is perfect. If you discover a vulnerability, please report
it via our [security policy](../../SECURITY.md).

---

## 8. Cookies

| Cookie | Purpose | Duration |
| ------ | ------- | -------- |
| `next-auth.session-token` | Keeps you signed in (JWT session) | Session / 30 days |
| `next-auth.csrf-token` | CSRF protection for auth flows | Session |
| `__Secure-next-auth.*` | Secure variants of the above on HTTPS | Session |
| `guest-session` | Temporary identifier for unauthenticated guest chat | Session |

We do not use advertising cookies or third-party tracking cookies.

---

## 9. Children

This service is not directed at children under 16. We do not knowingly collect
personal data from children. If you believe a child has provided us with
personal data, please contact us and we will delete it promptly.

---

## 10. Changes to This Policy

If we make material changes to this policy, we will update the date below and,
where the changes affect how we use your data, notify signed-in users via the
app. Continued use of the service after changes constitutes acceptance.

---

## 11. Contact

For privacy questions or to exercise your rights:

- Raise a **private** GitHub Security Advisory via the **Security** tab of
  this repository.
- Or file a private contact request via the repository's Discussions (if
  enabled).

We aim to respond within 72 hours.

---

*Last updated: 2026-08-04*
*Applies to: `web-app/` production application*
