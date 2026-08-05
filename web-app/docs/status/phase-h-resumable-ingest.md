# Resumable Ingest Queue & Coverage Status

## 1. Corpus Measurement & Sizing
Per the latest directive, we suspended the full code refactor and prioritized measuring the actual corpus to size the batches and time budgets properly.

An instrumentation script (`scripts/measure-ingest.ts`) was created and executed locally on `../data/pdfs/laws/englisch_aufenthg.pdf` (1.43 MB). 

**Baseline Timings (Local execution):**
- **parsePdf**: ~283.40 ms (625,126 characters extracted)
- **cleanText**: ~9.60 ms
- **chunkParentChild**: ~3.44 ms
- **Resulting Structure**: 387 parent chunks, **3,984 child chunks**

**Budget Analysis:**
With 3,984 child chunks, a single document generates almost 4,000 embedding API calls (or batch calls depending on the provider). Assuming a typical 50ms-100ms per batch for embeddings and ~50ms per database transaction, a full file this size would far exceed the 10-second serverless execution window (potentially reaching 20-30 seconds). 

The refactor has been temporarily **stashed** (`git stash`) so we can finalize the optimal `resumeFrom` batch size (e.g., 50 parent blocks per worker tick) before committing the architectural changes.

## 2. Coverage Improvements
We iteratively improved unit testing coverage step-by-step across the lowest-covered modules to bring the overall coverage higher:

1. **`components/admin/metric-card.tsx`**: 
   - Wrote DOM-based tests (`src/components/admin/metric-card.test.tsx`) utilizing `testing-library` and `jsdom`.
   - Verified the animated count increment logic (via `vi.advanceTimersByTime`).
   - Verified the SVG Sparkline render logic and trend arrows.
## 3. Next Steps
1. Determine the exact `timeBudgetMs` limit based on Vercel constraints and the 4,000-chunk file test.
2. Unstash and refine the batch-store queue implementation.
3. Continue the step-by-step unit test coverage expansion into the routers (`server/routers/*`).

## 4. Branch Coverage Report
A full coverage check was run (`vitest run --coverage`):
- **Statements**: 85.70%
- **Branches**: 75.83%
- **Functions**: 82.29%
- **Lines**: 85.60%

**Result**: The overall branch coverage increased iteratively from ~70.92% to **75.83%** (Statements now > 85%).

### Files Targeted for Coverage
1. `src/components/admin/metric-card.tsx` (Inline SVG and animation timers)
2. `src/server/embeddings/client.ts` (API fetch mocks and error handling)
3. `src/lib/utils.ts` (Timestamps and numerical parsing logic)
4. `src/components/admin/recent-queries-table.tsx` (Component states, async drawers, and load more)
