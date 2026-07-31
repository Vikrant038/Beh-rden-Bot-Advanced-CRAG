# 📦 Module 1: CI Verification (The "Verify" Gate)

**Purpose:** To transform the CI pipeline from a "notification system" into a "quality wall." The AI's role is to ensure that no code reaches the `main` or `develop` branches without absolute verification. The AI is the owner of the pipeline and is responsible for its health.

## Document Precedence Hierarchy

When conflicts arise between governing documents, apply this order:

1. **`GUARDRAILS.md`** (Security & Risk) – ALWAYS takes precedence
2. **`PIPELINE_OPS.md`** (This document – Deployment & Operations)
3. **`CODING_STANDARDS.md`** (Style & Architecture)

**Example:** If `CODING_STANDARDS.md` recommends a pattern that `GUARDRAILS.md` flags as insecure, `GUARDRAILS.md` wins.

**Conflict Resolution:** When unsure, output:
```text
@ai-blocked: Document conflict detected between [Doc A] and [Doc B].
Description: [Specific conflict].
Human resolution required.
```
---

### 1.1 GitHub Actions YAML Ownership
The AI is the primary maintainer of the `.github/workflows/` directory.
*   **The Rule:** No manual, undocumented changes to the pipeline. Every change to the CI/CD flow must be treated as a "Feature" and documented in a PR.
*   **Structure Requirement:** Workflows must be modularized.
    *   `ci.yml` $\rightarrow$ Linting, Type-checking, Unit Tests.
    *   `security.yml` $\rightarrow$ SAST, SCA, Secret Scanning.
    *   `e2e.yml` $\rightarrow$ Playwright/Cypress tests in staging.
*   **AI Action:** When asked to "set up the pipeline," the AI must generate separate YAML files for each stage to prevent a single "God-workflow" that is hard to debug.

### 1.2 The "Failure Analysis" Protocol (Log-to-Fix Loop)

When a CI build fails, the AI must not guess the fix. It must follow a **Forensic Analysis** process using deterministic pattern matching.

- **Trigger:** A GitHub Action returns a `failed` status.
- **Mandatory Analysis Path:**

**Step 1: Identify the Stage**
Scan the log for `##[group]Run` or `Job: [Name]` to find which job failed (e.g., `Lint`, `Unit-Test`, `SAST`).

**Step 2: Locate the Error**
Search the logs for the first instance of these patterns (in order):
- `ERROR`
- `FAILED`
- `EXCEPTION`
- `TS[0-9]+:` (TypeScript error)
- `AssertionError`

**Step 3: Categorize the Failure Using Regex Patterns**

| Category | Regex Pattern | Action |
| :--- | :--- | :--- |
| **Transient Network** | `ETIMEDOUT|ECONNRESET|429|rate limit|ECONNREFUSED` | Do not modify code → Suggest re-run (per 1.5) |
| **TypeScript Error** | `/TS[0-9]{4,5}:.*error TS[0-9]+:/` | Fix type mismatch |
| **Lint Error** | `error.*eslint` or `[ERROR] lint` | Fix linting rule violation |
| **Test Assertion** | `Expected:.*\nReceived:.*` or `AssertionError:` | Fix logic in code (never change expected value) |
| **Missing Secret** | `process\.env\.[A-Z_]+ is undefined` | Output deployment checklist (per 3.2) |
| **Guardrail Violation** | `SAST\|SCA\|CodeQL found (High\|Critical) severity` | Fix vulnerability or document exception |
| **Unknown** | None of the above match | Output `@ai-blocked: Unknown CI Failure` + raw snippet. **DO NOT GUESS.** |
| **E2E Timeout** | `TimeoutError:.*exceeded.*timeout\|waiting for selector.*timed out` | Check selector existence, increase timeout, or fix race condition |
| **E2E Element Missing** | `Error: locator.*: Target closed\|Error:.*not found` | Verify page state, check for dynamic content loading |
| **Visual Regression** | `Screenshot comparison failed\|toMatchSnapshot` | Update baseline if intentional, fix CSS if regression |

**Step 4: AI Output Format**
> "Analyzing CI logs... **Stage:** [Stage Name] | **Error:** [Error Message] | **Category:** [Category]. I am now implementing the fix."

**Step 5: Retry Limit (see 1.7 below)**

### 1.3 The "Anti-Cheating" Rule (Test Integrity)
A common AI failure is "fixing the test to pass the code" rather than "fixing the code to pass the test."
*   **The Forbidden Pattern:**
    *   Commenting out a failing test to make the build green.
    *   Changing the expected result in a test to match a buggy output.
    *   Using `it.skip` or `describe.skip` to bypass a failure in the `develop` or `main` branches.
*   **The Requirement:** Every failing test must result in a code change or a documented update to the requirement (via the Gherkin process in `CODING_STANDARDS.md`).
*   **AI Action:** If the AI suggests skipping a test, it must provide a `// @test-skip: [Reason]` comment and a linked issue/ticket for the fix.

### 1.4 CI-Driven Development (CDD)
The AI must treat the CI as the "Definition of Done."
*   **The Rule:** A feature is not "finished" when the code is written; it is finished when the **Pipeline is Green**.
*   **Verification Loop:**
    `Write Code` $\rightarrow$ `Local Test` $\rightarrow$ `Push` $\rightarrow$ `Check CI` $\rightarrow$ `Fix CI` $\rightarrow$ `Done`.
*   **AI Action:** After proposing a fix for a bug, the AI must remind the user: *"Please push this change and verify that the GitHub Action for [Specific Job] now passes."*

### 1.5 Transient Failure Retry Policy
**Trigger:** CI log contains `ETIMEDOUT`, `ECONNRESET`, `429`, or `rate limit`.
**AI Action:** Do not modify code. Respond: *“Transient error detected. I recommend re‑running the failed job. If the error persists, I will investigate further.”*

### 1.6 CI Performance Optimization (Cache Strategy)

**The Rule:** Every workflow that runs `npm install` or builds the application MUST implement intelligent caching.

**Mandatory Cache Keys:**
- `node_modules`: Cache key = `hash(package-lock.json)`
- Next.js build: Cache `.next/cache` directory with key = `hash('nextjs', runner.os, hashFiles('**/*.{js,ts,tsx}'))`
- Playwright browsers: Cache key = `hash(playwright-version)`

**
**Forbidden Pattern**: Using a static cache key (e.g., node-modules-v1) that never invalidates, leading to stale dependencies.

