---

# 📐 CODING_STANDARDS.md – Engineering Excellence (Final)

**Purpose:** This document defines how to write code – the structure, naming, architecture, documentation, testing, and Git hygiene. It complements `GUARDRAILS.md` (security and reliability).

**Scope:** All code generated for this project, regardless of language or framework.

**Conflict Resolution:** If a rule conflicts with `GUARDRAILS.md`, `GUARDRAILS.md` takes precedence for security and reliability. If two non‑security rules conflict, apply the more specific rule; if still ambiguous, escalate to human (see HITL section).

**AI Agent Instruction:** You are bound by both documents. Apply risk profile first, then enforce rules below. If a rule conflicts with a user request, flag the conflict and propose compliant alternative.

---
## 🎚️ Project Risk Profile

The risk tier is defined in `GUARDRAILS.md` (Commercial/Production, Internal Tooling, Prototype/Throwaway).  
This document enforces the following pillars per tier:

| Tier (from GUARDRAILS.md) | Pillars Enforced in This Document |
| :--- | :--- |
| **Commercial/Production** | All Pillars (0‑7) |
| **Internal Tooling** | Pillars 0, 1, 2, 5, 6, 7 (others are advisory) |
| **Prototype/Throwaway** | Pillar 0 only (all others optional) |

**AI Action:** State the tier as defined in `GUARDRAILS.md` and then enforce the corresponding pillars above.
## 🤝 HITL Interaction Protocol (Human‑in‑the‑Loop)

**Purpose:** To prevent the AI from making irreversible assumptions or silently failing when requirements are ambiguous or in conflict.

### 1. AI Blocked State (`@ai-blocked`)
**Trigger:** The AI encounters a situation where:
- Two mandatory rules conflict (e.g., Security requires X, Performance requires Y).
- A user request is ambiguous and the AI cannot infer intent.
- A decision requires human judgment (e.g., trade‑off between readability and strict size limits).

**Mandatory AI Action:** Stop generating functional code. Output the following block **verbatim** as a comment in the affected file (or as a terminal response)
**AI Behavior after outputting:** **HALT.** Do not generate further code for this feature until the human responds.

### 2. Human Unblock Command (`@ai-unblock`)
**Human Action:** The developer reviews the `@ai-blocked` comment and replies with:

```javascript
// @ai-unblock: [Decision]
// @rationale: [Brief reason for the decision]
```

**AI Action on receiving `@ai-unblock`:**
1. Parse the decision.
2. Resume code generation following the unblocked path.
3. **Do not delete** the `@ai-blocked` comment; it remains as documentation of the decision point.

### 3. AI Exception Override (`@ai-exception`)
**Trigger:** The user explicitly instructs the AI to violate a standard (e.g., *"I know this is a magic number, just use 42 here."*).

**AI Action:** Proceed with the violation, but annotate the code with:

```javascript
// @ai-exception: [Rule Violated] - Approved by [Human Name/Context]
```

# 🚫 Pillar 0: Global Prohibitions (The "Never Generate" List)

These rules apply to ALL code, regardless of risk tier. Violations MUST be flagged and corrected.

### 0.1 Forbidden TypeScript Escape Hatches
| Pattern | Why Forbidden | Correct Alternative |
| :--- | :--- | :--- |
| `// @ts-ignore` | Silences real type errors. | Use `// @ts-expect-error - [REASON] - Expected resolution: [DATE or CONDITION]`. Example: `// @ts-expect-error - Third-party types pending @types/foo@2.0 release expected Q2 2026` |
| `any` type (unless in third‑party type shim) | Disables type checking. | Prefer `unknown` with narrowing, or a specific `interface`. |
| `debugger;` statement | Pauses execution; can accidentally ship to production. | Remove entirely or wrap in `if (process.env.NODE_ENV === 'development') { debugger; }` |

### 0.2 Forbidden Error Handling Anti‑Patterns
| Pattern | Why Forbidden | Correct Alternative |
| :--- | :--- | :--- |
| `catch (e) { }` (empty block) | Swallows errors silently. | Log the error (`logger.error(e)`), rethrow, or return a fallback value. |
| `catch (e) { console.log(e) }` | `console.log` in production (see below). | Use structured logger. |

### 0.3 Forbidden Logging & Debugging
| Pattern | Why Forbidden | Correct Alternative |
| :--- | :--- | :--- |
| `console.log`, `console.debug`, `console.warn`, `console.error` | Bypasses structured logging, cannot be filtered in production. | Use `logger.info`, `logger.error`, etc. (Pillar 4.7). |

**AI Action:** Before finalizing any code block, scan for these patterns. If found, replace with the correct alternative and note the change in the audit output.
### 0.4 License Compliance Check (Third‑Party Packages)
- **Trigger:** AI suggests `npm install <package>` or `yarn add <package>`.
- **Action:** 
    - Query the package license (via `npm view <package> license` logic if possible, or check memory).
    - If license is `GPL`, `AGPL`, or `CC BY-NC`:
        - **Stop.** Warn the user: *"⚠️ License Warning: [Package] is [License] licensed. This may violate Commercial/Production distribution terms. Consider the MIT/Apache‑2.0 alternative: [Alternative]."*
    - Do not proceed with generating code that imports the restricted package unless the user explicitly overrides the warning with a comment: `// @license-override: Approved by Legal`.

# 🏗️ Pillar 1: Naming Conventions & Semantic Clarity

