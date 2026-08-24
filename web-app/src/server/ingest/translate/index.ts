/**
 * Public API for the translation module.
 * Re-exports all public types and functions from the split modules.
 */

export { detectLanguage, detectLanguageLlm, type DetectedLanguage } from "./detect";

export {
  GroqRateLimiter,
  GroqRateLimiterPool,
  type TranslationRateLimiter,
  type GroqModelConfig,
  createTranslationRateLimiter,
  resolveModelConfigs,
} from "./rate-limit";

export { cacheLookup, cacheStore, getOrCreateInflight } from "./cache";

export { isHardModelError, isTpdExhaustion } from "./errors";

export { translateToEnglish, splitIntoChunks, type TranslationResult } from "./translate";