**Cache Invalidation Trigger**: Any change to package-lock.json, yarn.lock, or pnpm-lock.yaml MUST generate a new cache key.

### 1.7 AI Fix Retry Limit & Escalation

**Purpose:** To prevent infinite "fix → push → fail → fix" loops when the AI cannot resolve a CI failure.

**The Rule:** After **2 consecutive failed fix attempts** on the same CI failure (same error signature), the AI MUST stop and escalate.

**Failure Signature:** Normalized error message (remove line numbers, timestamps, variable values).

**AI Action Flow:**
1. **Attempt 1:** Analyze log → Propose fix → User pushes → CI re-runs.
2. **If CI fails again with same signature:** Attempt 2 – different fix strategy.
3. **If CI fails again with same signature:** Output:

```text
@ai-blocked: Persistent CI Failure (2 attempts exhausted)

Error signature: [Normalized error message]
Attempted fixes:
- Fix 1: [Description]
- Fix 2: [Description]

Recommendation: [Suggest manual intervention, e.g., "Check if a recent dependency update broke compatibility" or "This may be a flaky test – quarantine manually."]
```
**After outputting** @ai-blocked: **HALT**. Do not propose further fixes for this failure. Wait for human unblock (@ai-unblock).

**Exception**: If the failure is categorized as **Transient Network** (per 1.2), retry up to 3 times before escalating.

### 1.8 Flaky Test Management Protocol

**Purpose:** Prevent CI noise from non‑deterministic test failures.

**Trigger:** The same test fails non‑deterministically (passes on retry without code changes) **3+ times within 7 days**.

**Detection Patterns:**
- Test passes on local run but fails in CI
- Test passes on CI retry without any code change
- Failure stack trace varies (e.g., timeout, race condition, network hiccup)

**AI Action:**

1. **Quarantine the test** by adding `.skip` (or equivalent) with a structured comment. The AI MUST modify the test file directly:
   - Locate the test file using the failure stack trace.
   - Identify the exact test block by matching the test name.
   - Apply this exact pattern:
     ```typescript
     // BEFORE:
     it('should not login with wrong password', async () => { ... });
     
     // AFTER:
     // @flaky-quarantine: [TICKET-ID] | YYYY-MM-DD | Owner: @team | Pattern: [Timeout/Race/Network]
     it.skip('should not login with wrong password', async () => { ... });
Commit the change with message: test: quarantine flaky test [test name] ([TICKET-ID])

Forbidden: Outputting "I have quarantined" without actually modifying the test file.

2. **Update the flaky test registry** at ./docs/ci/FLAKY_TESTS.md with this exact table row:

| Test File | Test Name | Failure Pattern | Quarantine Date | Ticket | Status |
|-----------|-----------|-----------------|-----------------|--------|--------|
| `auth.test.ts` | `should not login with wrong password` | Timeout after 2s | 2024-01-15 | TICKET-123 | Quarantined |

3. **Output**: *"Flaky test detected: [Test Name]. I have quarantined it and logged in FLAKY_TESTS.md. The pipeline will remain green while the team investigates. Ticket [TICKET-123] created."*

**Forbidden Pattern**: Silently removing .skip without verifying the flakiness is resolved.

**Escalation**: If a quarantined test remains unresolved for >30 days, output reminder: *"Flaky test [Name] quarantined for 30+ days. Recommend permanent removal or fix."*

**Note:** This `@flaky-quarantine` format is the **single source of truth** for test quarantine annotations. `CODING_STANDARDS.md` Pillar 7.6 defers to this module.

---

# 📦 Module 2: Security Scanning & Vulnerability Triage

**Purpose:** To ensure that security scans (SAST, SCA, Secret Scanning) do not become "background noise." The AI must proactively manage vulnerabilities, triage them based on the Risk Profile, and execute a safe remediation process that does not break the application.

---

### 2.1 The Vulnerability Triage Protocol (SCA & SAST)
When a security tool (Snyk, Dependabot, CodeQL, SonarQube) flags an issue, the AI must not blindly apply a fix. It must perform a **Contextual Risk Assessment**.

*   **The Rule:** Every vulnerability must be triaged using the following logic:
    1. **Reachability Analysis:** Is the vulnerable function actually called in our code?
    2. **Environmental Context:** Is the vulnerability in a `devDependency` (Low Risk) or a `production` dependency (High Risk)?
    3. **Exploitability:** Is there a known public exploit (PoC) for this CVE?
**Reachability Analysis Implementation (How the AI determines if a vulnerability is reachable):**

The AI must use available signals in this order:

| Signal | Method | Conclusion |
|--------|--------|------------|
| **Static Analysis Data Flow** | If CodeQL/Semgrep reported the finding with a data-flow path (e.g., from `req.body` to `eval`), the vulnerability IS reachable. | ✅ Reachable – block build |
| **Import/Require Presence** | Grep codebase for the vulnerable package name and function. If found in production code paths, vulnerability is LIKELY reachable. | ⚠️ Likely reachable – treat as reachable |
| **DevDependency Only** | Package is only in `devDependencies` AND not imported in any production file (including dynamic `require()`). | ❌ Unreachable – downgrade severity |
| **No Signal** | No data flow, no import, but package is a production dependency. | ❓ Unknown – treat as reachable (conservative) |

**Fallback Rule:** If the AI cannot definitively verify reachability via the signals above (e.g., context window does not contain full repository import map), it **MUST default to `UNKNOWN → Treat as Reachable`** to prevent security regression.

**AI Action Output Example:**
```text
Reachability: YES (CodeQL data-flow path from `req.body.input` to `eval()`). Blocking build.
Reachability: UNKNOWN (no data flow, but package imported in `auth.ts`). Treating as reachable per conservative security posture.
```
*   **The Action Matrix (SCA/SAST):**

| Finding Severity | Action | Pipeline State | AI Response |
| :--- | :--- | :--- | :--- |
| **Critical / High** | **Immediate Fix** | ❌ Block Build | "Critical vulnerability found in [Package]. Blocking build. Implementing fix now." |
| **Medium** | **Scheduled Fix** | ✅ Pass Build | "Medium risk found in [Package]. I have created a ticket for the next sprint." |
| **Low / Info** | **Log & Monitor** | ✅ Pass Build | "Low risk identified. Logged in technical debt." |

> **Severity mapping:** Refer to `GUARDRAILS.md` Module 4.2 for tool‑specific severity levels (Semgrep `error` = block, etc.).

**AI Action:** When a vulnerability is reported, the AI must output: *"Vulnerability Triage: [CVE-ID] | Severity: [High/Med/Low] | Reachable: [Yes/No] | Action: [Block/Warn]."*

---

### 2.2 The "Safe Update" Protocol (SCA Remediation)
Updating a package to fix a vulnerability often introduces "Breaking Changes" that crash the site. The AI must follow a **Safe-Update Loop**.

*   **The Forbidden Pattern:** Running `npm update` or `npm install package@latest` without verification.
*   **The Mandatory Safe-Update Loop:**
    1. **Version Diff:** Compare the current version with the fixed version. Check the `CHANGELOG` for breaking changes.
    2. **Isolated Update:** Update only the specific vulnerable package (`npm install package@version --save-exact`).
    3. **Regression Test:** Wait for the CI pipeline on the update PR to complete and verify that the Unit/Integration/E2E stages pass. $\rightarrow$ Integration Tests $\rightarrow$ E2E Tests.
    4. **Verify Fix:** Re-run the security scan to confirm the CVE is gone.
*   **AI Action:** When updating a dependency, the AI must state: *"Updating [Package] from v1.2 to v1.3 to fix CVE-XXX. I have checked the changelog for breaking changes and will now run the E2E suite to verify stability."*

---

### 2.3 Secret Scanning & Leak Remediation
A "Secret Found" alert is a **P0 Emergency**. If a secret is committed to Git, changing the password is not enough; the history is compromised.

*   **The Rule:** If Gitleaks or TruffleHog flags a secret in a commit, the AI must treat the secret as **publicly compromised**.
*   **The Remediation Protocol:**
    1. **Invalidate:** Immediately instruct the human to rotate (change) the secret in the cloud provider.
    2. **Purge:** Use a tool like `BFG Repo-Cleaner` or `git filter-repo` to scrub the secret from the entire Git history.
    3. **Verify:** Re-run the secret scan on the cleaned history.
    4. **Secure:** Ensure the new secret is placed in the Secret Manager (per `GUARDRAILS.md` 1.4).
*   **AI Action:** Upon detecting a secret leak, the AI must stop all other work and output: *"🚨 SECURITY EMERGENCY: Secret leaked in commit [Hash]. STOP. Rotate the secret immediately. I will now provide the commands to purge the Git history."*

---

### 2.4 False Positive Management (Linking to Governance)
Not every "High" finding is a real risk. To prevent the pipeline from being blocked by "Ghost" vulnerabilities, the AI must manage exceptions.

*   **The Rule:** No security warning shall be silenced via code comments (`// eslint-disable`) without an entry in the official log.
*   **The Process:**
    1. AI identifies a False Positive (e.g., a "Critical" warning on a function that is only used in a local test script).
    2. AI proposes a bypass.
    3. AI generates a Markdown entry for `./docs/security/SECURITY_EXCEPTIONS.md` (as per `CODING_STANDARDS.md` / `GUARDRAILS.md` Module 5).
    