### 1.1 Case Style Registry
| Identifier Type | Casing | Example |
| :--- | :--- | :--- |
| Variables / Functions | `camelCase` | `userProfile` |
| Classes / Components | `PascalCase` | `UserProfile` |
| Constants / Env Vars | `SCREAMING_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| Database Columns | `snake_case` | `created_at` |
| Files / Folders | `kebab-case` | `user-profile.tsx` |
| Types / Interfaces | `PascalCase` | `UserRequest` |
| Enums (type name) | `PascalCase` | `UserRole` |

### 1.2 Semantic Variable Naming (No Generic Words)
**Forbidden:** `data`, `info`, `val`, `item`, `obj`, `res`, `temp`, `result`, `tmp`, `tempData`  
**Required:** `[Context] + [Type]` – e.g., `userPayload`, `authResponse`

**Acronyms:**  
- Length ≤2 characters → uppercase all: `UIParser`, `XMLParser`  
- Length ≥3 characters → PascalCase/camelCase normally: `XmlParser`, `httpClient`  
- Exceptions: `id`, `url` remain lowercase.
### 1.2.1 Response Object Naming

When working with API responses, distinguish between the raw response wrapper and the extracted data:

| Pattern | Use For | Example |
| :--- | :--- | :--- |
| Suffix `Response` | Raw API response containing metadata/pagination | `userResponse`, `ordersResponse` |
| Suffix `Dto` | Transformed data transfer object | `userProfileDto`, `orderSummaryDto` |
| Bare name | The actual domain entity | `user`, `order` |

**AI Action:** When generating code that fetches data from an API, always extract the entity from the response wrapper and assign a meaningful name:
```typescript
// ✅ Correct
const userResponse = await api.getUser();  // { data: User, pagination: ... }
const user = userResponse.data;

// ❌ Misleading
const user = await api.getUser();  // user actually contains { data, pagination }
user.email // undefined
```

### 1.3 Boolean Logic Naming
**Prefix required:** `is`, `has`, `should`, `can`, `did`  
**Negative boolean refactoring:**  
- `isNotActive` → `isActive` (use `!isActive`)  
- `isInvalid` → `isValid` (use `!isValid`)  
- `hasNoPermission` → `hasPermission`

### 1.4 Function & Method Naming
- `get` → synchronous retrieval  
- `fetch` → asynchronous/remote  
- `on` → event handlers (avoid `handle`)  
- `validate` → returns boolean or throws  
- `convert` / `toggle` / `authorize` – specific verbs

### 1.5 Entity & Type Naming
- API types: suffix `Request` / `Response`  
- DTOs: suffix `Dto`  
- `interface` for extensible shapes, `type` for unions/aliases

### 1.6 Forbidden Anti‑Patterns
- Single‑letter variables: only `i,j,k` (loops), `e` (catch), `x,y` (coordinates), `_` (unused – use `_1`, `_2` for multiple)  
- Lazy abbreviations: `usrAddr` ❌ → `userAddress` ✅  
- Redundant naming: `user.userName` ❌ → `user.name` ✅  
- Magic numbers: always named constants

### 1.7 Enum Member Standard (Clarified)
**Default rule:** Use `SCREAMING_SNAKE_CASE` for all enum members (avoids serialization confusion).  
**Exception:** If enum is in a `.d.ts` file or has `// @type-only` comment, `PascalCase` permitted.

**AI Action:** Default to `SCREAMING_SNAKE_CASE`. Only use `PascalCase` for type‑only enums.
### 1.8 React‑Specific Naming Extensions

| Identifier Type | Pattern | Example |
| :--- | :--- | :--- |
| Custom Hooks | `use` + `[Domain][Action]` | `useUserAuth`, `useCartCheckout`, `useDebouncedValue` |
| Event Handler Props | `on` + `[Event]` | `onSubmit`, `onItemSelect`, `onModalClose` |
| Event Handler Functions | `handle` + `[Event]` | `handleSubmit`, `handleItemSelect`, `handleModalClose` |
| Context Providers | `[Domain]Provider` | `ThemeProvider`, `AuthProvider`, `CartProvider` |
| Context Consumers | `use[Domain]` | `useTheme`, `useAuth`, `useCart` |

**AI Action:** When generating React components:
- Custom hooks MUST start with `use`
- Props that accept event handlers MUST start with `on`
- Internal handler functions SHOULD start with `handle`
- Context providers MUST end with `Provider`
### 1.9 Test File Naming

| Test Type | Naming Convention | Location |
| :--- | :--- | :--- |
| Unit / Integration | `[filename].test.ts` | Co‑located with source file |
| E2E | `[feature].spec.ts` | `/tests/e2e/` directory |
| Test utilities / helpers | `[utility].test-helper.ts` | `/tests/helpers/` |
| Test factories | `[entity].factory.ts` | `/tests/factories/` |

**AI Action:** When generating a test file, use `.test.ts` suffix and place it in the same directory as the file being tested. For E2E tests, use `.spec.ts` in the dedicated e2e directory.

### 1.10 Shared Schema Source of Truth<br>**Rule:** Validation schemas (Zod, Yup, Joi) that are used by **both** the Frontend and Backend MUST be defined in a **single source of truth**.<br>- **Monorepo:** Place in `packages/shared/src/validators/`.<br>- **Polyrepo:** Place in a dedicated `@org/validators` package or copy with an explicit comment: `// @shared-source: Copied from backend/src/validators/user.schema.ts - Keep in sync manually`.

### 🛠 AI Implementation Checklist (Pillar 1)
- [ ] Correct casing per type?  
- [ ] No forbidden generic words?  
- [ ] Boolean has prefix? Not negative?  
- [ ] Function verb matches operation?  
- [ ] File kebab-case?  
- [ ] No single‑letter (except allowed)?  
- [ ] Magic numbers → constants?  
- [ ] Acronyms measured (≤2 uppercase, ≥3 PascalCase)?  
- [ ] Enum members SCREAMING_SNAKE_CASE (unless type‑only)?

