I have integrated the reviewer's forensic analysis and implemented the prioritized improvements. The revised `DESIGN_BLUEPRINT.md` now includes:

1. **Explicit Unblock Tokens** – Every phase gate now requires a precise token (e.g., `@ai-unblock-prd`) to proceed.
2. **Machine-Checkable Exit Criteria** – Phase 1 uses a checkbox-style checklist for deterministic verification.
3. **Change Control Intervention (Meta-Phase 6)** – A formal protocol for handling scope changes after approval.
4. **Cross-Phase Gap Analysis Enforcement** – Phase 4 now includes a mandatory verification that every `SHALL` requirement has a corresponding task.
5. **Test Design Document (formerly Phase 5)** – Resolves the temporal paradox by requiring test skeletons *before* implementation.
6. **Explicit Prototype Fast-Path** – Defines exactly what "Skip to Phase 4" means with minimal required artifacts.

Below is the updated, production-ready document.

---

# 🏗️ DESIGN_BLUEPRINT.md – The Architectural Engine

**Purpose:** To transform a high-level "vibe" or a vague prompt into a rigorous, professional engineering specification. This document prevents "hallucinated architecture" and ensures that the AI understands the **Why**, the **What**, and the **How** before a single line of code is written.

**The Golden Rule:** **NO CODE WITHOUT A BLUEPRINT.** If the request is complex, the AI must halt and execute the following pipeline.

**Risk Tier Awareness:** The depth of this process is governed by the project's risk tier as defined in `GUARDRAILS.md`.
- **Prototype:** Condensed execution path (see Section 0.1 below).
- **Internal Tooling:** All phases recommended; Phases 4-5 may be streamlined.
- **Commercial/Production:** All five phases are **MANDATORY** and must be executed sequentially with human approval at each gate.

---

## 0.0 Tier‑Based Execution Modifiers

### 0.1 Prototype Mode (Fast Path)
If `GUARDRAILS.md` Tier == **Prototype**:
- **Phase 1:** Execute only 1.1 (Objective & Tech Stack). Skip 4 Pillars detailed scan.
- **Phase 2:** **SKIP** (No formal PRD/Gherkin required).
- **Phase 3:** **SKIP** (Schema and API design will emerge during coding).
- **Phase 4:** Generate a **Minimal Task List** (5–10 items) based directly on the objective.
- **Phase 5:** **SKIP** (Manual testing only).
- **Gate Tokens:** Not required for Prototype mode.

### 0.2 Internal Tooling Mode
- Execute all phases.
- Phase 4 may use a streamlined Task Template (omitting the `Dependencies` field).
- Phase 5 may skip E2E tests but must include Unit tests.

### 0.3 Commercial Mode
- **All gates are mandatory.**
- All unblock tokens must be received before proceeding.
- Full Phase 5 test skeleton generation required.

---

## 🔄 The Planning Pipeline (The 5‑Step Flow)

The AI must move through these phases sequentially. It cannot skip a phase unless explicitly allowed by the Tier Modifiers (Section 0.1).

---

### Phase 1: The Discovery Loop (Intake & Clarification)

**Purpose:** Eliminate ambiguity. Transition from "Code Generator" to "Business Analyst."

**The "Halt" Command:** The AI is **STRICTLY FORBIDDEN** from generating architecture, schema, or code until the Discovery Loop is closed and the **Exit Checklist** is fully checked.

#### 1.1 The Intake Analysis (The Gap Scan)
Upon receiving a prompt, the AI must execute a **Gap Analysis** against the **Four Pillars of Clarity**.

| Pillar | Requirement | AI Check | Gap Indicator |
| :--- | :--- | :--- | :--- |
| **1. Core Objective** | Singular, clear "North Star" goal. | Does the prompt define exactly what "success" looks like? | "Build a site for a gym" vs "Build a membership booking system for a gym." |
| **2. User Personas** | Definition of every actor. | Are user roles and primary goals identified? | "Users can login" vs "Admin manages schedules; Member books classes." |
| **3. Technical Constraints** | Hard boundaries (Stack, Compliance). | Are non-negotiable tech/legal constraints defined? | "Use a database" vs "Must use PostgreSQL and deploy on Vercel." |
| **4. Success Metrics** | Quantifiable KPIs. | Is there a way to measure success? | "It should be fast" vs "Page load < 1.5s, support 50 concurrent checkouts." |

#### 1.2 The Targeted Query Framework
If any Gap Indicator is triggered, the AI must enter **Discovery Mode** and output the following block verbatim:

> ### 🔍 Discovery Loop: Information Gaps Detected
> I have analyzed your request against `DESIGN_BLUEPRINT.md` standards. To avoid architectural rework, I need to resolve the following ambiguities:
> 
> **1. Objective Clarification:** [Specific question about the North Star goal]
> **2. Persona Mapping:** [Specific question about user roles and permissions]
> **3. Constraint Validation:** [Specific question about tech stack or compliance]
> **4. Metric Definition:** [Specific question about how to measure success]
> 
> **Current Status:** 🔴 **BLOCKED**. I will halt all code generation until these gaps are filled.

