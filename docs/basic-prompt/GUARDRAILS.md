## 🎚️ Project Risk Profile (AI MUST DETERMINE)

Pick one tier based on how the code will be used:

| Tier | When to use | Rules enforced |
|------|-------------|----------------|
| **Commercial/Production** | Code that runs for real customers or handles live data | **All rules** (Modules 1‑6) |
| **Internal Tooling** | Scripts only your team uses, no customer data, low risk | Only: 1.2 (permissions), 1.4 (no secrets), 2.1 (check inputs), 2.2 (no injection), 2.6 (logging), 6.4 (hide secrets in logs) |
| **Prototype/Throwaway** | Demo, proof‑of‑concept, never live | Only: 1.4 (no hardcoded secrets) and 2.1 (basic input checks) |

**If you are unsure, use Commercial/Production.**

**AI Action:** Before starting, say: *"Risk level: [Tier]. I will enforce [rules]."*

*   **Module 1: Secure Architecture & Foundation** (The "Before you code" stage)
*   **Module 2: The Secure Coding Standard** (The "While you code" stage - OWASP+)
*   **Module 3: The Edge Case & Stress Testing Matrix** (The "Break it" stage)
*   **Module 4: The Automated DevSecOps Pipeline** (The "Verification" stage)
*   **Module 5: Human-AI Collaboration & Governance** (The "Strategic" stage)

---

# 📦 Module 1: Secure Architecture & Foundation
**Purpose:** To ensure the AI does not build on a shaky foundation. This module governs the blueprint, the environment, and the initial setup.

### 1.1 Threat Modeling (STRIDE)
**Trigger:** Before generating any new API endpoint, file upload handler, or external service call.

**AI Action:** Output a table with:

| Component / Input | Threat Type (STRIDE) | Description of Risk | Required Mitigation |
| :--- | :--- | :--- | :--- |
| e.g., `/api/upload` | Tampering | Malicious file upload | Magic byte validation + size limit |
| e.g., `user_id` param | Info Disclosure | IDOR | Ownership check in DB query |

STRIDE = Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege.

### 1.2 Principle of Least Privilege (PoLP)
The AI must never suggest "Admin" or "Root" access for standard operations.
*   **Database Level:** 
    *   The application must not connect to the DB as a `superuser` or `owner`.
    *   **Requirement:** Separate roles for `App_ReadWrite` (DML: SELECT, INSERT, UPDATE) and `Migration_User` (DDL: CREATE, ALTER).
*   **System Level:** 
    *   Processes must run as non-privileged users.
    *   Containers must not run as `root`.
*   **AI Action:** When writing database connection strings or Dockerfiles, the AI must explicitly define a non-root user.

### 1.3 Data Flow & Encryption Standards
The AI must ensure data is encrypted both "In Transit" and "At Rest."
*   **In Transit:** 
    *   Force TLS 1.2+ everywhere.
    *   **Rule:** No `http://` links in code. Every URL must be `https://`.
*  **At Rest:** 
    *   **Passwords:** Must be hashed using `Argon2id` or `bcrypt`. Never `SHA-256` or `MD5`.
    *   **Other sensitive data** (e.g., SSN, credit card numbers, API keys stored in DB): Use **field‑level encryption** (e.g., `crypto‑js` in Node, `pgcrypto` in PostgreSQL, or `pycryptodome` in Python) – not hashing, because the original value must be retrievable.
    *   **Rule:** Passwords must use `Argon2id` or `bcrypt`. Never use `SHA-256` or `MD5` for passwords.
*   **AI Action:** If the AI generates a "User" model, it must automatically include the hashing logic for the password field.

### 1.4 Environment & Secret Management
Zero-tolerance for hardcoded secrets.
*   **The Secret Rule:** No API keys, DB passwords, or JWT secrets in the codebase.
*   **Implementation:**
    *   Use `.env` files for local development.
    *   Use `.env.example` to document required keys (without values).
    *   **Naming Convention:** 
        *   `SECRET_...` $\rightarrow$ Server-side only.
        *   `NEXT_PUBLIC_...` or `VITE_...` $\rightarrow$ Client-side safe.
*   **AI Action:** If the AI needs an API key to make a function work, it **must** write `process.env.API_KEY` and then tell the user: *"Please add API_KEY to your .env file."*
*   **Production Secret Storage:** For **Commercial/Production** tier, do not rely solely on `.env` files on the server. Prefer a managed secret manager (AWS Secrets Manager, HashiCorp Vault, Azure Key Vault, or GCP Secret Manager). The AI should note: *“For production, consider moving secrets to [Your chosen secret manager].”*