**Required Format for SECURITY_EXCEPTIONS.md:**
| Date | Tool | CVE/Rule ID | File/Line | Reason for Exception | Expiration Date | Approver |
|---|---|---|---|---|---|---|
| YYYY-MM-DD | CodeQL | js/sql-injection | src/lib/legacy.ts:42 | False Positive: Input is from an internal, hardcoded config file, not user-controlled. | YYYY-MM-DD | [Pending] |
*   **AI Action:** When bypassing a security flag, the AI must say: *"This is a false positive because [Reason]. I am adding this to `SECURITY_EXCEPTIONS.md` for human sign-off."*

### 2.5 Major Upgrade Approval
**Trigger:** Fixing a CVE requires a major version bump (e.g., `v1.x → v2.x`).
**AI Action:** Do not automatically upgrade. Output: *“⚠️ Breaking change required. I have tested the upgrade and listed the breaking changes. Human approval required before merging.”* Wait for `@ai-unblock` or explicit approval.

### 2.6 Dependency Confusion & Typosquatting Defense

**The Rule:** The AI must validate that newly added dependencies are from legitimate sources.

**Detection Triggers:**
- Package name is a **typosquat** of a popular package (e.g., `lodas` vs `lodash`, `react-dom` vs `react_dom`)
- Package is **new** (published < 30 days ago) and has low download count
- Package is from a **scoped registry** without explicit approval (`@company/package`)

**AI Action:** Before adding any new dependency, output: *"Dependency Check: Adding [package-name] v[X.X.X]. Published: [Date]. Weekly Downloads: [Count]. Maintainer: [Name]. This appears [legitimate/suspicious]. [If suspicious] I recommend reviewing this package manually before installation."*

**Pipeline Integration:** Add a `dependency-review` GitHub Action to flag suspicious packages on PR.

**Example Workflow Step:**
```yaml
- name: Dependency Review
  uses: actions/dependency-review-action@v4
  with:
    fail-on-severity: high
```

### 2.7 Pipeline Block Override Protocol

**Trigger:** A pipeline is blocked by a security tool, but the AI has triaged the finding as `Medium` or `Low` or `False Positive` (per Module 2.1).

**AI Action:** The AI MUST provide the **exact command or configuration** to bypass the block while maintaining an audit trail:

*"The pipeline is blocked by a Medium severity finding. Per Module 2.1, this should NOT block the build. To bypass temporarily (with audit log):*
```bash
# For CodeQL
echo "MEDIUM_FINDING_EXCEPTION: CWE-123 in test file" >> .github/codeql-exceptions.txt
git commit -m "docs: document CodeQL exception for CWE-123"
```
I have added this to SECURITY_EXCEPTIONS.md. Human sign‑off required in PR."

**Forbidden Pattern**: Silently modifying the pipeline YAML to disable the security check without documenting the exception.

### 2.8 SBOM Generation & Attestation

**The Rule:** Every production build MUST generate an SBOM in CycloneDX or SPDX format.

**Implementation (GitHub Actions):**
```yaml
# In security.yml
- name: Generate SBOM
  uses: anchore/sbom-action@v0
  with:
    format: cyclonedx-json
    output-file: ./sbom.json
```
**AI Action**: The AI must ensure the SBOM is uploaded as a build artifact and retained for 90+ days per compliance requirements.

**Compliance Note**: Required for FedRAMP, EU Cyber Resilience Act, and many enterprise security policies.

### 2.9 Severity Normalization Table

**Purpose:** Different security tools use different severity scales. This table maps all tools to a unified `Block` / `Warn` / `Info` classification.

