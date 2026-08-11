# Phase L — English-Only Answers (RAG Generation)

**Status:** implemented
**Scope:** `web-app` only — all RAG generation paths (standard + agentic), end-user chat
**Date:** 2026-08-10

## What it does

All answers from the RAG pipeline are now produced **in English only**, regardless of the
language of the user's query. Previously the system detected the query language (e.g. German,
Hindi) and forced the analyst + writer agents to answer in that language. Now the base prompt
contract, the analyst prompt, and the writer prompt all instruct English-only output.

German technical terms (e.g. `Aufenthaltserlaubnis`, `Sperrkonto`) are still kept accurate but
explained in English.

## Design decisions

- **Canonical-English cache convergence is preserved.** A German ask and its English re-ask
  still converge on one cached answer via the canonical-English dual-write. Only the answer
  *language tag* stored on cache entries is now honestly `"en"`.
- **`languageMismatch` is removed.** Because answers are always English, there is no cross-language
  mismatch to flag. The field was deleted from `StandardRagResult`, `StandardRagTrace`,
  `AgenticRagResponse`, `ChatMetadata`, and `chat-pipeline.ts` — nothing ever set it to a real value
  and nothing read it. Query-language detection still lives on `QueryExpansion.language` (the only
  honest per-query signal), used to gate the canonical-English dual cache write and available for
  future analytics.
- **The result `language` fields are removed.** `StandardRagResult.language`, `StandardRagTrace.language`
  and `AgenticRagResponse.language` were always `"en"` and read by no component; the constants and
  the `serveCached(requestLanguage)` pass-through are deleted. The only language metadata that
  remains is the cache's honest answer-language tag (`SemanticCacheEntry.language`, written as `"en"`).

## Implementation

| File | Change |
|------|--------|
| `src/server/rag/prompt.ts` | Base contract `LANGUAGE` line now reads "Always answer in English, regardless of the language of the user's query." Removed the per-language override (`languageLine`, `LANGUAGE_NAMES`, `languageName`) and dropped the `language` argument from `buildStandardSystemPrompt()` / `buildWriterPrompt()`. |
| `src/server/rag/agents/analyst.ts` | Analyst instruction 4 and Writer instruction 3 now say "Answer in English, regardless of the language"; removed the `answerLanguage` parameter from `agentWriterSynthesis`. |
| `src/server/rag/agents/orchestrator.ts` | Agentic path: `language`/`languageMismatch` removed from `AgenticRagResponse`, the cache-hit serve, and the blocked/out-of-domain branch; dual-write gate keeps `expansion?.language !== "en"`; cache writes record `"en"` as the answer language. |
| `src/server/rag/pipeline.ts` | Standard path: `language`/`languageMismatch` removed from `StandardRagResult`/`StandardRagTrace` and the dead `serveCached(requestLanguage)` pass-through; dual-write gate keeps `expansion.language !== "en"`; cache writes record `"en"`. |
| `tests/unit/rag-prompt.test.ts` | Updated the "answers in the user's language" test to assert the English-only contract; removed the per-language builder tests. |
| `tests/integration/rag-pipeline.test.ts` | Updated all cache-hit / dual-key / writer / standard tests to expect English answers, drop the `language`/`languageMismatch` assertions, and assert the English-only prompt text. |

## Verification

- Full suite: **843/843** tests pass (82 files), 3 skipped.
- `tsc --noEmit`: clean (exit 0).