### 1.5 API Contract First Approach
To prevent "Frontend-Backend Drift."
*   **The Rule:** API schemas must be the "Source of Truth."
*   **Implementation:** Use OpenAPI (Swagger) or a shared Zod schema file.
*   **AI Action:** Before writing a Frontend fetch call, the AI must check the Backend controller/schema to ensure the field names and types match exactly.
### 1.6 Database Connection TLS (Hard Constraint)
**Trigger:** Generating a database connection string (`.env`, `config.js`).
**AI Action:** For production/staging, enforce encrypted transport:
- **PostgreSQL:** Append `?sslmode=require`
- **MySQL:** Append `?ssl={"rejectUnauthorized":true}`
- **MongoDB:** Use `mongodb+srv://` protocol
- **AI must warn** if the string lacks TLS and the tier is **Commercial/Production**.

---
# 📦 Module 2: The Secure Coding Standard (OWASP+)

**Purpose:** This module governs the actual writing of the code. It moves beyond the blueprint and dictates exactly how the AI must write functions, handle data, and manage sessions. It is based on the **OWASP Top 10** (the industry standard for web security).

---

### 2.1 Input Validation & Sanitization (The "Zero-Trust" Rule)
The AI must assume that **every single piece of data** coming from a user, an API, or a database is malicious.
*   **The Rule:** Validation must happen on the **Server Side**. Client-side validation is for UX only; server-side validation is for security.
*   **Detailed Requirement:**
    *   **Strict Schema Validation:** Do not use basic `if` statements (e.g., `if (!email) ...`). Use a schema-based validator like **Zod**, **Joi**, or **Yup**.
    *   **Allow-listing vs. Block-listing:** Only allow known-good characters (Allow-listing). Do not try to filter out "bad" characters (Block-listing), as attackers always find new ones.
    *   **Type Enforcement:** If a field is an `Age`, it must be a `Number`, not a `String` that looks like a number.
*   **AI Action:** When generating a controller or API route, the AI must start by defining a Zod schema and wrapping the request body in `.parse()`.

### 2.2 Prevention of Injection (SQL, NoSQL, Command)
The AI must ensure that user-provided data is never executed as code.
*   **The Rule:** User input must be treated as **Data**, never as **Executable Code**.
*   **Detailed Requirement:**
    *   **Parameterized Queries:** Use an ORM (Prisma, Drizzle, Sequelize, Mongoose) or prepared statements. 
    *   **Forbidden Pattern:** Never use template literals or string concatenation in a query (e.g., `` `SELECT * FROM users WHERE id = ${id}` `` is strictly forbidden).
    *   **OS Command Injection:** Avoid functions like `eval()`, `exec()`, or `system()`. If they must be used, the input must be strictly validated against a hardcoded allow-list.
*   **AI Action:** If the AI sees a query being built with a variable, it must automatically convert it to a parameterized version using the project's ORM.

### 2.3 Cross-Site Scripting (XSS) Prevention
The AI must prevent attackers from injecting scripts into the pages viewed by other users.
*   **The Rule:** All output must be encoded/escaped before being rendered in the browser.
*   **Detailed Requirement:**
    *   **Auto-Escaping:** Use frameworks that auto-escape by default (React, Vue, Angular).
    *   **Dangerous Functions:** The use of `dangerouslySetInnerHTML` (React) or `v-html` (Vue) is a **Critical Warning**.
    *   **Sanitization:** If raw HTML must be rendered, it **MUST** be passed through **DOMPurify** first.
    *   **Cookie Security:** Store session tokens in `HttpOnly` cookies so JavaScript cannot access them via `document.cookie`.
*   **AI Action:** If the AI generates code that renders user-provided HTML, it must automatically include the `DOMPurify.sanitize()` wrapper.

### 2.4 Broken Access Control & Authorization
The AI must verify that the user has permission to perform an action **every single time**.
*   **The Rule:** Authentication (Who are you?) $\neq$ Authorization (What are you allowed to do?).
*   **Detailed Requirement:**
    *   **ID-Based Attacks (IDOR):** Never trust a user-provided ID in a URL (e.g., `/api/user/123/settings`). 
    *   **Ownership Check:** The code must check: `if (resource.ownerId !== currentUser.id) throw ForbiddenError()`.
    *   **Role-Based Access Control (RBAC):** Implement middleware to check roles (e.g., `isAdmin`, `isEditor`) before accessing sensitive routes.
*   **AI Action:** Whenever the AI writes a "Update" or "Delete" function, it must include a check to verify that the authenticated user owns the resource they are trying to modify.

### 2.5 Secure Session & Authentication Management
The AI must manage the user's identity without leaking credentials.
*   **The Rule:** Session tokens must be short-lived, unique, and stored securely.
*   **Detailed Requirement:**
        *   **JWT Storage:** If using JWTs for API authentication, store them in an **`HttpOnly` cookie** (not `localStorage` or `sessionStorage`). Cookies with `HttpOnly` prevent XSS from stealing the token.
    **AI Action: This is a HARD RULE. Never generate frontend code that sets an `Authorization` header for JWT. Rely exclusively on `HttpOnly` cookies.**
    *   **Cookie Attributes:** All session cookies must be set with:
        *   `HttpOnly`: Prevents XSS from stealing the token.
        *   `Secure`: Ensures the cookie is only sent over HTTPS.
        *   `SameSite=Strict`: Prevents CSRF attacks.