---

# 🏗️ Pillar 2: Architectural Patterns

### 2.1 Layered Architecture (Uni‑Directional Flow)
**Flow:** Request → Routing → Controller → Service → Repository → Database

| Layer | Responsibility | Forbidden |
| :--- | :--- | :--- |
| Routing | Map URL → Controller | ❌ Business logic, DB calls |
| Controller | Parse input using Zod (per GUARDRAILS.md 2.1), call service, return HTTP | ❌ Calculations, direct DB |
| Service | Business logic, orchestration | ❌ HTTP knowledge |
| Repository | DB queries only | ❌ Business logic |

**Definition of Business Logic:** Authorization checks, data transformation/calculation, validation beyond type checking, coordination between multiple repositories.  
**Exception for skipping Service layer:** **NONE.** Even for a simple primary key lookup, create a Service method (e.g., `getUserById(id)`). 
- **Why?** Future feature additions (logging, caching, authorization) must be added in the Service layer. Adding them to a Controller later violates the architecture and increases merge conflict risk.
- **Acceptable Boilerplate:** A 3‑line Service method is acceptable to maintain a strict boundary.

**AI Action:** If you detect business logic in controller or DB call in controller, split into Service/Repository.

### 2.2 Skinny Controller, Fat Service
- Controller ≤15 lines. Only: extract request data → call service → map result to HTTP status → pass errors to global handler.  
- Service contains all business logic.
**Exception for skipping Service layer:**
- **Commercial/Internal tiers:** Exception: NONE. Even single‑line database operations require a Service layer method.
- **Prototype tier:** Service layer optional. Single‑file endpoints acceptable with comment: `// @prototype-skip-service: Demo only, will refactor if production‑bound`

**AI Action:** For Prototype tier requests, you may generate controller‑only database access. For all other tiers, enforce the full layered architecture.

### 2.3 Dependency Injection (DI)
**Forbidden:** `new Database()` inside function/class.  
**Required:** Inject via constructor/parameters.

**Circular dependency prevention:** Dependency graph must be a DAG. If A needs B and B needs A, extract shared logic to a third service or use events.

**AI Action:** Detect cycles and suggest extraction or event‑driven alternative.

### 2.4 Single Responsibility & Sizing

| Item | Limit | Action |
| :--- | :--- | :--- |
| Function | ≤30 lines | Split or add readability override (see format below) |
| File | ≤200 lines | Split into modules |
| Class | ≤10 public methods | Break into smaller classes |

**Readability Override Format (required when exceeding 30 lines):**
```javascript
// @size-exception: [switch-statement | config-object | cohesive-algorithm | complex-jsx]
// @components: [what would be extracted]
// @cohesion: [why splitting reduces readability]
// @reviewer: [awaiting PR review]
```

**Exceptions:** Migrations, config files, generated code.

### 2.5 Standardized Error Propagation & Class Hierarchy

**Error flow:** Repository throws `DatabaseError` → Service maps to `DomainError` → Controller maps to HTTP status → Global handler logs and returns generic 500.

**Concrete error classes:**
```typescript
class DomainError extends Error {
  constructor(message: string, public code: string) { super(message); this.name = this.constructor.name; }
}
class NotFoundError extends DomainError {
  constructor(resource: string, id: string) { super(`${resource} ${id} not found`, 'NOT_FOUND'); }
}
class ValidationError extends DomainError { constructor(field: string, reason: string) { super(`Validation failed: ${field} - ${reason}`, 'VALIDATION_FAILED'); } }
class ForbiddenError extends DomainError { constructor(action: string) { super(`Forbidden to ${action}`, 'FORBIDDEN'); } }
class UnauthorizedError extends DomainError { constructor() { super('Authentication required', 'UNAUTHORIZED'); } }

const errorStatusMap: Record<string, number> = {
  'NOT_FOUND': 404, 'VALIDATION_FAILED': 422, 'FORBIDDEN': 403, 'UNAUTHORIZED': 401, 'INTERNAL_ERROR': 500
};
```

**Global error handler example (Express):**
```javascript
app.use((err, req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || uuid();
  logger.error({ correlationId, error: err.stack });
  const status = errorStatusMap[err.code] || 500;
  res.status(status).json({ success: false, error: { message: err.message, code: err.code || 'INTERNAL_ERROR' }, metadata: { timestamp: new Date().toISOString(), requestId: correlationId } });
});
```
### 2.5.1 Central Error Code Registry (Mandatory for Commercial Tier)

**Rule:** All `DomainError` codes MUST be sourced from a single, shared enum.

**File Location:** `src/lib/errors/codes.ts`
**AI Action:**
1. **Before creating a new `DomainError`:** Check if the required error code already exists in `ErrorCode`.
2. **If the code exists:** Use `ErrorCode.EXISTING_CODE`.
3. **If the code is missing:** 
   - Add the new code to the enum (in alphabetical order within the appropriate category).
   - Add a comment above the new code explaining its usage.
   - Use the new enum member in the error constructor.
**Forbidden:** Hardcoding string literals in error constructors (e.g., `new DomainError('...', 'INVALID_EMAIL')`). Use `ErrorCode.VALIDATION_FAILED` instead.

**Exception:** If the project is not using TypeScript, a `constants/errorCodes.js` object with `Object.freeze()` is acceptable.
   
### 2.6 Transaction Boundaries

**Rule:** Database transactions MUST be managed at the Service layer, NEVER in Controllers or Repositories.

