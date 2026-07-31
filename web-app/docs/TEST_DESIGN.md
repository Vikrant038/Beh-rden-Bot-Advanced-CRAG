# Phase 5 — Test Design Document (TDD Skeleton)

> **Gate:** Requires `@ai-unblock-tdd` then `@ai-start-implementation` to begin TASK-001.
> Test-first: failing skeletons are created, then implemented per task. Coverage targets (CODING_STANDARDS P7): utilities 90%, services 80%, repositories 70%, UI components 50%, critical-path integration + top-journey E2E mandatory.

---

## 1. Unit Skeletons (`web-app/tests/unit/`)

```typescript
// pii-masker.test.ts
describe('PIIMasker', () => {
  test.todo('should mask email addresses');
  test.todo('should mask phone numbers (national + international)');
  test.todo('should mask IBAN');
  test.todo('should mask passport numbers');
  test.todo('should mask dates of birth');
  test.todo('should mask names (spaCy-equivalent heuristic)');
  test.todo('should preserve non-PII text verbatim');
  test.todo('should handle empty and null input');
});
```

```typescript
// circuit-breaker.test.ts
describe('CircuitBreaker', () => {
  test.todo('should start CLOSED');
  test.todo('should OPEN after failureThreshold failures');
  test.todo('should reject calls while OPEN');
  test.todo('should transition to HALF_OPEN after resetTimeout');
  test.todo('should close on successful probe, reopen on failed probe');
  test.todo('should reset counters after success');
});
```

```typescript
// visa-calculator.test.ts
describe('VisaCalculator', () => {
  test.todo('should compute 992 EUR/month x 12 months');
  test.todo('should convert EUR to INR at 90 INR/EUR');
  test.todo('should reject invalid months or negative amounts');
  test.todo('should handle currency rounding');
});
```

```typescript
// query-expansion.test.ts
describe('QueryExpander', () => {
  test.todo('should generate 3 sub-queries from a single query');
  test.todo('should keep sub-queries within token budget');
  test.todo('should return the original query when expansion fails');
});
```

```typescript
// rrf-fusion.test.ts
describe('RRFFusion', () => {
  test.todo('should fuse dense + sparse rankings with k=60');
  test.todo('should rank items present in both lists higher');
  test.todo('should handle empty ranking lists');
  test.todo('should be deterministic for identical inputs');
});
```

```typescript
// bm25.test.ts
describe('BM25Okapi', () => {
  test.todo('should score keyword overlap correctly');
  test.todo('should handle IDF for rare vs common terms');
  test.todo('should not crash on empty corpus or empty query');
  test.todo('should handle German compound-word tokens');
});
```

```typescript
// semantic-cache.test.ts
describe('SemanticCache', () => {
  test.todo('should return null on miss');
  test.todo('should store and return an entry on hit');
  test.todo('should match cosine similarity >= 0.97');
  test.todo('should return null for expired entries (TTL 7d enforced)');
  test.todo('should invalidate entries by parentDocIds');
});
```

```typescript
// summary-buffer-memory.test.ts
describe('SummaryBufferMemory', () => {
  test.todo('should keep last 8 verbatim turns');
  test.todo('should compress older turns into a rolling summary');
  test.todo('should cap summary at ~300 tokens');
  test.todo('should handle empty conversation');
});
```

## 2. Integration Skeletons (`web-app/tests/integration/`)

```typescript
// retrieval.test.ts
describe('HybridRetriever (pgvector + BM25 + RRF)', () => {
  test.todo('should return top-k chunks for an in-domain query');
  test.todo('should rank dense-relevant results in top 15');
  test.todo('should apply min_similarity 0.20 dense threshold');
  test.todo('should re-rank via cross-encoder to top 5');
});
```

```typescript
// crag-gate.test.ts
describe('CRAGGate', () => {
  test.todo('should PASS when score >= 0.50');
  test.todo('should FAIL and trigger web search when < 0.50');
  test.todo('should synthesize answer from web results on fallback');
});
```

```typescript
// guardrail.test.ts
describe('DomainGuardrail (Stage 0A)', () => {
  test.todo('should allow in-domain questions (visa, APS, blocked account)');
  test.todo('should block off-topic questions');
  test.todo('should block illegal-advice questions');
  test.todo('should cache out-of-domain verdicts in negative cache');
});
```

```typescript
// disambiguation.test.ts
describe('QueryDisambiguator (Stage 0B)', () => {
  test.todo('should detect vague <=3-word queries');
  test.todo('should generate exactly 3 clarifying options');
  test.todo('should pass through clear queries unchanged');
});
```

```typescript
// rag-pipeline.test.ts
describe('RAG Pipeline Orchestrators', () => {
  test.todo('standard CRAG: retrieve -> gate -> generate -> save (PII-masked)');
  test.todo('agentic: research -> analyst matrix -> writer markdown');
  test.todo('should persist user + assistant messages with sources metadata');
  test.todo('should return cached response when cache hit');
});
```

```typescript
// document-sync.test.ts
describe('DocumentSync (transactional)', () => {
  test.todo('should re-chunk + re-embed + swap chunks atomically');
  test.todo('should invalidate affected semantic cache entries');
  test.todo('should rollback on partial failure');
});
```

## 3. E2E Skeletons (`web-app/tests/e2e/`)

```typescript
// chat-flow.spec.ts
test.todo('user sends question, sees streaming response, then sources');
test.todo('vague query shows 3 disambiguation options; clicking one answers');
test.todo('session persists across page reload');
```

```typescript
// auth.spec.ts
test.todo('unauthenticated /chat redirects to /login');
test.todo('login via provider grants access; logout redirects');
test.todo('401 mid-session redirects without losing draft');
```

```typescript
// admin.spec.ts
test.todo('USER cannot access /admin/dashboard (403/redirect)');
test.todo('ADMIN can view metrics and trigger document sync');
```

---

## 4. Edge-Case Injection (GUARDRAILS M3)

- **Empty/Giant/Malicious/Unicode states** — add `test.todo` cases in each validator suite (max-length, allow-list, UTF-8, 1GB upload reject).
- **Concurrency** — idempotency-key test for `sendMessage` + `sync`; double-click submit guard test.
- **Network** — timeout + 429 + 500 + malformed-JSON + offline cases via MSW/Nock per CODING_STANDARDS P7.8.
- **Session expiry race** — 401 mid-stream test.

---

*Awaiting `@ai-unblock-roadmap` (for this phase transition) and `@ai-unblock-tdd` (for test skeletons) before `@ai-start-implementation`.*