#### 1.3 The "Refinement" Iteration
- **Validation Loop:** `User Answer` → `Re-scan against 4 Pillars` → `Identify new gaps` → `Ask follow-up questions`.
- **Assumption Log:** If an assumption is necessary to proceed, it must be documented as:
  - `ASSUMPTION [ID]: [Assumption] → [Risk if wrong]`.

#### 1.4 Deterministic Exit Criteria (Machine‑Checkable)
The AI may only exit Phase 1 when **all** of the following checkboxes can be marked as true:

```text
[ ] Objective: A single, unambiguous sentence describing the goal exists and has length > 20 characters.
[ ] Personas: A list of at least one role with a mapped primary action exists.
[ ] Constraints: The tech stack is specified; compliance needs are explicitly stated (or marked "None").
[ ] Metrics: At least one quantifiable success metric (number/percentage/time) is defined.
[ ] Assumptions: All assumptions are logged and the user has explicitly accepted them with `@ai-accept-assumptions`.
```

**AI Action on Exit:**
> "✅ **Discovery Loop Closed.**
> - **Goal:** [Summarized Goal]
> - **Personas:** [List of Roles]
> - **Constraints:** [Stack/Compliance]
> - **Metrics:** [KPIs]
> 
> **Next Step:** Awaiting command `@ai-unblock-prd` to proceed to Phase 2."

---

### Phase 2: The PRD (Product Requirements Document)

**Purpose:** Translate raw data into a formal, behavior‑driven specification.

#### 2.1 The User Story Engine (Gherkin Standard)
- **Structure:** `As a [Persona] I want to [Action] so that [Value]`.
- **Acceptance Criteria:** Each story must have at least one **Happy Path** and one **Edge Case** scenario in `Given/When/Then` format.

#### 2.2 Functional Requirements (The "Shall" Statements)
- **SHALL:** Mandatory.
- **SHOULD:** Recommended.
- **MAY:** Optional.
- **Security Requirements:** Any requirement derived from `GUARDRAILS.md` Module 2 MUST be included as a "Shall" statement.

#### 2.3 Boundary Definition (The "Out‑of‑Scope" Wall)
| Feature | Status | Reason |
| :--- | :--- | :--- |
| [Feature Name] | ❌ Out of Scope | [Reason] |

#### 2.4 The Definition of Done (DoD) Checklist
- [ ] All Gherkin scenarios pass.
- [ ] Input validation (Zod) implemented for all fields.
- [ ] Accessibility (WCAG) check passed.
- [ ] Unit test coverage ≥80% (per `CODING_STANDARDS.md` Pillar 7.1).
- [ ] All "Shall" requirements verified.

**The "Stop & Sync" Requirement:**
After outputting the PRD, the AI must halt and output:
> "✅ **Phase 2: PRD Complete.**
> **Action Required:** If you approve, reply with **exactly** `@ai-unblock-rfc`. Any other input will be treated as a modification request and will loop back to Phase 1.3 Refinement."

---

### Phase 3: The RFC (Technical Blueprint)

**Purpose:** Translate "What" (PRD) into "How" (System Internals).

#### 3.1 High‑Level Architecture
- **Request Path:** `User Action` → `Frontend Component` → `Custom Hook` → `API Endpoint` → `Controller` → `Service` → `Repository` → `Database`.
- **Environment Variable Inventory (Mandatory Table):**
  | Variable Name | Scope | Purpose | Rotation Policy |
  | :--- | :--- | :--- | :--- |
  | `DATABASE_URL` | `server` | Connection string | 90 days |
  | `NEXT_PUBLIC_*` | `client` | Public keys | Never |

#### 3.2 Data Model
- **Table Name:** `snake_case`.
- **Columns:** Name, Type, Constraints.
- **Relationships:** PK, FK, Cardinality.
- **Indexing Strategy.**
- **Migration Safety Warning:** Any `DROP COLUMN` or `RENAME COLUMN` must be flagged: *"⚠️ Destructive migration detected. Per GUARDRAILS.md 6.1, this requires a two‑step deployment."*

#### 3.3 API Contract
- Every endpoint documented with **Universal Response Envelope** (`CODING_STANDARDS.md` Pillar 4.2).
- **Symmetry Check Table:** Map every PRD User Story to an endpoint. If a story has no endpoint, **HALT** with `❌ Technical Gap`.

#### 3.4 Trade‑off Analysis
For major decisions: `Option A` vs `Option B` → `Winner` → `Reasoning`.

**The "Stop & Sync" Requirement:**
> "✅ **Phase 3: RFC Complete.**
> **Action Required:** If you approve, reply with **exactly** `@ai-unblock-roadmap`."

---

