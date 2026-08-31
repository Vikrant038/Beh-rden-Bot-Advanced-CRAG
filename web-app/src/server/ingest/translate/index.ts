/**
 * Public API for the translation module.
 * Re-exports the public types and functions from the split modules.
 */

export { detectLanguage, detectLanguageLlm, type DetectedLanguage } from "./detect";

export {
  GroqRateLimiter,
  GroqRateLimiterPool,
  type TranslationRateLimiter,
  createTranslationRateLimiter,
} from "./rate-limit";

export { translateToEnglish, splitIntoChunks, type TranslationResult } from "./translate";