| Normalized Severity | Snyk | CodeQL | Semgrep | Trivy | Dependabot | Action |
|---------------------|------|--------|---------|-------|------------|--------|
| **Block** | `critical`, `high` | `error` | `error` | `CRITICAL`, `HIGH` | `critical`, `high` | ❌ Fail build |
| **Warn** | `medium` | `warning` | `warning` | `MEDIUM` | `medium` | ✅ Pass, create ticket |
| **Info** | `low` | `note` | `info` | `LOW`, `UNKNOWN` | `low` | ✅ Pass, log only |

**AI Action:** Before applying the triage matrix (2.1), map the tool’s severity to this normalized scale. Output: *"Normalized severity: [Block/Warn/Info] (original: [Tool] [Severity])."*
---

# 📦 Module 3: Deployment & Orchestration (The "Deploy" Gate)

**Purpose:** To eliminate the "Deployment Gap"—the space between code that works on a developer's laptop and code that works in a production environment. The AI must ensure that the transition from a Git commit to a live URL is seamless, verified, and reversible. 

The AI's role is to manage the **orchestration**, ensuring that environment variables are synchronized, build logs are analyzed, and the "Live" state is verified before the deployment is considered successful.

---

### 3.1 Environment Tiering & Promotion Logic
The AI must distinguish between the three main environment states to prevent "Experimental" code from ever hitting "Production."

*   **The Environment Hierarchy:**
    1.  **Preview (Ephemeral):** Generated for every Pull Request. Used for stakeholder review and E2E testing.
    2.  **Staging (Pre-Prod):** A mirror of production. Used for final DAST scans and Load Testing.
    3.  **Production (Live):** The customer-facing environment. Only accessible via a merge to `main`.

*   **The Promotion Rule:** Code cannot move to the next tier unless the current tier is "Green."
    *   `Preview` $\rightarrow$ `Staging` $\rightarrow$ `Production`.
*   **AI Action:** When a user asks to deploy, the AI must identify the target environment. If the target is `Production`, the AI must verify: *"I see this is a production deploy. Have the Staging E2E tests and DAST scans passed?"*

**CI Strictness by Tier:** For `Prototype` tier projects (as defined in `GUARDRAILS.md`), the CI gates (SAST, E2E, Coverage) may be configured as **advisory warnings** rather than **blocking failures**. The AI should note this exception when generating pipeline configuration for Prototype projects.

### 3.1.1 Artifact Promotion Policy (Build Once, Deploy Many)

**The Rule:** The same build artifact must be promoted through environments. Rebuilding at each stage is forbidden.

**Implementation by Platform:**
- **Docker/Container:** Build image once, tag with commit SHA. Promote by retagging (`staging` → `production`).
- **Vercel:** Use `vercel promote` to reuse a preview deployment for production.
- **AWS Lambda:** Upload ZIP once; deploy same object to staging and production aliases.

**AI Action (Pre-Deployment):** *"Verifying artifact promotion: This deployment uses commit SHA [sha] built at [timestamp]. The same artifact will be promoted to production (not rebuilt)."*

### 3.2 Secret & Environment Variable Synchronization
The most common cause of "Deployment Failures" is a missing environment variable in the cloud dashboard.

*   **The Sync Requirement:** Whenever the AI modifies a `.env.example` or suggests a new secret, it must trigger a **Sync Check**.
*   **The Forbidden Pattern:** Assuming the cloud environment is already updated.
*   **The Sync Protocol:**
    1. **Identify:** List all new or modified variables in the current feature.
    2. **Alert:** Notify the user explicitly: *"I have added `STRIPE_WEBHOOK_SECRET` to the code. You MUST add this to the Vercel/Cloud dashboard before deploying."*
    3. **Verify:** If the AI has access to the deployment logs and sees a `process.env.VARIABLE is undefined` error, it must immediately flag the missing secret.
*   **AI Action:** After every feature implementation that involves environment variables, the AI must output a **"Deployment Checklist"** containing the exact keys that need to be added to the cloud provider.

### 3.3 The "Build-Failure" Forensic Loop
When a deployment fails during the "Build" phase (e.g., Vercel Build Error), the AI must analyze the log to find the root cause.

*   **The Analysis Path:**
    1. **Type Error:** If the build fails on `tsc`, the AI must find the specific file/line and propose a type-fix.
    2. **Dependency Error:** If the build fails on `npm install`, the AI must check for version conflicts or missing peer dependencies.
    3. **Linting Block:** If the build fails due to `eslint` (as per Module 4.1), the AI must fix the linting error.
*   **AI Action:** If the user pastes a build log, the AI must not suggest "trying again." It must output: *"Build failure detected in the [Build/Install/Lint] stage. The error is [Error Message]. I am fixing the code to resolve this."*

### 3.4 Deployment Verification (The "Smoke Test")
A "Successful Deployment" is not defined by the cloud provider's "Green Checkmark," but by the application's actual behavior.

*   **The Rule:** No deployment is "Done" until the **Smoke Test** passes.
*   **The Verification Loop:**
    1. **Connectivity Check:** Call the `/health` endpoint (from `GUARDRAILS.md` 4.5).
    2. **Critical Path Check:** Verify that the main landing page loads and the login API returns a `200`.
    3. **Log Monitoring:** Monitor the production logs for the first 60 seconds for any `500 Internal Server Errors`.
*   **AI Action:** After a deployment is triggered, the AI must suggest: *"Deployment is live. I am now verifying the /health endpoint and monitoring logs for errors. Please confirm the UI is behaving as expected."*

### 3.5 The Rollback Protocol (Zero‑Downtime Recovery)

When a "Green" deployment causes a production outage (Regression), the AI must prioritize **Recovery over Debugging**.

*   **The Rule:** "Roll back first, debug second."
*   **The Protocol:**
    1. **Immediate Action:** Trigger an instant rollback to the previous stable deployment ID (e.g., Vercel Instant Rollback).
    2. **Rollback Safety Check (CVE Verification):**
Before executing rollback, verify the rollback target does not contain known critical CVEs that were patched in the failed deployment.
**AI Action:** The AI cannot run `npm audit` on arbitrary commits. Instead, output the command for the user:
```text
⚠️ Rollback target may reintroduce vulnerabilities. Please run:
`git checkout <rollback-sha> && npm audit --json | grep -E '"severity":"(critical|high)"'`
```
If critical CVEs are found, consider fixing forward instead of rolling back.
**Integration with HITL (`@ai-blocked`):**
- If the rollback target contains a **Critical CVE** that was patched in the failed deployment, the AI MUST NOT proceed with rollback.
- Output: `@ai-blocked: Rollback would reintroduce CVE-XXXX. Options: (1) Accept risk with override, (2) Fix forward with hotfix. Waiting for human decision (@ai-unblock).`
- Do not execute rollback without explicit `@ai-unblock` or human approval.

    3. **Isolation:** Create a new branch from the failed commit to reproduce the bug in a Preview environment.
    4. **RCA:** Perform a Root Cause Analysis (as per `CODING_STANDARDS.md` Pillar 5.3).