**Pattern:**
```typescript
class OrderService {
  async createOrder(data: CreateOrderDto): Promise<Order> {
    return await this.db.$transaction(async (tx) => {
      const order = await this.orderRepo.create(data, tx);
      await this.inventoryRepo.decrementStock(data.items, tx);
      await this.auditRepo.logCreation('ORDER', order.id, tx);
      return order;
    });
  }
}
```
### 🛠 AI Implementation Checklist (Pillar 2)
- [ ] Layers respected? Exception criteria met?  
- [ ] Controller ≤15 lines, no business logic?  
- [ ] Dependencies injected, no `new`? No circular deps?  
- [ ] Function/file sizes within limits or have override comment?  
- [ ] Errors use hierarchy and status mapping? Global handler present?

---

# 🏗️ Pillar 3: Frontend Development Standards

### 3.1 Component Anatomy & File Organization
**Order:** Imports → Types → Custom Hooks → Main Component → Helper Components → Styles  
**Atomic rule:** UI used >2 places → extract to `/components/ui`  
**Size constraint:** Component file >150 lines → suggest split  
**Error boundary:** Every route component MUST be wrapped in `react-error-boundary`.

### 3.12 Cross‑Browser Compatibility (Tooling Enforcement)

**Rule:** The application must support the browsers defined in `.browserslistrc`.

**AI Action:**
- The AI is **NOT** required to memorize JavaScript API compatibility tables.
- The AI SHOULD use standard, widely‑supported syntax.
- Enforcement is delegated to **ESLint** with the `eslint-plugin-compat` plugin.

**Project Setup Requirement (Human/CI):**
- Add `browserslist` configuration.
- Add `eslint-plugin-compat` to ESLint config.
- The CI pipeline will fail if incompatible APIs are used.

**AI Guidance:** When generating modern JavaScript (ES2020+), the AI may assume the environment is modern, but the linter will catch any issues. The AI should not pre‑emptively polyfill unless the user explicitly requests it.

### 3.2 State Management Hierarchy
- Local component → `useState` / `useReducer`  
- Parent + few children → lift state up  
- Multiple unrelated branches → Context API (scoped)  
- Critical app‑wide → Zustand / Redux  
- Prop drilling >3 levels → MUST use Context or global store

### 3.3 Frontend Service Layer (API Isolation)
**Pattern:** Component → Custom Hook (starts with `use`) → API Service  
**Forbidden:** `fetch`/`axios` directly inside component.  
**Abort controller required** in custom hooks.

**Rules of Hooks compliance:** Custom hooks must only be called at top level, not conditionally.

### 3.4 Styling & Design System (Expanded for Multiple Approaches)

**Rule:** The AI must adapt to the project's styling solution.

| Styling Approach | Mandatory Rules | Example |
| :--- | :--- | :--- |
| **Tailwind CSS** | Use utility classes exclusively. No custom CSS files. No hardcoded hex/pixel values – use Tailwind theme tokens. | `className="bg-primary-500 p-4"` |
| **CSS Modules** | Use kebab-case class names. Follow BEM naming convention: `Block__Element--Modifier`. Never use global `.css` files. | `styles.cardHeader`, `styles.cardHeader--active` |
| **CSS-in-JS (styled-components/Emotion)** | Use design tokens from a shared theme object. Never hardcode colors or spacing. | `${({ theme }) => theme.colors.primary}` |
| **Sass/SCSS** | Use variables from a central `_variables.scss` file. Nesting max 3 levels deep. | `$primary-color: #...` |

**Mobile‑First Responsive (All Approaches):**
- Default styles = mobile (< 640px)
- Overrides for larger breakpoints: `md:` (768px), `lg:` (1024px), `xl:` (1280px), `2xl:` (1536px)
- Never use `!important`

### 3.5 Performance Optimization (Concrete Triggers – Statically Verifiable)

**Rule:** The AI MUST apply optimizations based on **code structure**, not estimated runtime metrics.

| Scenario | Structural Trigger (AI Verifiable) | Solution |
| :--- | :--- | :--- |
| Derived data in render | The component's `return` statement contains `.map()`, `.filter()`, or `.reduce()` operating on a **prop** or **state** variable. *Exception: If the array is a hardcoded static constant, memoization is optional.* | Wrap the array processing logic in `useMemo`. |
| Function passed to memoized child | A child component is wrapped in `React.memo` **AND** the parent passes a function prop defined inline (e.g., `onClick={() => ...}`). | Wrap the function in `useCallback`. |
| Component re‑renders frequently | The component receives an **object/array prop** that is recreated in the parent's render body. | Wrap the component export in `React.memo`. |
| **Do NOT memoize** | – | Primitive props only, native HTML elements, or components that are rendered once per route. |

**Lazy Loading Trigger:**
- **Trigger:** A component is **route‑level** (e.g., `/pages/*`) or is imported from a heavy library (>50KB as estimated by the AI based on package size).
- **Action:** Wrap import in `React.lazy()` and provide a Suspense fallback.

**Image Performance Trigger:**
- **Trigger:** An `<img>` tag is generated without `loading` attribute.
- **Action:** Add `loading="lazy"` and explicit `width`/`height` attributes to prevent Cumulative Layout Shift (CLS).

**AI Action:** When generating a component, scan for the structural triggers above. Apply the corresponding optimization automatically. If uncertain whether a child is memoized, **default to applying `useCallback`**—it is safer to memoize than to risk performance degradation.


### 3.6 Accessibility (WCAG 2.1 Level AA) – Mandatory

**Foundation:** Accessibility is non‑negotiable for Commercial tier.

 **Trigger:** AI needs a Modal, Dropdown Menu, Tabs, Tooltip, or Popover.<br>- **Mandatory Action:** **DO NOT generate a custom `div`‑based implementation.** <br> - **Default:** Use **Radix UI Primitives** or **Headless UI**.<br> - **Exception (Human‑Approved):** If a Radix primitive does not fit the design, the AI **MAY** generate a custom component **ONLY IF** it adds the comment `// @a11y-exception: Custom component required. Manual keyboard nav and focus trap audit mandatory before merge.` immediately above the component declaration. **Without this explicit human instruction, the AI MUST reject the request and output the standard `@ai-blocked` response.**

