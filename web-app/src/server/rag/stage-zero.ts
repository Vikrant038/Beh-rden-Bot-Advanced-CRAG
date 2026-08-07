import { maskPii } from "@/server/pii/masker";
import { disambiguateQuery } from "@/server/rag/disambiguation";

export interface StageZeroResult {
  /** The PII-masked query — passed into downstream stages so masking never repeats. */
  maskedQuery: string;
  disambiguation: { durationMs: number; isAmbiguous: boolean; options: string[] };
}

/**
 * Stage 0 — PII mask + query disambiguation, run exactly once per query.
 *
 * Previously the chat stream and admin pipeline tester each inlined this pair,
 * and both then passed the *unmasked* prompt into the RAG pipeline, which
 * masked it a second time. Centralizing here makes the mask-once contract
 * explicit: callers feed the returned `maskedQuery` into `runAgenticRag` /
 * `runStandardCrag` (via their `maskedQuery` option) instead of re-masking.
 *
 * The chat stream emits its live `stage_start`/`stage_end` telemetry around
 * this call (the timestamp capture stays in the generator); the admin tester
 * calls it bare.
 */
export async function runStageZero(rawQuery: string): Promise<StageZeroResult> {
  const { text: maskedQuery } = maskPii(rawQuery);

  const t0 = Date.now();
  const disambiguation = await disambiguateQuery(maskedQuery);
  const durationMs = Date.now() - t0;

  return {
    maskedQuery,
    disambiguation: {
      durationMs,
      isAmbiguous: disambiguation.isAmbiguous,
      options: disambiguation.options,
    },
  };
}
