# Semgrep Findings Backlog

**Source:** `.github/workflows/security-web-app.yml` → SAST (Semgrep) job
`semgrep scan --config=auto --error` (excludes `.next`, `node_modules`, `coverage`).
**Audit date:** 2026-08-05 (semgrep 1.136.0, re-run locally with the exact CI command).
**Total:** 28 findings — **28 WARNING, 0 ERROR, 0 CRITICAL.**
**Verdict:** 0 exploitable vulnerabilities. 22 are CI-hygiene (fixable, mechanical);
2 are legacy-Python/app config worth a 15-minute fix; 4 are provable non-issues (suppress).

> This gate fails CI solely because of `--error` on WARNINGs. Gitleaks, CodeQL, and
> SBOM all pass. See `SECURITY_EXCEPTIONS.md` for the general exception log.

---

## Summary by rule

| Rule | Count | Severity | Verdict |
|---|---|---|---|
| `github-actions-mutable-action-tag` | 22 | WARNING | **FIX** — SHA-pin actions (mechanical) |
| `wildcard-cors` | 1 | WARNING | **FIX** — scope origins (low risk today) |
| `no-new-privileges` | 1 | WARNING | **SUPPRESS** — dev-only legacy compose |
| `writable-filesystem-service` | 1 | WARNING | **SUPPRESS** — dev-only legacy compose |
| `automatic-memory-pinning` | 1 | WARNING | **SUPPRESS** — performance heuristic, not security |
| `raw-html-format` (XSS) | 1 | WARNING | **SUPPRESS** — false positive (verified) |
| `detect-non-literal-regexp` (ReDoS) | 1 | WARNING | **SUPPRESS** — false positive (verified) |

---

## 1. `github-actions-mutable-action-tag` — 22 findings → FIX

Pin every `uses:` reference to a full commit SHA (`<owner>/<repo>@<40-hex-sha>`)
instead of a mutable tag (`@v4`), so a repointed tag can't silently change what CI
runs. Mechanical, scriptable, ~15 minutes. Each `uses:` line below also gains the
`# vX.y.z` comment after the SHA for readability.

| # | File:Line | Action |
|---|---|---|
| 1 | `.github/workflows/ci-web-app.yml:35` | `actions/checkout@v4` → SHA |
| 2 | `.github/workflows/ci-web-app.yml:38` | `pnpm/action-setup@v4` → SHA |
| 3 | `.github/workflows/ci-web-app.yml:45` | `actions/setup-node@v4` → SHA |
| 4 | `.github/workflows/deploy-web-app.yml:19` | `actions/checkout@v4` → SHA |
| 5 | `.github/workflows/deploy-web-app.yml:22` | `amondnet/vercel-action@v20` → SHA |
| 6 | `.github/workflows/e2e-web-app.yml:48` | `actions/checkout@v4` → SHA |
| 7 | `.github/workflows/e2e-web-app.yml:51` | `pnpm/action-setup@v4` → SHA |
| 8 | `.github/workflows/e2e-web-app.yml:58` | `actions/setup-node@v4` → SHA |
| 9 | `.github/workflows/e2e-web-app.yml:81` | `actions/upload-artifact@v4` → SHA |
| 10 | `.github/workflows/rag_eval_ci.yml:15` | `actions/checkout@v4` → SHA |
| 11 | `.github/workflows/rag_eval_ci.yml:18` | `actions/setup-python@v5` → SHA |
| 12 | `.github/workflows/security-web-app.yml:28` | `actions/checkout@v4` → SHA |
| 13 | `.github/workflows/security-web-app.yml:33` | `gitleaks/gitleaks-action@v2` → SHA |
| 14 | `.github/workflows/security-web-app.yml:45` | `actions/checkout@v4` → SHA |
| 15 | `.github/workflows/security-web-app.yml:59` | `actions/checkout@v4` → SHA |
| 16 | `.github/workflows/security-web-app.yml:62` | `github/codeql-action/init@v3` → SHA |
| 17 | `.github/workflows/security-web-app.yml:68` | `github/codeql-action/init@v3` → SHA |
| 18 | `.github/workflows/security-web-app.yml:71` | `github/codeql-action/autobuild@v3` → SHA |
| 19 | `.github/workflows/security-web-app.yml:78` | `github/codeql-action/analyze@v3` → SHA |
| 20 | `.github/workflows/security-web-app.yml:81` | `actions/checkout@v4` → SHA |
| 21 | `.github/workflows/security-web-app.yml:88` | `anchore/sbom-action@v0` → SHA |
| 22 | `.github/workflows/security-web-app.yml:99` | `actions/upload-artifact@v4` → SHA |