*   **CSRF Defense (Synchronizer Token Pattern):**
    - `SameSite=Strict` prevents cross-site POST/PUT/DELETE attacks but **does NOT protect state-changing GET requests** (e.g., `/api/delete?id=123`).
    - **Mandatory:** For all `POST`, `PUT`, `DELETE`, `PATCH` endpoints, implement a **CSRF token** (cryptographically random, 32+ bytes) stored in the user's session.
    - **Verification:** The server must reject any state-changing request missing a valid `X-CSRF-Token` header or form field matching the session token.
    - **Frontend:** Read the token from a `<meta name="csrf-token" content="...">` tag (or an `HttpOnly` cookie) and include it in every mutation request.
*   **AI Action:** When generating a session-handling function, the AI must:
    1. Set `HttpOnly`, `Secure`, `SameSite=Strict` cookies.
    2. Generate a CSRF token and store it in `req.session.csrfToken`.
    3. Create middleware that verifies `req.headers['x-csrf-token'] === req.session.csrfToken` for all state-changing requests.
    4. On the frontend, include the token in a header (e.g., from a meta tag).

    *   **Password Policy:** Force a minimum length and complexity.
    *   **JWT Handling:** Do not store sensitive data inside a JWT. **Never store JWTs in `localStorage` or `sessionStorage`** – they are vulnerable to XSS. If using JWTs for API auth, store them in an `HttpOnly` cookie.
**Conflict Resolution – JWT Storage:**
- **Cookie‑based session management takes precedence over `Authorization: Bearer` headers.**
- **AI Action:** When generating frontend `fetch` calls, **DO NOT** manually add an `Authorization` header. Rely on the `HttpOnly` cookie. The frontend should only use `credentials: 'include'`.


### 2.6 Secure API Design & Error Handling
The AI must prevent the API from leaking internal system information.
*   **The Rule:** Errors should be helpful to the developer (internally) but vague to the user (externally).
*   **Detailed Requirement:**
    *   **No Stack Traces:** Never return `err.stack` or raw database error messages to the frontend.
*   **Consistent Response Format:** Use a standard wrapper.  
    Example: `{ success: false, message: "Invalid input", code: "VALIDATION_FAILED" }`.  
    **Code naming convention:** Follow `CODING_STANDARDS.md` Pillar 2.5 (e.g., `NOT_FOUND`, `FORBIDDEN`, `UNAUTHORIZED`).
    *   **Rate Limiting:** **MANDATORY** for authentication endpoints (login, signup, password reset). Implement `express-rate-limit` (Node) or Django Ratelimit (Python) with a strict policy (e.g., 5 attempts per 15 minutes per IP). For other endpoints, rate limiting is recommended but not required.
    *   **Log Redaction:** Never log passwords, tokens, secrets, or credit card numbers. Implement a logger that automatically redacts these field names (case‑insensitive): `password`, `token`, `jwt`, `secret`, `apiKey`, `creditCard`. Use a library like `pino` (Node) or `structlog` (Python) with a redaction filter.
*   **AI Action:** Every `catch` block in an API route must return a generic user-friendly message, while logging the actual error to a private logging service.
### 2.7 Server‑Side Request Forgery (SSRF) Prevention
If the application makes outbound HTTP requests to URLs provided by users (e.g., fetching a profile picture from a user‑supplied link), the AI must prevent attackers from accessing internal services.

*   **The Rule:** Validate and restrict any user‑supplied URL before the server fetches it.
*   **Implementation:** 
    - Block requests to internal IP ranges:
        - `127.0.0.1`, `::1` (loopback)
        - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (private RFC 1918)
        - `169.254.169.254` (cloud metadata service – AWS, GCP, Azure)
    - Prefer an allow‑list of allowed domains if possible.
*   **AI Action:** Whenever the AI writes code using `fetch`, `axios`, or `http.request` with a URL derived from user input, it must include a validation function that rejects the internal IP ranges listed above.
### 2.8 Security Headers (Defense in Depth)
**Trigger:** Every HTTP response (server middleware or framework config).

**AI Action:** Add these headers:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (enforces HTTPS)
- `X-Content-Type-Options: nosniff` (prevents MIME sniffing)
- `X-Frame-Options: DENY` (prevents clickjacking)
- `Content-Security-Policy: default-src 'self'` (basic CSP; adjust if external scripts needed)

**Exception:** For local development, HSTS can be omitted.

### 2.9 OAuth2 / OIDC Hardening
**Trigger:** When implementing “Login with Google/GitHub” or any OAuth2 flow.
**AI Action:** 
- Generate a **state** parameter to prevent CSRF.
- For public clients (SPA/mobile), enforce **PKCE** (Proof Key for Code Exchange).
- Validate the `redirect_uri` against a hardcoded allow‑list – never accept a user‑supplied URI.
---
### 2.10 GraphQL Hardening (if using GraphQL)
**Trigger:** When the project uses GraphQL (Apollo, Yoga, Graphene).
**AI Action:**
- Disable introspection in production (`NODE_ENV=production` → `introspection: false`).
- Implement query depth limiting (max depth 5–10) to prevent recursive DoS.
- Implement query cost analysis (assign weight to fields, max cost per request).
- Limit batch requests (max 10 operations per batch).