### Phase 4: The Implementation Roadmap (Atomic Decomposition)

**Purpose:** Transform RFC into a linear sequence of atomic tasks.

#### 4.1 Atomic Task Criteria
- Single purpose.
- Verifiable with Pass/Fail test.
- Independent of other pending tasks.
- Affects ≤3 files or <50 lines of code.

#### 4.2 Bottom‑Up Sequencing
1. Database → 2. Repository → 3. Service → 4. Controller → 5. Frontend Service → 6. UI → 7. E2E → 8. Pipeline (CI skeletons prepared in parallel).

#### 4.3 Task Specification Template
- **Task ID:** `[TASK-XXX]`
- **Title:** Action‑oriented.
- **Layer:** e.g., `Repository`.
- **Implementation Detail:** 1‑2 sentences.
- **Verification:** Exact test to prove success.
- **Dependencies:** Environment variables or external services required.

#### 4.4 Symmetry Mapping & Cross‑Phase Gap Analysis (Mandatory Verification)
Before finalizing the Roadmap, the AI **MUST** run this verification:

```text
FOR each "Shall" requirement in Phase 2.2:
    IF requirement has NO corresponding Task ID in the Roadmap:
        HALT with: "❌ ORPHANED REQUIREMENT: [Requirement] has no implementation path."
    ELSE:
        Mark requirement as [Verified] in the Traceability Matrix.
```

| User Story ID | Required Tasks | Status |
| :--- | :--- | :--- |
| `US-01` | `TASK-04`, `TASK-08` | ✅ Verified |

**The "Stop & Sync" Requirement:**
> "✅ **Phase 4: Roadmap Complete.**
> **Action Required:** If you approve, reply with **exactly** `@ai-unblock-tdd`."

---

### Phase 5: Test Design Document (TDD Blueprint)

**Purpose:** Define the test skeleton **before** writing implementation code. This resolves the "Phase 5 Temporal Paradox" by creating empty test files that will fail until the feature is built.

#### 5.1 The Test‑First Mandate
The AI must output **actual test file skeletons** (e.g., `__tests__/user-story-01.test.ts`) with `test.todo()` or equivalent failing tests that map 1:1 to Gherkin scenarios.

**Example Output:**
```typescript
// __tests__/booking.spec.ts
describe('US-01: Member books a class', () => {
  test.todo('Successful Booking (Happy Path)');
  test.todo('Class Full (Edge Case)');
});
```

#### 5.2 The Validation Pyramid (Layered Tests)
- **Unit:** 100% branch coverage.
- **Integration:** Testcontainers for DB.
- **E2E:** Playwright/Cypress for happy path.

#### 5.3 Edge Case Injection
Include tests for Giant State, Malicious State, Empty State, Concurrency State (from `GUARDRAILS.md` Module 3).

**The "Final Sync" Requirement:**
> "✅ **Phase 5: Test Design Document Complete.**
> **Action Required:** If you approve, reply with **exactly** `@ai-start-implementation`. I will then begin `TASK-01` using the Test‑First approach: write failing test → implement → verify Green Light."

#### 5.4 The "Green Light" Protocol (Task Closure During Implementation)
When executing a task, the AI must output a **Verification Report** after passing all checks:
- [ ] Static Pass (Lint/Type)
- [ ] Logic Pass (Unit Tests)
- [ ] Integration Pass (Regression)
- [ ] Security Pass (Zod)

---

## 🔁 6.0 The Change Control Intervention (CCI)

**Trigger:** Any user message that **contradicts an approved artifact** (PRD, RFC, Roadmap) **after** the corresponding `@ai-unblock-*` gate has been passed.

**AI Protocol:**
1. **Halt Active Implementation.**
2. **Output Impact Analysis:**
   > "🔄 **Pivot Protocol Activated.** Change detected: `[Description]`.
   > - **PRD Impact:** [Update required?]
   > - **RFC Impact:** [Schema/API changes?]
   > - **Roadmap Impact:** [Tasks to be rolled back/redefined?]
   > 
   > **Options:**
   > - `A`: Rewind to **Phase [X]** to incorporate change properly.
   > - `B`: Log as `DEBT-[ID]` and proceed with current plan (faster, riskier).
   > 
   > Please reply with `Option A` or `Option B`."
3. **If Option A:** AI rolls back to the specified phase, resets approval state, and awaits new `@ai-unblock` token.
4. **If Option B:** AI records debt in `TECH_DEBT.md` and continues execution.

---

## 🛠 AI Execution Protocol Summary

1. **Analyze Prompt → Check `GUARDRAILS.md` Risk Tier.**
2. **If Prototype:** Apply Fast Path (Section 0.1) → Generate minimal task list → Execute.
3. **If Internal/Commercial:** Execute Phases 1–5 sequentially.
4. **Never proceed past a gate without the exact `@ai-unblock-*` token.**
5. **If change occurs post‑approval, trigger Change Control Intervention (Section 6.0).**