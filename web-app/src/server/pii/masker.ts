import { createLogger } from "@/server/lib/logger";

const logger = createLogger("pii");

/**
 * PII regex patterns, ported from the original Python `src/pii_masker.py`.
 * Order matters: IBAN-spaced must run after IBAN-unspaced; generic national ID
 * patterns run last to avoid double-masking email/passport matches.
 */
const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}\b/g,
    replacement: "[IBAN_REDACTED]",
  },
  {
    pattern: /\b[A-Z]{2}[0-9]{2}(?:\s[A-Z0-9]{4})+(?:\s[A-Z0-9]{2})?\b/g,
    replacement: "[IBAN_REDACTED]",
  },
  {
    pattern: /\b[A-PR-WY][1-9]\d\s?\d{4}[1-9]\b/g,
    replacement: "[PASSPORT_REDACTED]",
  },
  {
    pattern: /\b[A-Z0-9]{2}[0-9]{7}\b/g,
    replacement: "[PASSPORT_REDACTED]",
  },
  {
    pattern:
      /\b(?:0?[1-9]|[12]\d|3[01])[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:19[2-9]\d|200\d|201\d)\b|\b(?:19[2-9]\d|200\d|201\d)[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:0?[1-9]|[12]\d|3[01])\b/g,
    replacement: "[DOB_REDACTED]",
  },
  {
    pattern: /(?<![A-Z0-9])(?:\+|00)[1-9]\d{0,2}[\s\-.\(]?\d{2,4}[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}\b/g,
    replacement: "[PHONE_REDACTED]",
  },
  {
    pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    replacement: "[EMAIL_REDACTED]",
  },
];

/**
 * Cap on the input size so pathological inputs cannot cause a near-infinite
 * regex loop or unbounded memory use on the server (GUARDRAILS M3 input caps).
 */
const MAX_INPUT_CHARS = 50_000;

export interface MaskResult {
  text: string;
  wasPiiDetected: boolean;
}

export function maskPii(input: string): MaskResult {
  if (!input || typeof input !== "string") {
    return { text: input, wasPiiDetected: false };
  }

  let masked = input.slice(0, MAX_INPUT_CHARS);
  let found = false;

  for (const { pattern, replacement } of PII_PATTERNS) {
    const next = masked.replace(pattern, replacement);
    if (next !== masked) {
      found = true;
      masked = next;
    }
  }

  if (found) {
    logger.info(
      {
        originalChars: input.length,
        maskedChars: masked.length,
      },
      "[PII] Masked",
    );
  }

  return { text: masked, wasPiiDetected: found };
}
