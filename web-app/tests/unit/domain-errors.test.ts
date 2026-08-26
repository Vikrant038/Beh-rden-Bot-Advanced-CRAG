import { describe, it, expect } from "vitest";
import {
  DomainError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  UnauthorizedError,
  RateLimitedError,
  ExternalApiError,
  DomainGuardBlockedError,
  SsrfBlockedError,
} from "@/server/lib/errors";
import { ErrorCode } from "@/server/lib/errors";
import { LLMProviderError } from "@/server/llm/errors";
import { toErrorMessage } from "@/server/lib/errors/to-error-message";

describe("DomainError hierarchy", () => {
  it("DomainError sets name from subclass", () => {
    const err = new DomainError("base", ErrorCode.LLM_ERROR, { detail: 1 });
    expect(err.name).toBe("DomainError");
    expect(err.code).toBe(ErrorCode.LLM_ERROR);
    expect(err.details).toEqual({ detail: 1 });
  });

  it("NotFoundError carries resource and id", () => {
    const err = new NotFoundError("Document", "42");
    expect(err.message).toBe("Document 42 not found");
    expect(err.code).toBe(ErrorCode.NOT_FOUND);
    expect(err.name).toBe("NotFoundError");
  });

  it("ValidationError", () => {
    const err = new ValidationError("query", "too short");
    expect(err.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(err.message).toContain("too short");
  });

  it("ForbiddenError", () => {
    const err = new ForbiddenError("view docs");
    expect(err.code).toBe(ErrorCode.FORBIDDEN);
  });

  it("UnauthorizedError", () => {
    const err = new UnauthorizedError();
    expect(err.code).toBe(ErrorCode.UNAUTHORIZED);
  });

  it("RateLimitedError", () => {
    const err = new RateLimitedError();
    expect(err.code).toBe(ErrorCode.RATE_LIMITED);
    const custom = new RateLimitedError("Slow down");
    expect(custom.message).toBe("Slow down");
  });

  it("ExternalApiError carries details", () => {
    const err = new ExternalApiError("hf down", { status: 503 });
    expect(err.code).toBe(ErrorCode.EXTERNAL_API_ERROR);
    expect(err.details).toEqual({ status: 503 });
  });

  it("DomainGuardBlockedError", () => {
    const err = new DomainGuardBlockedError("out of domain");
    expect(err.code).toBe(ErrorCode.DOMAIN_GUARD_BLOCKED);
  });

  it("SsrfBlockedError", () => {
    const err = new SsrfBlockedError("https://evil.example");
    expect(err.code).toBe(ErrorCode.SSRF_BLOCKED);
    expect(err.message).toContain("https://evil.example");
  });

  it("LLMProviderError is a DomainError", () => {
    const err = new LLMProviderError("boom");
    expect(err).toBeInstanceOf(DomainError);
    expect(err.code).toBe(ErrorCode.LLM_ERROR);
    expect(err.name).toBe("LLMProviderError");
  });
});

describe("toErrorMessage", () => {
  it("extracts message from Error instance", () => {
    expect(toErrorMessage(new Error("custom error"))).toBe("custom error");
  });

  it("converts non-Error values to string", () => {
    expect(toErrorMessage("string error")).toBe("string error");
    expect(toErrorMessage(404)).toBe("404");
  });
});