*   **AI Action:** If the user reports a production crash after a deploy, the AI must immediately respond: *"🚨 Production Outage. I recommend an immediate rollback to the previous stable version. Checking rollback target for security regressions..."*
### 3.5.1 Database Migration Rollback Protocol

**Trigger:** A rollback is initiated (via 3.5) and the deployment included a database migration.

**AI Action (Assessment):**

1. **Identify migration direction:** Check if migration has a `down` script (e.g., `.down.sql`, `downgrade()` method, or `down` migration in Alembic/Knex).
2. **Output assessment:**

**If migration has a reversible `down` script:**
```text
⚠️ This deployment included migration [Name]. Rolling back will execute the `down` migration.
⚠️ DATA LOSS WARNING: Rolling back may delete columns/tables created in this deployment.
Confirm data is either backed up or acceptable to lose before proceeding.
```
If migration does NOT have a reversible down script:
⚠️ CRITICAL: Migration [Name] has no `down` script.
Rolling back code without rolling back the database will cause schema mismatch errors.

Options:
1. Fix forward with a hotfix (RECOMMENDED)
2. Manual database intervention to revert schema
3. Deploy a new migration that reverts the changes

I recommend option 1. Shall I begin drafting a hotfix?

**Forbidden Pattern**: Initiating a rollback that includes migrations without assessing reversibility and data loss risk.
---

### 3.6 Preview Environment Lifecycle
**Trigger:** Pull request is merged or closed.
**AI Action:** Remind user: *“Preview environment for branch [branch] is no longer needed. Run `vercel --delete` or equivalent to clean up.”*

### 3.7 Deployment Freeze Window (Commercial Tier)
**Trigger:** Current time is within 2 hours of peak traffic (e.g., 9 AM – 11 AM or 2 PM – 4 PM local business hours).
**AI Action:** If a user requests deployment, warn: *“Peak hours – deploy only if urgent (e.g., security fix). Otherwise schedule for off‑peak. Continue? [y/N]”*

### 3.8 Progressive Delivery: Canary Deployments

**The Rule:** All production deployments MUST use a canary release pattern with automated traffic shifting and metric validation.

**Canary Stages:**

| Stage | Traffic % | Duration | Success Criteria | Failure Action |
|-------|-----------|----------|------------------|----------------|
| **Canary‑1** | 5% | 10 min | Error rate < 0.5%, p95 latency < baseline + 20% | Auto‑rollback |
| **Canary‑2** | 25% | 30 min | No new Sentry issues with >10 events | Auto‑rollback |
| **Canary‑3** | 100% | N/A | Manual approval gate | N/A |

**Metrics Monitored During Canary:**
- **Error Rate:** 5xx errors / total requests (from Datadog / CloudWatch / Sentry)
- **Latency:** p95 response time (from APM)
- **Sentry Issues:** New exceptions post‑deployment (fingerprint‑based)
- **Business Metrics:** Conversion rate, checkout completion (if applicable)

**AI Action (Pre‑Deployment):** Output: *"Initiating canary deployment. I will monitor error rates and latency for the next 10 minutes. If any metric exceeds the threshold, I will trigger an automatic rollback."*

**AI Action (During Canary):** Provide status updates every 2 minutes: *"Canary‑1 (5% traffic): Error rate 0.2%, latency p95 320ms (baseline: 310ms). ✅ Proceeding to Canary‑2."*

**AI Action (Anomaly Detected):** Output: *"🚨 CANARY FAILURE: Error rate spiked to 2.1% (threshold 0.5%). I have triggered an automatic rollback. Full analysis pending."*

**Platform‑Specific Implementation:**
- **Vercel:** Use separate projects for canary/staging with manual promotion (no native canary).
- **AWS:** Use CodeDeploy with `DeploymentConfigName: CodeDeployDefault.ECSCanary10Percent5Minutes`.
- **Kubernetes:** Use Argo Rollouts with `canary` strategy and AnalysisTemplate.

**Forbidden Pattern:** Deploying directly to 100% production traffic without a canary stage.

### 3.9 Database Migration Safety Check (Cross‑Reference)

**Trigger:** A deployment includes a database migration file (e.g., `/prisma/migrations/*.sql`, `/alembic/versions/*.py`).

**AI Action:** Before deploying to production, verify the migration complies with `GUARDRAILS.md` 6.1 (Zero‑Downtime Requirement).

**Compliance Check Output:**
- If migration is backward‑compatible (e.g., adding nullable column, creating new table): *"Migration safety check: ✅ COMPATIBLE. Proceeding with deployment."*
- If migration is destructive (e.g., `DROP COLUMN`, `RENAME COLUMN`, `ALTER TYPE`): *"⚠️ WARNING: Destructive migration detected. Per GUARDRAILS.md 6.1, this requires a two‑step deployment to avoid downtime. I recommend: (1) Deploy code that stops using the column, (2) Deploy migration to drop it. Would you like me to draft the transition plan?"*

**Forbidden Pattern:** Deploying a destructive migration without a two‑step plan or explicit human override (`@ai-unblock`).

### 3.10 Pre‑Deploy Performance Testing

**The Rule:** Before deploying a major feature or infrastructure change, run a load test to validate performance against baseline.

**Tooling:** k6, Artillery, or Locust.

**Baseline Comparison:**
- p95 latency must not increase by >20%
- Error rate must remain <0.1% under 2x expected peak load

**AI Action:** When a PR modifies performance‑critical code (database queries, API endpoints, caching layer), suggest: *"This change affects critical path performance. I recommend running a load test with k6 before merging. Shall I generate a test script?"*

### 3.11 Rollback Verification Protocol

**Trigger:** A rollback is initiated via the Rollback Protocol (3.5).

**Post‑Rollback Verification Steps:**

| Step | Check | Success Criteria | Failure Action |
|------|-------|------------------|----------------|
| 1 | Health endpoint | `/health` returns `200` within 10s (retry 3x) | `@ai-blocked` – manual intervention |
| 2 | Smoke test (critical path) | Login → dashboard → primary action returns `200` | Log error, do not block |
| 3 | Error rate monitor | Error rate returns to baseline (<0.5% or pre‑incident level) within 2 minutes | Raise alert, continue |
| 4 | Data integrity (if applicable) | Sanity query (e.g., row count, recent orders) returns expected values | `@ai-blocked` – possible corruption |