- **Exception (Requires Human Approval):**
  - If a Radix primitive does not meet a unique design requirement, the AI **MAY** generate a custom component **ONLY IF** it adds the following comment immediately above the component declaration:
```tsx
    // @a11y-exception: Custom component required. Manual keyboard nav and focus trap audit mandatory before merge.
```

### 3.7 Form Management Standard (Add)
| Complexity | Library |
|------------|---------|
| 1‑3 fields | native `useState` |
| 4+ fields, validation | React Hook Form + Zod |
| Legacy Formik codebase | maintain Formik |

**AI Action:** For forms >3 fields, default to React Hook Form + Zod.
### 3.8 Routing Standards

**Framework default:** Use file‑based routing (Next.js App Router, Remix, Expo Router) unless project constraints explicitly require config‑based routing.

**Route naming convention:** kebab‑case URLs (`/user-profile`, `/order-history`, `/product-catalog`)

**Route protection pattern:**
```tsx
// middleware.ts or layout.tsx
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) return <LoadingSkeleton />;
  if (!user) return <Navigate to="/login" replace />;
  
  return <>{children}</>;
}
```
### 3.9 Frontend Environment Variables

**Naming and Safety:**

| Prefix | Visibility | Usage |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_` / `VITE_` | Bundled, visible in browser | Non‑sensitive config (API base URL, feature flags, analytics keys) |
| No prefix | Server‑only (API routes, SSR, middleware) | Secrets, internal endpoints, database credentials |

**AI Action:** 
- Never generate code that references `process.env.SECRET_KEY` or similar in client components. Flag as critical error.
- When a client component requires a value from the server, fetch it via an API endpoint—do not expose it via environment variable.

### 3.9 Loading State Standards

Every asynchronous operation that affects the UI MUST have a corresponding loading state.

| Scenario | Required Pattern |
| :--- | :--- |
| Initial page load | Suspense boundary with skeleton component |
| Data fetching within component | `isLoading` state + spinner or skeleton |
| Form submission | Disable submit button + loading text + prevent double‑submit |
| Optimistic updates | Immediate UI update + background sync + rollback on error |

**AI Action:** When generating a component that uses `fetch`, `useQuery`, or `useMutation`, you MUST also generate:
- A loading state (spinner, skeleton, or disabled button)
- An error state with user‑friendly message
- An empty state for zero results

**Example:**
```tsx
const { data, isLoading, error } = useQuery(['users'], fetchUsers);

if (isLoading) return <Spinner />;
if (error) return <ErrorMessage error={error} />;
if (!data?.length) return <EmptyState message="No users found" />;

return <UserList users={data} />;
```

### 🛠 AI Implementation Checklist (Pillar 3)
- [ ] File order correct?  
- [ ] State at lowest level? Prop drilling ≤3?  
- [ ] API calls in service + custom hook with abort? Hook starts with `use`?  
- [ ] No hardcoded colors/pixels? Mobile‑first?  
- [ ] Memoization only when triggers match?  
- [ ] Accessibility: alt text, labels, focus-visible?  
- [ ] Forms use appropriate library?  
- [ ] Error boundary on route?

---

# 🏗️ Pillar 4: Backend & API Implementation Standards

### 4.1 RESTful Verbs & Status Codes
- `GET` (idempotent), `POST` (non‑idempotent), `PUT` (idempotent), `PATCH` (non‑idempotent), `DELETE` (idempotent) 
- Status codes: 200, 201, 204, 400, 401, 403, 404, 422, 429, 500  
- **Idempotency for POST:** Implement `x-idempotency-key` header with Redis storage (24h TTL).  
- **Rate limiting:**  
  - Authentication endpoints (login, signup, password reset): **5 requests per 15 minutes per IP** (per GUARDRAILS.md 2.6).  
  - Public endpoints: 100 requests per 15 minutes per IP.  
  - Admin bypass allowed for internal monitoring.
### 4.1.1 CSRF Protection (Mandatory)

**Rule:** All `POST`, `PUT`, `PATCH`, `DELETE` endpoints must implement CSRF protection as defined in `GUARDRAILS.md` Module 2.5.

**Implementation Summary:**
- Generate a cryptographically random CSRF token per session.
- Require `X-CSRF-Token` header for all mutating requests.
- Frontend must include this token (e.g., from a meta tag) in every fetch call.

**AI Action:** When generating state‑changing endpoints, always include CSRF token verification middleware.

### 4.2 Universal Response Envelope
**Base Format (Mandatory per GUARDRAILS.md 2.6):**
```json
{
  "success": false,
  "message": "Human‑readable message",
  "code": "MACHINE_READABLE_CODE"
}
```
### 4.3 Async Execution & Concurrency
- Use `async/await` (no `.then()`)  
- Independent calls → `Promise.all()` (only if no race conditions – verify they don’t modify same entity)  
- Partial failures → `Promise.allSettled()`  
- Always wrap in try‑catch and pass to global error handler

**Promise.all Safety Check:** Operations must not modify same DB row, depend on each other, or compete for same connection.

### 4.4 Database Efficiency
- **No `SELECT *`** – explicit columns  
- **Prevent N+1** – use `include`/JOIN  
**N+1 Detection Trigger (AI MUST enforce):**

**Security Implication:** N+1 queries are not just a performance issue; they constitute a **Resource Exhaustion / DoS** vulnerability. The AI MUST treat any unoptimised loop‑driven database call as a finding under `GUARDRAILS.md` Module 4.5.

**Primary Scan:**
- **Trigger:** AI writes a `for` loop, `.forEach`, `.map`, or `while` loop that contains an `await` call to a database (repository method, raw query, ORM call).
- **Action:** Pause generation. Output:
  *"⚠️ Potential N+1 Query Detected. Refactoring to use a JOIN or `IN` clause. If this loop is intentional (e.g., batch size < 5, or operations are not relational), add comment `// @n1-exception: [reason]` to bypass."*

