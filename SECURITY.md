# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| `main` (latest) | ✅ Active |
| Older commits | ❌ Not supported — please update to `main` |

This is an actively developed project. Security fixes land on `main` only.
There are no versioned release branches at this time.

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**
A public issue immediately exposes the vulnerability to everyone before a fix is
in place.

### How to report

Send a plain-text email to:

```
vikrant [at] [your-domain]
```

> Until a public contact address is established, open a **private** GitHub
> Security Advisory via the **"Security"** tab → **"Report a vulnerability"**
> button. GitHub keeps it confidential between you and the maintainer.

### What to include

A useful report contains at minimum:

1. **Description** — what the vulnerability is and where it lives (file, route,
   component).
2. **Steps to reproduce** — a minimal sequence that demonstrates the issue.
3. **Impact** — who can trigger it and what an attacker could do.
4. **Suggested fix** (optional but appreciated).

You do not need a fully working proof-of-concept. A clear description is
enough to begin investigation.

---

## Response Commitments

| Action | Target timeline |
| ------ | --------------- |
| Acknowledge receipt | Within **72 hours** |
| Initial triage (confirm or decline) | Within **7 days** |
| Fix shipped (critical / high severity) | Within **30 days** |
| Fix shipped (medium / low severity) | Best effort, next release cycle |
| Public disclosure | Coordinated with reporter after fix ships |

If you do not receive an acknowledgement within 72 hours, follow up — the
email may have been caught by spam filters.

---

## Scope

### In scope

- The `web-app/` Next.js application and its API routes
- The RAG pipeline and all server-side modules (`src/server/`)
- Authentication flows (Auth.js v5 — GitHub, Google, magic link)
- Database access layer (Prisma + pgvector)
- The document ingestion pipeline
- The Python reference implementation (`mvp-python/`)
- CI/CD workflows (`.github/workflows/`)

### Out of scope

The following are **known limitations** already documented in
[`web-app/docs/security/SECURITY_EXCEPTIONS.md`](web-app/docs/security/SECURITY_EXCEPTIONS.md),
not treated as new findings:

- **Per-instance rate limiting** — `RateLimiter` and `CircuitBreaker` are
  in-process; on serverless deployments they reset per cold start. Mitigation
  requires `UPSTASH_REDIS_URL` to be configured (see `.env.example`).
- **LLM-based guardrail** — the domain/safety guardrail uses an
  instruction-following LLM. A crafted adversarial prompt can still manipulate
  the YES/NO classification verdict. A fine-tuned classifier is the roadmapped
  fix.
- **DuckDuckGo web-search fallback** — an unofficial scraper that may break
  without notice. Not considered a security boundary.
- Vulnerabilities in third-party packages not yet published in a CVE advisory.
- Social engineering or phishing attacks targeting maintainers.

---

## Security Architecture Highlights

These are existing controls. Report findings that bypass them.

| Control | What it protects |
| ------- | ---------------- |
| Parameterized SQL (`Prisma.sql`) everywhere | SQL injection |
| PII masking (`src/server/pii/masker.ts`) before any LLM call | User personal data leakage to external APIs |
| Principle-of-least-privilege DB roles (`behoerden_app` = DML only) | Accidental destructive DB operations |
| Zod schema validation on all tRPC inputs | Malformed input / type confusion |
| Gitleaks + Semgrep + CodeQL in CI | Secret leakage, SAST vulnerabilities |
| CSP nonce on all HTML responses | XSS |
| Auth.js v5 JWT sessions + CSRF protection | Session hijacking |
| Upstash Redis rate limiting (production) | Denial-of-service via chat endpoint |
| `SECURITY_EXCEPTIONS.md` tracks all accepted risks with justification | Informed risk management |

---

## Disclosure Policy

This project follows **coordinated disclosure**:

1. Reporter sends a private report.
2. Maintainer confirms, investigates, and develops a fix.
3. Fix is shipped to `main`.
4. Reporter is credited in the release notes (unless they prefer anonymity).
5. A public advisory is posted after the fix is available.

We ask reporters to give us reasonable time to fix an issue before any public
disclosure. We commit to the timelines above and will not take legal action
against good-faith security researchers acting within this policy.

---

## Acknowledgements

Security researchers who responsibly disclose valid vulnerabilities will be
credited in [`CHANGELOG.md`](CHANGELOG.md) (web-app section) with their
preferred name or handle, unless they request anonymity.

---

*Last updated: 2026-08-04*