**AI Action Output (Success):**
```text
Rollback executed: [Failed Deployment ID] → [Previous Deployment ID]

Verification results:
✅ /health: 200 OK (latency: 45ms)
✅ Critical path: Login successful
✅ Error rate: 0.2% (baseline: 0.3%)
✅ Data integrity: No anomalies detected

Rollback successful. Proceeding to RCA protocol (CODING_STANDARDS.md 5.3).
```
**AI Action Output (Verification Failure)**:

@ai-blocked: Rollback verification failed at step [Step Name].

Details: [Error message or timeout]
The system may be in an inconsistent state.

Manual intervention required. DO NOT attempt further automated actions.

**Forbidden Pattern**: Assuming rollback succeeded without verification.

### 3.12 Environment Drift Detection

**Purpose:** Prevent the "works in staging, fails in production" problem.

**The Rule:** Before any production deployment, the AI must compare staging and production environment configurations.

**Detection Protocol (use available sources):**

| Resource | Compare Method | Drift Indicator |
|----------|----------------|------------------|
| Environment variables | Diff keys of `.env.staging` vs `.env.production` (or cloud dashboard) | Missing key, extra key, different value (for non‑secrets) |
| Runtime version | `node --version`, `python --version` in deployment logs | Version mismatch |
| Database schema | Compare migration history table | Different last migration ID |
| Infrastructure version | Check IaC state files (Terraform, CloudFormation) | Resource attribute drift |

**AI Action (Pre‑Production Deployment):**

Output a drift report:
```markdown
## Environment Drift Check: Staging → Production

| Resource | Staging | Production | Status | Action |
|----------|---------|------------|--------|--------|
| Node.js | 20.11.0 | 20.11.0 | ✅ Match | None |
| PostgreSQL | 15.4 | 15.6 | ⚠️ Drift | Consider upgrading staging first |
| ENV Keys | 24 keys | 23 keys | ⚠️ Missing | Add `ANALYTICS_KEY` to production |
| ENV Values (non‑secret) | `LOG_LEVEL=debug` | `LOG_LEVEL=info` | ⚠️ Drift | Evaluate if intentional |
**If drift detected**: Output:
"⚠️ Environment drift detected. Recommend synchronizing staging to match production (or vice versa) before deployment to prevent unexpected behavior. I have listed the differences above."

**If no drift**: Output:
"✅ Environment drift check passed. Staging and production configurations are aligned."

**Forbidden Pattern**: Deploying to production without checking environment drift.

**Automation Note**: The AI cannot directly access cloud dashboards. It relies on:

Environment variable files committed in repo (.env.staging.example, .env.production.example)

Deployment log snippets provided by the user

CI/CD output showing environment variable names (not values)

---
# 📦 Module 4: Runtime Monitoring & Post-Deploy

**Purpose:** A deployment is not "finished" once the code is live; it is only finished once it is **proven stable in production**. This module governs the "Day 2" operations. The AI transforms from a builder into a **Site Reliability Engineer (SRE)**, focusing on observability, error triage, and the continuous improvement of the system.

---
### 4.0 Monitoring Data Access Protocol

**The Rule:** The AI cannot directly access production monitoring APIs unless explicitly configured. The AI must operate in one of two modes:

**Mode 1: User-Provided Data (Default)**
- User pastes log snippets, error messages, or metric values.
- AI analyzes the provided data using patterns in this module.
- AI Action: *"I've analyzed the provided logs. [Findings]. If you can provide [specific additional data], I can refine the analysis."*

**Mode 2: GitHub Actions Integration (Optional)**
- Monitoring queries run as scheduled workflows; results committed to `./docs/monitoring/`.
- AI reads these files when analyzing state.

**AI Action (Always):** Before any monitoring analysis, state: *"Operating in Mode 1 (user‑provided data). Please provide logs or metrics to analyze."*

### 4.1 Error Tracking & Correlation (The "Sentry" Protocol)
The AI must not wait for a user to report a bug. It must proactively monitor the error-tracking system (e.g., Sentry, LogRocket, Honeybadger).

*   **The Rule:** Every production error must be treated as a "leak" in the guardrails.
*   **The Correlation Requirement:** The AI must use the `correlationId` (defined in `CODING_STANDARDS.md` Pillar 4.7) to trace an error from the frontend $\rightarrow$ backend $\rightarrow$ database logs.
*   **The Triage Flow:**
    1. **Detection:** Identify a new error in the tracker.
    2. **Correlation:** Find the `correlationId` and search the structured logs to see exactly what the user did before the crash.
    3. **Impact Analysis:** Is this affecting 1% of users or 100%?
    4. **Remediation:** Propose a fix or a rollback.
*   **AI Action:** When a production error is reported, the AI must ask for the `correlationId` and the Sentry stack trace, then output: *"I have traced this error to [Service Name] line [X]. The root cause is [Y]. I am drafting a fix."*

### 4.2 Health & Availability Monitoring

The AI must ensure the application is not just "up," but "healthy."

*   **The Health Check Standard:** The AI must monitor the `/health` endpoint (from `GUARDRAILS.md` 4.5).
*   **Deep Health Check Requirement:** The `/health` endpoint MUST include checks for critical dependencies, not just a simple 200 OK.

**Required `/health` Response Format:**
```json
{
  "status": "healthy",
  "checks": {
    "database": {"status": "up", "latency_ms": 8},
    "cache": {"status": "up", "latency_ms": 2},
    "stripe_api": {"status": "up", "latency_ms": 450},
    "auth0": {"status": "up", "latency_ms": 120}
  }
}
```
The **"Degraded State"** Detection:

**Healthy**: 200 OK, all dependency checks pass within thresholds (<1000ms each).

**Degraded**: 200 OK but with a warning (e.g., "Database connection slow," "Redis cache offline," "Stripe API >1000ms").

**Unhealthy**: 503 Service Unavailable (Critical system failure, e.g., database unreachable).

**AI Action**: If the AI is integrated with monitoring alerts, it must automatically categorize the failure: "The system is in a **Degraded State**. The API is responding, but the Stripe API dependency is timing out (latency: 2450ms). I recommend checking the Stripe status page and our API key configuration."

**Forbidden Pattern**: Assuming a 200 OK means the system is fully functional without verifying dependency health.
---

### 4.3 Log Pattern Analysis (The "Silent Error" Search)

**Purpose:** Detect slow‑burning issues (memory leaks, gradual error increases) before they become outages.

**Trigger Options:**
- **On‑demand:** User provides a log snippet or query results.
- **Scheduled (if CI integration exists):** A daily GitHub Action can run queries and commit findings to `./docs/monitoring/log_analysis_report.md`.

**Analysis Query Templates (AWS CloudWatch Logs Insights syntax – adapt to your provider):**

| Pattern | Query | Threshold | AI Action |
|---------|-------|-----------|------------|
| **4xx Spike** | `filter status >= 400 and status < 500 \| stats count() by bin(5m)` | >50% increase vs same period yesterday | *"4xx spike detected on [endpoint]. Investigate broken client or credential issues."* |
| **5xx Spike** | `filter status >= 500 \| stats count() by bin(5m)` | Any increase > baseline + 10% | *"5xx errors increased. Possible deployment regression. Recommend rollback if sustained."* |
| **Slow Queries** | `filter @message like /duration_ms/ \| parse @message /duration_ms=(?<ms>\d+)/ \| filter ms > 500 \| sort ms desc \| limit 20` | Any results | *"Slow queries detected. Top offenders: [list]. Recommend query optimization or index review."* |
| **Memory Pressure** | `filter @message like /RSS\|heap\|memory/ \| stats max(memory_mb) by bin(1h)` | >80% of allocated memory | *"Memory trending upward. Potential leak in [service]."* |
| **New Exception Type** | `filter @message like /Exception\|Error/ \| stats count() by exception_type` | New exception type appears | *"New exception type [Name] detected. Investigate root cause."* |

**AI Action (User provides log snippet):**
1. User pastes log output (CloudWatch, Sentry, Datadog, or plain text).
2. AI applies pattern matching to the snippet.
3. AI outputs: *"Analysis complete: [Findings]. Recommendations: [List]."*

**Example AI Output:**
```text
Log Analysis Results:
- 5xx spike: +240% on `/api/payment` endpoint
- Slow query: `SELECT * FROM orders WHERE user_id = ?` (duration: 2450ms)
- Memory pressure: 87% on `api-worker`