# 📦 Module 3: The Edge Case & Stress Testing Matrix

**Purpose:** Most bugs and security vulnerabilities live in the "Edge Cases"—the scenarios that developers forget to test. This module trains the AI to stop thinking about the **"Happy Path"** (where everything goes right) and start thinking about the **"Broken Path"** (where things go wrong).

The AI must apply this matrix to every single feature it generates.

---

### 3.1 Input Resilience (The "What if the user is weird?" check)
The AI must ensure the application doesn't crash when receiving unexpected data.
*   **The Empty State:** 
    *   **Scenario:** User submits a form with empty fields, only spaces, or `null` values.
    *   **Requirement:** Every input must have a defined "fallback" or "error state."
*   **The Giant State (Buffer/DoS):** 
    *   **Scenario:** User pastes a 10MB string into a "Username" field or uploads a 1GB image.
    *   **Requirement:** Implement strict **maximum length limits** and **file size limits** at the API gateway/middleware level.
*   **The Malicious State (Payloads):** 
    *   **Scenario:** User inputs `<script>`, `OR 1=1`, `../../etc/passwd`, or emojis in a field that expects a phone number.
    *   **Requirement:** Sanitize and validate against a strict allow-list.
*   **The Unicode/Locale State:** 
    *   **Scenario:** User enters names in Arabic, Chinese, or uses Zalgo text.
    *   **Requirement:** Use UTF-8 encoding everywhere. Ensure database collations support international characters.
*   **The File Upload State:** 
    *   **Scenario:** User uploads a file that claims to be `image.jpg` but is actually a PHP script or an executable.
    *   **Requirement:** 
        - Validate file size limits (e.g., 10MB for images, 1MB for JSON).
        - Validate **magic bytes** (file signature) – do not trust the file extension or MIME type sent by the browser.
        - Example magic byte check for images: read the first 4 bytes; `FF D8 FF` = JPEG, `89 50 4E 47` = PNG. Reject if mismatch.
*   **AI Action:** When writing a form or an API endpoint, the AI must also write the validation logic for `max length`, `min length`, and `empty` states.

### 3.2 State & Logic Resilience (The "Race Condition" check)
The AI must ensure that the application remains consistent even when the timing is off.
*   **Concurrency (The Double-Click):** 
    *   **Scenario:** User clicks the "Pay Now" button five times in one second.
    *   **Requirement:** Implement **Debouncing** on the frontend and **Idempotency Keys** on the backend.
        - Idempotency keys **MUST be stored in the primary database** (not in a volatile cache like Redis alone) to survive restarts and prevent duplicate transactions.
        - The key should be unique per user + operation (e.g., `user_123:payment_intent`).
**Idempotency Key Storage TTL for Async Jobs:** For background/queued operations, the idempotency key MUST be stored for the duration of the job queue retention period (minimum 7 days). This prevents duplicate job submission if the client retries after a delay.
*   **Session Expiry/Race:** 
    *   **Scenario:** A user submits a form exactly at the millisecond their session expires.
    *   **Requirement:** Graceful handling of `401 Unauthorized` errors; redirect to login without losing the user's form data (save to local state).
*   **Partial Failures:** 
    *   **Scenario:** A process requires three API calls; the first two succeed, and the third fails.
    *   **Requirement:** Use **Database Transactions** (Atomic operations). If one part fails, the whole operation must rollback (Undo) to prevent "Zombie Data."
- **Idempotency Table Schema:** Must include:
  - `key VARCHAR(255) PRIMARY KEY`
  - `response JSONB`
  - `created_at TIMESTAMP DEFAULT NOW()`
  - **Index on `created_at`** for a daily cleanup job.
    *   **AI Action:** When writing any payment or data-mutation logic, the AI must automatically suggest an idempotency check or a database transaction block.

### 3.3 Infrastructure & Network Resilience (The "Real World" check)
The AI must assume the internet is slow, unstable, and unreliable.
*   **High Latency (Slow 3G):** 
    *   **Scenario:** API response takes 10 seconds instead of 100ms.
    *   **Requirement:** Implement **Loading States** (Skeletons/Spinners) and **Request Timeouts**. Never let a request hang indefinitely.
*   **Offline Mode:** 
    *   **Scenario:** User loses internet connection while mid-way through a process.
    *   **Requirement:** Implement "Offline" detection. Use `navigator.onLine` and show a non-intrusive warning.
*   **The "Throttled" State:** 
    *   **Scenario:** The server is under heavy load and returns a `429 Too Many Requests`.
    *   **Requirement:** Implement **Exponential Backoff** (retry the request after 1s, then 2s, then 4s) rather than hammering the server.
*   **AI Action:** When writing a frontend `fetch` or `axios` call, the AI must include a `timeout` setting and a `catch` block that handles network errors specifically.

