import { ErrorCode } from "./codes";

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(`${resource} ${id} not found`, ErrorCode.NOT_FOUND);
  }
}

export class ValidationError extends DomainError {
  constructor(field: string, reason: string) {
    super(`Validation failed: ${field} - ${reason}`, ErrorCode.VALIDATION_FAILED);
  }
}

export class ForbiddenError extends DomainError {
  constructor(action: string) {
    super(`Forbidden to ${action}`, ErrorCode.FORBIDDEN);
  }
}

export class UnauthorizedError extends DomainError {
  constructor() {
    super("Authentication required", ErrorCode.UNAUTHORIZED);
  }
}

export class RateLimitedError extends DomainError {
  constructor(message = "Too many requests") {
    super(message, ErrorCode.RATE_LIMITED);
  }
}

export class ExternalApiError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, ErrorCode.EXTERNAL_API_ERROR, details);
  }
}

export class DomainGuardBlockedError extends DomainError {
  constructor(message: string) {
    super(message, ErrorCode.DOMAIN_GUARD_BLOCKED);
  }
}

export class SsrfBlockedError extends DomainError {
  constructor(url: string) {
    super(`Request to disallowed host rejected: ${url}`, ErrorCode.SSRF_BLOCKED);
  }
}

export class InvalidContentTypeError extends DomainError {
  constructor(url: string, contentType: string) {
    super(
      `URL ${url} returned unsupported content type "${contentType}". ` +
        `Only text/html and text/plain documents can be ingested.`,
      ErrorCode.INVALID_CONTENT_TYPE,
    );
  }
}

export class PdfParseError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, ErrorCode.PDF_PARSE_FAILED, details);
  }
}