Recommendations:
1. Rollback recent payment service change (SEV1)
2. Add index on `orders.user_id`
3. Investigate memory leak in worker pool
```
**If no anomalies detected**: Output "Log analysis complete: No anomalies detected within analyzed time window."

---

### 4.4 The "Production $\rightarrow$ Guardrail" Feedback Loop
This is the final step of the "Golden Loop." The goal is to ensure that the system learns from its mistakes.

*   **The Rule:** Every production incident must result in a permanent improvement to the `GUARDRAILS.md` or `CODING_STANDARDS.md`.
*   **The Knowledge Integration Process:**
    1. **RCA:** Perform the Root Cause Analysis (per `CODING_STANDARDS.md` Pillar 5.3).
    2. **Guardrail Gap Analysis:** Ask: *"Which Module (1-6) failed to prevent this?"*
    3. **Update Proposal:** Draft a new rule to prevent the error from recurring.
*   **AI Action:** After resolving a production bug, the AI **MUST** output: *"The bug was caused by [X]. Our current Guardrails didn't catch this because [Y]. I propose adding the following rule to `GUARDRAILS.md` Module 3 (Edge Cases) to prevent this in the future: [Rule Text]."*

### 4.5 Automatic Rollback Recommendation (Error Rate Spike)
**Trigger:** In the first 5 minutes after deployment, error rate exceeds 10% of requests (or 3x baseline).
**AI Action:** Output: *“🚨 High error rate detected post‑deployment. I recommend rolling back to the previous version. Shall I draft the rollback command?”*

### 4.6 Service Level Objectives (SLO) & Error Budgets

**The Rule:** Every production service MUST have defined SLIs and SLOs. The AI must use these as decision thresholds for deployment gating.

**Standard SLI Definitions:**

| SLI | Measurement | SLO Target | Error Budget (Monthly) |
|-----|-------------|------------|------------------------|
| **Availability** | `200 OK` responses / total requests | 99.9% | 43m downtime |
| **Latency** | p95 response time | < 500ms | 43m above threshold |
| **Error Rate** | 5xx errors / total requests | < 0.5% | 43m above threshold |

**Error Budget Consumption Triggers:**
- **Budget > 50% remaining:** Normal operations. Deploy freely.
- **Budget 20‑50% remaining:** Caution zone. Deploy only low‑risk changes.
- **Budget < 20% remaining:** Emergency freeze. Only security fixes allowed.
- **Budget exhausted (0%):** All non‑emergency deployments frozen.

**AI Action (Pre‑Deployment):** Query monitoring API for current error budget status. Output: *"Current error budget: 78% remaining. ✅ Safe to deploy. Proceeding."*

**AI Action (Budget Exhausted):** Output: *"🚨 Error budget exhausted (0% remaining). All non‑emergency deployments are frozen. The team must focus on reliability improvements before any feature work resumes. I recommend a post‑mortem meeting."*

**Integration Example (Datadog):**
```yaml
# SLO definition
- name: "API Availability"
  threshold: 99.9
  timeframe: 30d
  monitor_ids: ["12345"]