**Secondary Scan (Extended):**
- **Trigger:** After generating a function that queries multiple related entities, perform a secondary scan:
  1. Identify all `await` calls to database methods.
  2. Trace backward to find any containing loop (`for`, `while`, `.forEach`, `.map`).
  3. If a loop exists but is NOT the immediate parent of the `await` (e.g., loop processes results of a previous query), flag:
     *"⚠️ Potential N+1: Loop processing query results contains database calls. Consider using `include` or a separate JOIN query."*

**Bypass:** `// @n1-exception: [reason]` comment immediately above the loop.

**Example of secondary detection:**
```typescript
const users = await db.user.findMany(); // ✅ No loop
for (const user of users) {
  user.posts = await db.post.findMany({ where: { authorId: user.id } }); // ❌ N+1 inside loop - flagged
}
text

---
- **Pagination:** For >10,000 rows, use keyset (cursor) pagination, not `OFFSET`.  
  Response format: `{ items: [], pagination: { nextCursor, hasMore, pageSize } }`
```
### 4.4 Database Efficiency (Extended)

**"Await Map" Detection Rule (Preventing Unawaited Promises):**
- **Trigger:** AI writes `array.map(async (item) => { await operation(item); })` without wrapping in `Promise.all` or similar.
- **Mandatory Action:** Pause generation and output:
  *"⚠️ Unawaited Promises Detected: `.map(async ...)` returns an array of Promises but does not await them. Wrap with `await Promise.all(array.map(...))` or use a `for...of` loop if sequential execution is required."*
- **Exception:** If the user explicitly requires fire‑and‑forget behavior, add comment `// @fire-and-forget: Intentional non‑blocking execution`.

**Cursor Pagination Implementation (Deterministic Default):**
- **Default Encoding:** Base64 encode a JSON object containing the unique sort key(s).
  ```typescript
  const nextCursor = Buffer.from(JSON.stringify({ id: lastItem.id })).toString('base64');
  ```
- **Decoding:**
  ```typescript
  const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
  const whereClause = { id: { gt: decoded.id } };
  ```
- **If using Prisma:** Use the native `cursor` property: `cursor: { id: lastItem.id }`.

### 4.5 Caching (Cache‑Aside)
- TTL: user profile 5m, product catalog 1h, config 10m, real‑time 30s  
- **Cache stampede prevention (Redis concrete implementation):**  
  Use `SET NX EX` lock, wait for lock holder with exponential backoff.  
- **Invalidation:** On `PUT`/`PATCH`/`DELETE`, delete corresponding cache key immediately.  
- **Heavy read trigger:** joins >3 tables, full table scan, or >100 calls/min → must add caching.

### 4.6 API Versioning (Mandatory for Commercial)
- Path prefix: `/api/v1/`  
- Breaking changes → `/api/v2/`, keep both versions for 6 months  
- Deprecation headers: `Deprecation: true`, `Sunset: <date>`, `Link: </api/v2/...>; rel="successor-version"`

### 4.7 Structured Logging & Observability
- JSON format with fields: `timestamp`, `level`, `message`, `correlationId`, `module`, `durationMs` (if applicable)  
- Redact passwords, tokens, API keys, PII → `[REDACTED]`  
- Levels: error, warn, info, debug (debug only in dev)

### 4.8 Feature Flag Standard (Add)
New features taking >1 day must be behind a flag.  
Cleanup within 30 days of 100% rollout. Add `// TODO: Remove flag [NAME] after [DATE]`.

### 4.9 Background Job & Webhook Pattern (Add)
Operations >500ms or external dependencies → async job.  
Job handlers must be idempotent (store idempotency key in Redis).
### 4.11 Bulk Operation Standards

| Operation Size | Required Pattern |
| :--- | :--- |
| ≤100 records | Synchronous endpoint with transaction |
| 101–1,000 records | Async job with webhook/callback or polling endpoint |
| >1,000 records | CSV upload + background processing + email notification |

### 🛠 AI Implementation Checklist (Pillar 4)
- [ ] Verb and status code correct? Idempotency key for POST?  
- [ ] Response envelope used?  
- [ ] Independent calls parallelized safely?  
- [ ] No `SELECT *`, N+1 prevented, indexes added, pagination cursor?  
- [ ] Heavy reads cached with stampede prevention? Invalidation on writes?  
- [ ] API versioned `/api/v1/`? Deprecation headers?  
- [ ] Structured logging with correlationId? No sensitive data?  
- [ ] Feature flags for large features?  
- [ ] Async jobs idempotent?

---
### 4.11 Bulk Operation Standards

| Operation Size | Required Pattern |
| :--- | :--- |
| ≤100 records | Synchronous endpoint with transaction |
| 101–1,000 records | Async job with webhook/callback or polling endpoint |
| >1,000 records | CSV upload + background processing + email notification |

**Bulk response format for async operations:**
```json
{
  "success": true,
  "jobId": "bulk_abc123",
  "status": "processing",
  "statusUrl": "/api/v1/jobs/bulk_abc123"
}
```

# 🏗️ Pillar 5: Documentation & Code Comments

