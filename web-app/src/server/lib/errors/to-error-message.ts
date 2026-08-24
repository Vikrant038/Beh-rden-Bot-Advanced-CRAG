/**
 * Normalizes an unknown error value into a string message.
 * Used for consistent error logging and telemetry across the codebase.
 */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