### 3.4 UI/UX Resilience (The "Visual" check)
The AI must ensure the interface is usable for everyone, on every device.
*   **Screen Variance:** 
    *   **Scenario:** User opens the site on a 320px iPhone SE or a 34" Ultra-wide monitor.
    *   **Requirement:** Use a mobile-first responsive grid. Test for "Overflow" (content leaking off the side of the screen).
*   **Accessibility (WCAG):** 
    *   **Scenario:** A visually impaired user navigates via keyboard (Tab key) or Screen Reader.
    *   **Requirement:** Every image needs `alt` text. Every input needs a `<label>`. Focus states must be visible.
*   **State Transitions:** 
    *   **Scenario:** A page transitions from "Loading" $\rightarrow$ "Error" $\rightarrow$ "Success."
    *   **Requirement:** Prevent "Layout Shift" (Cumulative Layout Shift). Use fixed-height containers for loading states.
*   **AI Action:** When generating CSS or JSX/HTML, the AI must automatically include `alt` tags for images and use responsive units (rem, em, %) instead of fixed pixels (px).

**Exception for Custom Interactive Components:** Custom modals, dropdowns, or tooltips that do not use Radix UI Primitives are permitted **only** if annotated with `@a11y-exception` as defined in `CODING_STANDARDS.md` Pillar 3.6. Without this annotation, the AI MUST default to Radix or Headless UI.
---
# 📦 Module 4: The Automated DevSecOps Pipeline

**Purpose:** This module governs the "Quality Gates." It ensures that the AI doesn't just write secure code, but also implements the **automated systems** that catch human errors. The AI must treat the pipeline as the final judge—if the pipeline fails, the code is fundamentally broken, regardless of whether it "works on my machine."

The AI is now tasked with setting up and maintaining a **"Shift-Left" security architecture**, where security is checked at the earliest possible moment.

---

### 4.1 Gate 1: The Local Shield (Pre-Commit)
The first line of defense is the developer's own machine. The AI must implement "Guardrails" that prevent bad code from even being committed to Git.
*   **The Tooling:** Implement **Husky** (for JS/TS) or **pre-commit** (for Python).
*   **The Mandatory Checks:**
    *   **Linting:** Run ESLint/Ruff. If there are "Error" level linting issues, the commit is blocked.
    *   **Formatting:** Run Prettier/Black. Code must be auto-formatted to ensure no "logic bugs" are hidden by messy indentation.
    *   **Secret Scanning:** Implement **Gitleaks** or **TruffleHog**. If a regex matches an API key or a private key, the commit is physically blocked.
    *   **Type Check:** Run `tsc` (TypeScript) or `mypy` (Python). No `any` types or type mismatches allowed.
*   **AI Action:** When setting up a project, the AI must automatically generate the `.husky` or `.pre-commit-config.yaml` files and the corresponding scripts in `package.json`.

### 4.2 Gate 2: The CI Gate (Continuous Integration)
Once code is pushed to a Pull Request (PR), the CI server (GitHub Actions, GitLab CI, Jenkins) takes over.
*   **SAST (Static Application Security Testing):** 
    *   **Requirement:** Integrate tools like **SonarQube**, **CodeQL**, or **Snyk**.
    *   **Tool-Specific Severity Mapping:** Configure SAST tools to block only on certain severities:

| Tool | Block the build on | Warn (do not block) |
|------|-------------------|---------------------|
| **Semgrep** | `error` severity | `warning` severity |
| **CodeQL** | `error` severity | `warning`, `note` |
| **SonarQube** | `BLOCKER`, `CRITICAL` | `MAJOR`, `MINOR`, `INFO` |
| **Snyk Code** | `high`, `critical` | `medium`, `low` |
|
*   **Failure Threshold (Source of Truth):** Use the **Tool‑Specific Severity Mapping** table below. Ignore any general statements like “fail on High/Critical”. The table defines exactly what blocks the build.
*   **SCA (Software Composition Analysis):** 
    *   **Requirement:** Use **GitHub Dependabot** or **Snyk**.
    *   **Logic:** Scan `package.json` or `requirements.txt`. If a dependency has a known CVE (Critical Vulnerability), the build **must fail**.
*   **Unit Test Coverage:** 
    *   **Requirement:** Run tests via Jest/PyTest/Mocha.
    *   **Hard Gate:** If the code coverage drops below **80%**, the PR cannot be merged.
*   **AI Action:** The AI must write the `.github/workflows/ci.yml` file, ensuring that the "Merge" button is blocked if any of these steps fail.

### 4.3 Gate 3: The CD Gate (Continuous Deployment & E2E)
Before the code hits production, it must be tested in a "Staging" (Mirror) environment.
*   **Integration Testing:** Test the connection between the API and the Database. Ensure that a "Delete" request actually removes the record from the DB.
*   **E2E (End-to-End) Testing:** 
    *   **Tooling:** Use **Playwright** or **Cypress**.
    *   **Logic:** Simulate a real user: `Login` → `Add to Cart` → `Checkout`. If the "Checkout" button is missing or broken, the deployment is aborted.
    *   **Test Data Isolation:** Every E2E test **must** generate unique data (e.g., `test-user-${Date.now()}@example.com`). Include a teardown block (`afterEach` or `finally`) to delete the created data, even if the test fails. Never share a static test account.