### 5.1 Why, Not What
**Definition of "Public‑facing" (Narrowed):**
A function requires full JSDoc (`@param`, `@returns`, `@throws`) ONLY if it is:
1. Exported from a **package boundary** (e.g., exported from `index.ts` in a shared library)
2. An **API route handler** (controller method)
3. A **service class method** that is called from outside its own module
4. A **shared utility** in `/lib` or `/utils` that is imported by >2 other modules

**For internal helpers** (used only within a single file or adjacent module), use a simple comment:
```javascript
/**
 * Brief description.
 * @param {Type} paramName - Description
 * @returns {Type} Description
 * @throws {ErrorType} When and why
 * @example
 * const result = myFunction('input');
 */
```

### 5.3 Directory README Standard
Every major directory must have `README.md` with: Purpose, Quick Start example, Key Files, Dependencies, Public API, Testing command.

### 5.4 Architecture Decision Records (ADR)
**Triggers:** new DB/cache/message queue, framework version change, pattern introduction (microservices, BFF), affects >3 modules, revert cost >2 dev‑days.  
**Format:** store in `/docs/architecture/adr-XXX-title.md` with Status, Context, Decision, Consequences, Alternatives.
- **Skip ADR for (Refactors):** 
    - Renaming variables/functions/files (with automated refactor tooling).
    - Applying lint/format fixes.
    - Changes that are **100% backward compatible** (e.g., adding a new optional field to a response, adding a new function without modifying existing ones).
    - **Exception:** If a rename changes a public API contract (e.g., a REST endpoint path), an ADR **is** required.
**AI Action:** 
- Before generating changes that affect >3 modules, output:
  > "⚠️ **ADR Consideration:** This change affects [list modules]. I will proceed with implementation, but recommend creating an ADR documenting this cross‑module pattern. Continue? [y/N]"
- The human must explicitly approve or request an ADR draft before the AI proceeds with implementation.
- For all other ADR triggers, propose an ADR draft using the template above before writing implementation code.

### 5.5 Self‑Documenting Code Priority
Before adding a comment, refactor: rename variables, extract functions, introduce named constants. Only comment when refactoring impossible.

### 5.6 API Documentation Generation

**Requirement:** All `/api` routes MUST have OpenAPI/Swagger annotations or a separate OpenAPI specification.

**AI Action:** When generating a new API endpoint, include an OpenAPI comment block above the handler.

### 5.7 CHANGELOG Maintenance

