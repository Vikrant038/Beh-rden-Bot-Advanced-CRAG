/**
 * LLM error classification for the translation pipeline.
 * Distinguishes hard model errors (never retry) from transient errors, so the
 * pool can blacklist/exhaust a model and retry the segment on the next one
 * instead of stalling the whole migration.
 */

/**
 * True when an API error means the model will never work on this account
 * (404 model-not-found, 403/401 auth) — as opposed to transient 429/5xx/
 * network errors that a retry on the same model could succeed on.
 */
export function isHardModelError(error: unknown): boolean {
  const err = error as { status?: number; message?: string };
  if (typeof err?.status === "number" && [401, 403, 404].includes(err.status)) {
    return true;
  }
  return /does not exist or you do not have access|model.*not (found|available)|no access to it/i.test(
    String(err?.message ?? error),
  );
}

/**
 * True when a 429 means the model's DAILY token budget is spent (vs a
 * transient rate limit that would clear on the next minute window).
 */
export function isTpdExhaustion(error: unknown): boolean {
  return /tokens per day|TPD|daily token limit/i.test(
    String((error as { message?: string })?.message ?? error),
  );
}