*   **Smoke Testing:** A quick set of tests to ensure the app doesn't "Crash on Start" after deployment.
*   **AI Action:** The AI must generate a suite of "Happy Path" E2E tests for every major feature it creates.

### 4.4 Gate 4: The Dynamic Shield (DAST & Performance)
Testing the application while it is running (Dynamic Analysis).
*   **DAST (Dynamic Application Security Testing):** 
    *   **Tooling:** **OWASP ZAP** or **Burp Suite**.
    *   **Logic:** The tool "attacks" the staging site with SQLi, XSS, and CSRF payloads to see if any get through.
*   **Accessibility Audit:** Use **axe-core** or **Lighthouse**. If the "Accessibility Score" is below 90, the build is flagged.
*   **Performance Budget:** Use **Lighthouse CI**. If the "Largest Contentful Paint" (LCP) increases by more than 500ms, the build is rejected.
*   **AI Action:** When configuring the pipeline, the AI must add a step to run a Lighthouse audit and output the report to the PR comments.

### 4.5 Gate 5: The Production Sentinel (Runtime Protection)
Guardrails that protect the app after it is live.
*   **WAF (Web Application Firewall):** Implement **Cloudflare** or **AWS WAF**. Block known malicious IPs and common attack patterns.
*   **Rate Limiting:** Set a hard limit (e.g., 100 requests per 15 minutes per IP) to prevent DDoS and Brute Force.
*   **Error Monitoring:** Integrate **Sentry** or **LogRocket**. 
    *   **Rule:** Every `500 Internal Server Error` must trigger an immediate alert to the developer.
*   **Health Checks:** Set up a `/health` endpoint that the load balancer checks every 10 seconds. If it returns anything other than `200 OK`, the server is automatically restarted.
*   **AI Action:** The AI must generate the `/health` endpoint and the basic configuration for a Rate Limiter middleware.

**N+1 Query Prevention (Resource Exhaustion):** The AI MUST treat unoptimised N+1 queries (looping database calls) as a potential Denial‑of‑Service vector. The AI shall follow the detection triggers defined in `CODING_STANDARDS.md` Pillar 4.4 and flag any instance for refactoring.

---
# 📦 Module 5: Human-AI Collaboration & Governance

**Purpose:** This is the final and most important layer. Even with 100% automation and perfect coding standards, there is a "Reasoning Gap." An AI can tell you if the code is **functional**, but it cannot tell you if the code is **profitable, ethical, or aligned with a specific business vision**. 

This module defines the **Human-in-the-Loop (HITL)** protocol. It ensures that the AI does not operate in a vacuum and that a human remains the final authority for strategic decisions.

---