**Owner:** CI hygiene. Blocks nothing today; resolves 22 of 28 findings in one commit.

---

## 2. `wildcard-cors` — `api.py:34` → FIX (low risk)

```python
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, ...)
```

- **Risk:** wildcard `*` + `allow_credentials=True` is a genuinely bad combination
  *if* the endpoint relies on cookie/session auth. The legacy Python API
  (`api.py`, Streamlit-era 3-Agent RAG backend) authenticates via Bearer token or
  is public; the shipped product is the Next.js web-app, not this API.
- **Decision:** scope to known origins (e.g. the Streamlit host) or drop
  `allow_credentials` and keep `*`. Either removes the finding and hardens the
  legacy API for ~5 minutes. **Owner:** legacy-Python maintainer.

---

## 3. `no-new-privileges` + `writable-filesystem-service` — `docker-compose.yml:4` → SUPPRESS

Both flag the root **legacy** compose's `postgres` service (the `ankane/pgvector`
dev container used by the Python pipeline — documented in
`../../../docs/Postgres_Docker_Setup.md`). It is a **local dev-only** database with a
bind-mounted volume; `read_only: true` / `no-new-privileges: true` on a
dev database container carrying a writable volume is low-value hardening that can
cause spurious boot failures. Not reachable from the web-app or production.

**Action:** add `nosemgrep` comments or a `.semgrepignore` entry for
`docker-compose.yml`; optionally carry the flags forward when the web-app compose
is ever productionized.

---

## 4. `automatic-memory-pinning` — `src/finetune_embeddings.py:134` → SUPPRESS

`DataLoader(..., pin_memory=...)` heuristic from trailofbits — a **performance**
rule about explicit `pin_memory=True`, **not a security vulnerability**. The
fine-tuning script is an offline dev tool. Add `nosemgrep` or ignore the rule.

---

## 5. `raw-html-format` (XSS) — `web-app/src/components/admin/top-questions.tsx:33` → SUPPRESS (false positive)

Verified against source: `question.query` flows into a React `key` prop
(`key={`${question.query}-${index}`}`) and is rendered **only as a text child**
(`<span>{question.query}</span>`). There is **no `dangerouslySetInnerHTML`**
anywhere in the component; React escapes text children by default. The rule
misfired on the template-literal `key`. **No XSS path exists.**

**Action:** `// nosemgrep: raw-html-format` on line 33, or leave as documented
noise. Do not change the code.

---

## 6. `detect-non-literal-regexp` (ReDoS) — `web-app/src/components/sources/source-browser.tsx:46` → SUPPRESS (false positive)

Verified against source: the user query is run through the canonical
regex-escaper **before** interpolation:

```ts
const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const parts = text.split(new RegExp(`(${escaped})`, "ig"));
```

The resulting pattern is a plain literal — linear-time matching, no catastrophic
backtracking possible. This is the standard safe highlight-query pattern.

**Action:** `// nosemgrep: detect-non-literal-regexp` on line 46, or leave as
documented noise. Do not change the code.

---

## Recommendation

1. **Do the 22 SHA-pins + `api.py` CORS scoping** — one mechanical commit turns
   the security workflow green and removes 23 findings.
2. **Add `nosemgrep` annotations** for the 4 provably-safe/performance findings
   (or `.semgrepignore`) to zero the remaining 5 without hiding real bugs.
3. If neither is done immediately: keep this file as the tracked backlog; the gate
   stays red but **nothing in these findings blocks shipping** (all WARNING, no
   exploitable path).

## Repro

```bash
python3 -m venv /tmp/semgrep-venv && /tmp/semgrep-venv/bin/pip install semgrep
cd /path/to/repo && /tmp/semgrep-venv/bin/semgrep scan --config=auto --error \
  --exclude=web-app/.next --exclude=web-app/node_modules --exclude=web-app/coverage
```