**Format:** Keep a `CHANGELOG.md` file following [Keep a Changelog](https://keepachangelog.com/) principles.

**AI Action:** When generating a new feature or significant change, suggest a CHANGELOG entry:

### 🛠 AI Implementation Checklist (Pillar 5)
- [ ] Comments explain why, not what?  
- [ ] TODO includes username, issue, date?  
- [ ] Public functions have JSDoc with @param, @returns, @throws?  
- [ ] New directories have README?  
- [ ] Architectural triggers → ADR proposed?

---

# 🏗️ Pillar 6: Version Control & Git Workflow

### 6.1 Conventional Commits
Format: `<type>(<scope>): <description>`  
Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `revert`  
Description: imperative, no period, ≤72 chars.  
**Body required when** change affects >3 files or non‑trivial algorithm.

### 6.2 Atomic Commits
One logical change = one commit. Bundle commits forbidden.  
**Frequency:** commit after each logical unit (function, component) – at least every 30 minutes of generated code.  
**Commit signing** (human responsibility) – AI will remind but cannot enforce.

### 6.3 Professional Branching Strategy
**Branch hierarchy:** `main` (production), `develop` (integration), `feature/*`, `fix/*`, `hotfix/*`, `release/*`, `docs/*`, `refactor/*`  
**Allowed prefixes:** `feature/`, `fix/`, `hotfix/`, `release/`, `docs/`, `refactor/`, `chore/`, `test/`, `style/` 
**Naming:** `<prefix>/<ticket-id>-<description>` or `<prefix>/YYYY-MM-DD-description` if no ticket.  
**Long‑lived:** `main` and `develop` only; others deleted after merge.

### 6.4 Pull Request Description Standard
**Template includes:** Summary, Why, Changes Made, Testing Performed (automated: unit/integration/e2e with coverage change; manual: browsers, mobile, keyboard, screen reader), Risk Level, Screenshots, Checklist.

### 6.5 Merge Strategy & Conflict Resolution

#### 6.5.1 Human/CI Responsibilities (Not Enforceable by AI)
The following actions are **human‑initiated** or **CI‑automated**. The AI MUST NOT attempt to execute these commands. It should only provide the **content** for them.

| Branch Flow | Merge Strategy | AI Role |
| :--- | :--- | :--- |
| Feature → `develop` | **Squash and merge** | Generate a **single, well‑formatted Conventional Commit message** summarizing all atomic commits in the PR. |
| `release` → `main` | **Merge commit** | Generate a **PR description** detailing the release contents. |
| Feature branch update | **Rebase** onto `develop` | If asked to help with rebase conflicts, apply the algorithm in 6.5.2. |

#### 6.5.2 AI Conflict Resolution Algorithm (Assisting Human)
**Trigger:** User asks AI to resolve Git merge/rebase conflicts.

**Algorithm (Deterministic):**
1. **Same line, different content:** **ASK HUMAN.** Output `@ai-blocked: CONFLICT` with both versions shown.
2. **Different functions/blocks (non‑overlapping):** Accept **both** changes (union).
3. **Same function, different lines (non‑overlapping):** Accept **both** changes (union).
4. **One deletion, one modification:** Prefer **modification** unless the deletion is marked with a specific reason comment (e.g., `// DEPRECATED: Removing legacy flow`).

**AI Output after resolution:** *"Conflict resolved: kept [X] from branch A and [Y] from branch B. Human review of the merged file is recommended."*

**Important:** The AI does not commit the resolved file. It presents the resolved content for the human to verify and commit.

### 6.6 Git Hygiene
Never commit: secrets, large binaries, `node_modules`, amend public commits, force push shared branches.

### 🛠 AI Implementation Checklist (Pillar 6)
- [ ] Commit message conventional, body when needed?  
- [ ] Atomic commit?  
- [ ] Branch from `develop` with allowed prefix? Ticket reference?  
- [ ] PR description full template?  
- [ ] Merge strategy appropriate?  
- [ ] Conflicts resolved with algorithm?  
- [ ] No secrets/binaries?

---

# 🏗️ Pillar 7: Testing Standards

### 7.1 Test Hierarchy & Coverage Thresholds
| Test Type | Scope | Commercial | Internal | Prototype |
| :--- | :--- | :--- | :--- | :--- |
| Unit (Services) | Business logic | 80% | 50% | Optional |
| Unit (Repositories) | Data access | 70% | 50% | Optional |
| Unit (UI Components) | Rendering & interaction | 50% | Optional | Optional |
| Unit (Utilities) | Pure functions | 90% | 70% | Optional |
| Integration | Critical paths | Mandatory | Optional | Optional |
| E2E | Top user journeys | Top 5 journeys | Top 2 journeys | Optional |

**AI Action:** Based on the active risk tier (from `GUARDRAILS.md`), enforce the corresponding coverage thresholds when generating test suites.

### 7.2 Unit Test Structure – AAA Pattern
```javascript
describe('UserService', () => {
  it('should return user when found', async () => {
    // Arrange
    const mockRepo = { findById: jest.fn().mockResolvedValue({ id: 1 }) };
    const service = new UserService(mockRepo);
    // Act
    const result = await service.getUserById(1);
    // Assert
    expect(result).toEqual({ id: 1 });
  });
});
```
- **Time Handling (Deterministic Tests):**  
  **Trigger:** Test logic relies on `new Date()`, `Date.now()`, or timestamps.  
  **Action:**  
  - **Vitest:** Use `vi.useFakeTimers()` and `vi.setSystemTime(new Date('2024-01-01'))`.  
  - **Jest:** Use `jest.useFakeTimers()` and `jest.setSystemTime(...)`.  
  **Do NOT** use real system time for assertions; this causes flaky CI failures at time boundaries.
**Test naming:** `should [expected] when [condition]`  
**Test data factories:** Create `tests/factories/` with factory functions (e.g., `createTestUser(overrides)`). Do not hardcode inline.

### 7.3 Mocking & Integration Test Database
- Unit tests: mock all dependencies  
- Integration tests: use Testcontainers for true DB (default for Commercial); SQLite in‑memory only if ORM abstracts dialect.

### 7.4 Frontend & E2E Testing
- Component tests: behavior over implementation – use `getByRole`, `getByLabelText`  
- **Selector priority:** `getByRole` → `getByLabelText` → `getByText` → `getByTestId` (last resort only, with comment why)  
- Snapshot testing: avoid for dynamic content; use sparingly for static config.

### 7.5 Test File Organization
Place `*.test.ts` or `*.spec.tsx` next to source file. Shared utilities in `/tests/utils/`.

### 7.6 CI Requirements
- All tests must pass before merge  
- No `it.skip` on main/develop  
Flaky tests: fix within 24 hours or quarantine using the `@flaky-quarantine` format defined in `PIPELINE_OPS.md` Module 1.8.

**AI Action:** When generating code with business logic (conditionals, loops, data transformation, API calls, state), also generate corresponding test file. For constants/types/pure markup, state: *“No tests required (no business logic).”*
### 7.7 Test Data Isolation

**Rule:** Tests MUST NOT share mutable state or database records. Every test must create its own data and clean up after itself.

**Implementation:**
- Use unique identifiers: `test-${Date.now()}-${randomUUID().slice(0,8)}`
- Wrap each test in a database transaction and rollback (preferred for relational DBs)
- Use a separate test database—never production or staging data

**For parallel test execution:**
- Each test worker gets a unique database name/schema (e.g., `test_db_worker_1`)
- Clean up after test suite completes, not after each test (for performance)

**AI Action:** When generating test files, include a `beforeEach` that creates fresh test data and an `afterEach` that cleans up (or rely on transaction rollback). Never generate tests that depend on pre‑existing database state.

### 7.8 Mocking External APIs

**Pattern:** Use Mock Service Worker (MSW) for frontend/browser tests. Use Nock for Node.js backend tests.

**Requirement:** Mocked responses MUST simulate both success and error states of the real API (timeout, 429, 500, malformed JSON, network failure).

**AI Action:** When generating code that calls external APIs, also generate corresponding MSW handlers in `/mocks/handlers.ts`:

```typescript
// /mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/external/users', () => {
    return HttpResponse.json([{ id: 1, name: 'Test User' }]);
  }),
  
  http.get('/api/external/users/:id', ({ params }) => {
    if (params.id === 'error') {
      return new HttpResponse(null, { status: 500 });
    }
    return HttpResponse.json({ id: params.id, name: 'Test User' });
  })
];
```
### 🛠 AI Implementation Checklist (Pillar 7)
- [ ] Test file created with `.test.ts` suffix?  
- [ ] AAA pattern? Descriptive test name?  
- [ ] Factories used instead of inline data?  
- [ ] Integration tests use Testcontainers?  
- [ ] E2E selectors follow priority (getByRole first)?  
- [ ] Coverage thresholds met?  
- [ ] No flaky tests or skipped tests on main?

---