### 5.1 The "False Positive" Triage Protocol
Automated scanners (SAST/DAST) often flag "False Positives" (warnings that aren't actually bugs). 
*   **The Risk:** If a developer simply clicks "Ignore" to make the build pass, they might accidentally ignore a real vulnerability.
*   **The Guardrail:** 
    *   **The Exception Log:** Any bypassed security warning must be documented in a `SECURITY_EXCEPTIONS.md` file.
    *   **Requirement:** The log must include: *What was flagged, why it is a false positive, and who approved the bypass.*
*   **AI Action:** When the AI suggests a way to bypass a linting or security error, it must generate a documentation entry with all fields filled except `Approver`. The AI must output a placeholder: `[Approver Name / Date]` and explicitly ask the human to sign off before merging.

### 5.2 Business Logic & Intent Validation
A machine can verify that a function returns a `number`, but it cannot verify if that number is the *correct* discount for a specific customer tier.
*   **The Risk:** The AI builds a feature that is technically perfect but logically wrong for the business.
*   **The Guardrail:** 
    *   **Acceptance Criteria (AC) Mapping:** Every PR must map its changes back to a specific requirement (e.g., *"Requirement: Users over 65 get 20% off"*).
    *   **Exploratory Testing:** A human must perform "Chaos Testing"—trying to use the feature in ways the AI didn't anticipate.
*   **AI Action:** Before finalizing a feature, the AI must prompt the user: *"I have implemented this based on [X] requirements. Please verify if the business logic for [Specific Scenario] is correct."*

### 5.3 Root Cause Analysis (RCA) & The Knowledge Loop
When a critical bug reaches production, the goal is not just to fix it, but to ensure it **never happens again**.
*   **The Risk:** "Patch-work" fixing—fixing the symptom but leaving the disease.
*   **The Guardrail:** For every production incident, a **Three-Question RCA** must be completed:
    1. **Why** did this happen? (The technical cause).
    2. **Why** did our automated guardrails (Module 1-4) fail to catch it? (The system failure).
    3. **What** specific new rule must be added to the AI System Prompt to prevent this in the future? (The permanent fix).
*   **AI Action:** The AI must assist in writing the RCA report and then **draft a specific addition to `GUARDRAILS.md`** (e.g., “Add a rule to validate X”) and present it to the human for approval. The AI cannot change its own constraints autonomously.

### 5.4 Governance & Policy Maintenance
Guardrails can become outdated as technology evolves. A rule that was good in 2023 might be a bottleneck in 2025.
*   **The Risk:** "Guardrail Rot"—rules that are ignored because they are no longer relevant.
*   **The Guardrail:** 
    *   **Quarterly Review:** A human Lead Architect must review the `AI_SYSTEM_PROMPT` and `GUARDRAILS.md` every 90 days.
    *   **Policy Adjustment:** Update coverage requirements (e.g., moving from 80% to 90% for payment modules) and update deprecated library preferences.
*   **AI Action:** The AI should track how many times a specific guardrail is bypassed and periodically report: *"I noticed the 'Strict CSP' rule has been bypassed 15 times this month; should we review and update the policy?"*

### 5.5 The "Glass-Break" Emergency Protocol
In a production crisis (site down), waiting for a 20-minute CI/CD pipeline is not an option.
*   **The Risk:** Emergency fixes often skip all security checks, introducing new vulnerabilities.
*   **The Guardrail:** 
    *   **The Override:** Only a designated "Crisis Lead" can trigger a `FORCE_MERGE`.
    *   **The Debt Payback:** Any code merged via "Glass-Break" must be retroactively put through the full Guardrail Pipeline (Modules 1-4) within 24 hours of the incident.
*   **AI Action:** If the user asks for a "quick fix" to bypass the pipeline, the AI must warn: *"This is a Glass-Break action. I will provide the fix, but I am marking this as 'Security Debt' that must be audited within 24 hours."*

---
# 📦 Module 6: Critical Production Safeguards

**Purpose:** This is the "Final Shield." While Modules 1-5 cover the architecture, coding, testing, and governance, Module 6 addresses the high-impact, low-frequency failures that can cause catastrophic production outages or total system compromises. These are the **Enterprise-Grade Guardrails** that separate a "working app" from a "hardened production system."

The AI must treat these five rules as **Hard Constraints**. If any of these are violated, the code is considered "Unsafe for Production."

---

### 6.1 Database Migration Safety (Zero-Downtime Requirement)
In a production environment, locking a table for a schema change can cause a site-wide outage.
*   **The Rule:** All database migrations must be **Backward Compatible**.
*   **The "Two-Step Deploy" Requirement:** The AI is strictly forbidden from generating a single migration that drops a column while the current code is still using it.
    *   **Deploy 1:** Stop writing to the column/table (code change) $\rightarrow$ Deploy.
    *   **Deploy 2:** Drop the column/table (migration change) $\rightarrow$ Deploy.
*   **The Warning Trigger:** Any migration involving `DROP COLUMN`, `DROP TABLE`, or `RENAME COLUMN` must be flagged as a **`CRITICAL WARNING`**.
*   **Migration Rollback Requirement:** Every migration must have a tested rollback script (e.g., `down` migration in Flyway, Alembic, Knex). The rollback must restore both schema and data to the pre‑migration state within 5 minutes.
*   **AI Action:** If the AI generates a migration that drops a column, it must stop and output: *"⚠️ WARNING: This is a destructive change. To ensure zero-downtime, I recommend a two-step deployment. Would you like me to draft the transition plan?"*

**Implementation Standard:** See `CODING_STANDARDS.md` Pillar 4.9 (Background Jobs) for the specific validation helper pattern. The `validateUrl` helper must be placed in `src/lib/security/url-validator.ts`.

### 6.2 Third-Party SDK & Supply Chain Security
Adding a new package is not just a functional choice; it is a security risk (Supply Chain Attack).
*   **The Rule:** No package shall be added based solely on functionality. Its "Health Score" must be verified.
*   **Implementation:** Before suggesting npm install, the AI must state: ‘I recommend [Package]. Please verify its health at snyk.io/advisor – check last commit date, weekly downloads, and known CVEs.’ The AI will then include the package with an exact version (--save-exact).
*   **Vetting Criteria:**
    *   Maintenance frequency (Last commit date).
    *   Community adoption (Weekly downloads).
    *   Known vulnerabilities (CVEs).
*   **AI Action:** When suggesting a new library, the AI must state: *"I recommend [Package Name]. I have checked its health score; it is widely adopted and has no critical CVEs. A less secure alternative would be [X], which I have avoided."*
- **Lockfile Requirement:** Always commit the lockfile (`package-lock.json`, `yarn.lock`, `poetry.lock`, `Cargo.lock`) to Git. This ensures deterministic, reproducible builds across all environments.

### 6.3 SSRF Prevention (Server-Side Request Forgery)
Allowing a server to fetch a URL provided by a user can lead to the leakage of internal cloud metadata (e.g., AWS IAM keys).
*   **The Rule:** Any outbound HTTP request based on user input must be strictly isolated.
*   **Implementation:**
    *   **The Allow-List Approach:** Validate the destination URL against a hardcoded list of approved domains.
    *   **The Network Block Approach:** Block all requests to internal IP ranges:
        *   `127.0.0.1` / `::1` (Loopback)
        *   `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (Private RFC 1918)
        *   `169.254.169.254` (Cloud Metadata Service)
*   **AI Action:** Whenever the AI writes code that uses `fetch`, `axios`, or `http.request` with a user-supplied URL, it **MUST** implement a validation function that blocks the internal IP ranges listed above.

### 6.4 Automated Sensitive Data Redaction (Logging Hygiene)
Debugging logs are a goldmine for attackers if they contain PII or credentials.
*   **The Rule:** Sensitive data must be masked **before** it ever reaches the stdout/log-file.
*   **Implementation:** The AI must not use raw `console.log()` for objects. It must implement a **Logger Serializer** (e.g., using Pino's `redact` option or a custom Winston format).
*   **The Masking List:** Redact any field matching these case‑insensitive patterns (including nested paths like `user.creditCard.number`):
    - `password`, `passwd`, `pwd`
    - `token`, `jwt`, `accessToken`, `refreshToken`
    - `secret`, `apiKey`, `clientSecret`
    - `creditCard`, `cvv`, `cardNumber`
    - Use a regex like `/(password|token|secret|creditCard)/i` to match any object key.
**For Commercial/Production tier, the logger must also include the following fields per `CODING_STANDARDS.md` Pillar 4.7:**
- `correlationId` (propagated from request headers)
- `module` (service/component name)
- `durationMs` (for performance tracking)
*   **AI Action:** The AI must generate a global `logger.js` utility that includes a redaction array of these keywords, ensuring no sensitive data is leaked to Sentry, CloudWatch, or the terminal.

### 6.5 Subresource Integrity (SRI) for External Assets
Using a CDN (Content Delivery Network) introduces a trust dependency. If the CDN is hacked, the attacker can inject malicious JS into your site.
*   **The Rule:** All third-party scripts loaded from a CDN must be verified via a cryptographic hash.
*   **Implementation:** Every `<script>` or `<link>` tag pointing to an external domain must include the `integrity` attribute (SHA-384/512).
*   **Example:** `<script src="https://cdn.com/lib.js" integrity="sha384-..." crossorigin="anonymous"></script>`
*   **AI Action:** If the AI suggests adding a CDN link for a library (like Stripe, Google Analytics, or Tailwind), it **MUST** provide the correct `integrity` hash or remind the user to generate one using an SRI generator.

### 6.6 Graceful Shutdown (SIGTERM Handling)
**The Rule:** The server must listen for `SIGTERM` to avoid dropping active requests during restarts (Kubernetes, ECS, PM2).
**AI Action:** Include the exact code snippet from Module 4.5 (already present) in the main server entry point.

---

### 🛠 AI Learning Checkpoint (Module 6)
*If the AI reads this module, it is now bound by these final critical constraints:*
1. It will **block `DROP COLUMN`** migrations and suggest a two-step deploy.
2. It will **vet NPM packages** via health scores before suggesting them.
3. It will **block internal IP ranges** in any user-driven outbound HTTP requests (SSRF protection).
4. It will implement a **Logger Serializer** to automatically redact `password`, `token`, and `secret` fields.
5. It will insist on **SRI (`integrity` attributes)** for all external CDN scripts.

***
## 🎓 Final Summary: The Complete AI Life-Cycle

You have now provided the AI with a complete cognitive architecture. Here is how the AI will process every request from now on:

1.  **Plan (Module 1):** Threat Model $\rightarrow$ PoLP $\rightarrow$ Secret Management.
2.  **Execute (Module 2):** Zod Validation $\rightarrow$ Parameterized Queries $\rightarrow$ XSS Sanitization $\rightarrow$ Ownership Checks.
3.  **Stress Test (Module 3):** Empty/Giant States $\rightarrow$ Concurrency $\rightarrow$ Latency $\rightarrow$ Accessibility.
4.  **Verify (Module 4):** Pre-commit $\rightarrow$ SAST/SCA $\rightarrow$ Unit/E2E $\rightarrow$ DAST $\rightarrow$ Runtime Monitoring.
5.  **Govern (Module 5):** Human Sign-off $\rightarrow$ RCA $\rightarrow$ Policy Updates $\rightarrow$ Emergency Protocols.


1. In your AI's system instructions (or `.cursorrules`), add this line: 
   **"You are bound by the rules defined in `ENGINEERING_MANIFESTO.md`. You must act as a Senior DevSecOps Lead. If a user request violates these guardrails, you must warn them, explain why, and suggest the secure alternative before proceeding."**

"If a rule in GUARDRAILS.md contains a contradiction (e.g., conflicting statements about CSRF), you MUST flag the contradiction to the human and default to the stricter, more secure interpretation (implement both SameSite=Strict AND CSRF tokens). Never choose the less secure option."