```
---

### 4.7 Alert Suppression & Deduplication

**The Rule:** The AI must NOT escalate alerts that are:
1. **Duplicate:** Same error fingerprint within 15 minutes
2. **Transient:** Resolved within 30 seconds (e.g., network blip)
3. **Maintenance Window:** Deployment in progress (known cause)
4. **Low Impact:** Affects < 0.1% of users (unless critical path)

**AI Action:** Before escalating an alert, check deduplication cache. Output: *"Alert suppressed: This is a duplicate of incident #1234. I am updating the existing ticket with a new occurrence timestamp."*

**Fingerprint Generation:**
fingerprint = hash(error.type + error.file + error.function + stack_trace_top_3_frames)

---
### 4.8 Resource Saturation Monitoring

**The Rule:** The AI must monitor infrastructure metrics for capacity warnings.

**Critical Thresholds:**

| Metric | Warning Threshold | Critical Threshold | AI Action |
|--------|-------------------|---------------------|-----------|
| **CPU** | > 70% sustained 5 min | > 90% | "CPU at [X]%. Recommend scaling horizontally or investigating CPU‑bound operation." |
| **Memory** | > 80% | > 95% | "Memory at [X]%. Potential leak detected. Review heap snapshot from last 10 minutes." |
| **DB Connections** | > 80% of max | > 95% | "Connection pool near exhaustion. Check for connection leaks or increase pool size." |
| **Disk** | > 85% | > 95% | "Disk usage critical. Run log rotation or increase volume size." |

**AI Action (Alert Only – No Automated Scaling):**  
*"⚠️ CRITICAL: Memory usage at 97% on instance `i-123`. Potential memory leak or capacity issue. **Recommend human investigation** and manual scaling if needed. I can provide the command to increase instance count if you approve – this requires manual execution, not automation."*

### 4.9 Incident Severity Classification

**Purpose:** The AI must prioritize responses based on impact, not just alert volume.

**Severity Matrix:**

| Severity | Definition | Impact | AI Action |
|----------|------------|--------|------------|
| **SEV0** | Complete outage, data loss, security breach | 100% users affected | Output `@ai-blocked: SEV0 - Escalate immediately. Manual intervention required.` |
| **SEV1** | Major feature broken, high error rate | >25% users affected | Propose rollback + alert on-call (if configured) |
| **SEV2** | Degraded performance, non-critical feature broken | 5-25% users | Create incident ticket + propose fix within 24h |
| **SEV3** | Minor bug, cosmetic issue | <5% users | Log in backlog, no immediate action |

**AI Action on Detection:**
```text
Incident classified as SEV[X]: [Description]
Impact: [%] users affected
Recommended action: [Protocol]
```
**Escalation Rule**: If the AI cannot determine severity (e.g., no user impact data), default to SEV2 and request human input.
### 4.0 Monitoring Data Access Protocol

**The Rule:** The AI cannot directly access production monitoring APIs unless explicitly configured. The AI must operate in one of two modes:

**Mode 1: User-Provided Data (Default)**
- User pastes log snippets, error messages, or metric values.
- AI analyzes the provided data using patterns in this module.
- AI Action: *"I've analyzed the provided logs. [Findings]. If you can provide [specific additional data], I can refine the analysis."*

**Mode 2: GitHub Actions Integration (Optional)**
- Monitoring queries run as scheduled workflows; results committed to `./docs/monitoring/`.
- AI reads these files when analyzing state.

**AI Action (Always):** Before any monitoring analysis, state: *"Operating in Mode 1 (user‑provided data). Please provide logs or metrics to analyze."*
---

### 🛠 AI Implementation Checklist (Module 4)
- [ ] Did I use the `correlationId` to trace the error across the stack?
- [ ] Did I distinguish between a **Healthy, Degraded, and Unhealthy** state?
- [ ] Did I analyze logs for patterns (4xx spikes, slow queries) rather than just single errors?
- [ ] Did I close the loop by proposing a permanent update to the `GUARDRAILS.md` after a fix?
- [ ] Did I ensure the fix was verified via the `/health` endpoint?

***
# 📦 Module 5: Cost Governance & FinOps

**Purpose:** To prevent cloud cost overruns and ensure financial accountability in automated deployments.

### 5.1 Cost Anomaly Detection

**The Rule:** The AI must monitor cloud spend and flag anomalies exceeding 20% of baseline.

**Triggers:**
- Daily spend increases >20% compared to 7‑day average
- New expensive resource provisioned (e.g., `db.r5.16xlarge`)
- Unused resources detected (idle load balancers, unattached volumes)

**AI Action:** Output: *"⚠️ Cost Anomaly Detected: AWS spend increased by 35% ($142 → $192). Primary driver: New RDS instance `prod‑replica‑2` with 16xlarge size. Verify this was intentional."*

### 5.2 Resource Right‑Sizing Recommendations

**AI Action:** Periodically analyze resource utilization and suggest optimizations:
- "Instance `i‑123` has averaged 12% CPU over 30 days. Recommend downsizing from `t3.xlarge` to `t3.medium` (saves $87/month)."
- "EBS volume `vol‑456` has 400GB provisioned, 45GB used. Recommend reducing to 100GB (saves $32/month)."

### 5.3 Budget Enforcement

**AI Action:** If project has defined budget thresholds (e.g., $500/month), warn before deploying expensive resources: *"This change adds a Redis ElastiCache cluster (~$30/month). Current spend is $480/$500. Deploying will exceed budget. Approve? [Y/n]"*

### 5.4 Compliance & Audit Log Retention

**The Rule:** Audit logs must be retained according to the project's compliance requirements.

**Retention Periods:**
- **SOC2 / ISO27001:** Minimum 90 days, recommend 1 year.
- **GDPR:** Access logs containing personal data – 6 months maximum unless justified.
- **PCI‑DSS:** Minimum 1 year, with 3 months immediately available.

**AI Action:** When configuring logging infrastructure, include a retention policy:
```yaml
# Example: AWS CloudWatch Logs
RetentionInDays: 365
```

## 🏁 Final Summary of the "AI Brain" Architecture

You have now completed all three master documents. Your AI is no longer a simple chat-bot; it is a **Full-Lifecycle Engineering Agent**.

### 📂 The Three-File Ecosystem:
1.  **`GUARDRAILS.md`** $\rightarrow$ **The Law.** (Security, Risk, and Reliability).
2.  **`CODING_STANDARDS.md`** $\rightarrow$ **The Style.** (Architecture, Naming, and Quality).
3.  **`PIPELINE_OPS.md`** $\rightarrow$ **The Machine.** (CI/CD, Scanning, and Runtime).


### 🔄 The Operational Flow for the AI:
**Design** (STRIDE/Gherkin) $\rightarrow$ **Build** (Layered Architecture/Zod/Naming) $\rightarrow$ **Verify** (Husky/CI/SAST) $\rightarrow$ **Secure** (SCA/Triage) $\rightarrow$ **Deploy** (Sync Env/Smoke Test) $\rightarrow$ **Monitor** (Sentry/Health Check) $\rightarrow$ **Learn** (RCA $\rightarrow$ Update Guardrails).

### 🚀 Final Deployment Tip:
To activate this, place all three files in your root directory. In your AI's system prompt (or `.cursorrules`), add:

> *"You are the Senior DevSecOps Lead. Your behavior is strictly governed by `GUARDRAILS.md`, `CODING_STANDARDS.md`, and `PIPELINE_OPS.md`. You must apply these in order: **Risk Profile $\rightarrow$ Design $\rightarrow$ Implementation $\rightarrow$ Verification $\rightarrow$ Deployment $\rightarrow$ Monitoring.** If a request violates any of these documents, you must stop, warn the user, and propose the compliant alternative."*
