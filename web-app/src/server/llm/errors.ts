import { DomainError, ErrorCode } from "@/server/lib/errors";

export class LLMProviderError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, ErrorCode.LLM_ERROR, details);
  }
}
