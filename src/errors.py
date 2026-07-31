"""
Domain Exception Hierarchy & Error Code Registry
Complies with CODING_STANDARDS.md Pillar 4.2 and GUARDRAILS.md Module 2.6.
"""

from enum import Enum
from typing import Dict, Optional, Union

# Metadata field value type alias
MetadataValue = Union[str, int, float, bool, list, dict]


class ErrorCode(str, Enum):
    """Standardized error codes for universal response envelopes."""

    NOT_FOUND = "NOT_FOUND"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    FORBIDDEN = "FORBIDDEN"
    UNAUTHORIZED = "UNAUTHORIZED"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    LLM_PROVIDER_ERROR = "LLM_PROVIDER_ERROR"
    RATE_LIMITED = "RATE_LIMITED"


class DomainError(Exception):
    """Base domain exception with standardized error code and response payload."""

    def __init__(
        self,
        message: str,
        code: ErrorCode = ErrorCode.INTERNAL_ERROR,
        status_code: int = 500,
        metadata: Optional[Dict[str, MetadataValue]] = None,
    ):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.metadata = metadata or {}

    def to_dict(self) -> Dict[str, Union[bool, str, int, Dict[str, MetadataValue]]]:
        """Convert exception to Universal Response Envelope payload."""
        return {
            "success": False,
            "message": self.message,
            "code": self.code.value,
            "metadata": self.metadata,
        }


class NotFoundError(DomainError):
    """Raised when a requested resource or document chunk is missing."""

    def __init__(self, message: str = "Requested resource not found", metadata: Optional[Dict[str, MetadataValue]] = None):
        super().__init__(
            message=message,
            code=ErrorCode.NOT_FOUND,
            status_code=404,
            metadata=metadata,
        )


class ValidationError(DomainError):
    """Raised when input validation fails (e.g. malformed query or invalid payload)."""

    def __init__(self, message: str = "Input validation failed", metadata: Optional[Dict[str, MetadataValue]] = None):
        super().__init__(
            message=message,
            code=ErrorCode.VALIDATION_FAILED,
            status_code=400,
            metadata=metadata,
        )


class ForbiddenError(DomainError):
    """Raised when access to a resource or operation is forbidden."""

    def __init__(self, message: str = "Access to resource is forbidden", metadata: Optional[Dict[str, MetadataValue]] = None):
        super().__init__(
            message=message,
            code=ErrorCode.FORBIDDEN,
            status_code=403,
            metadata=metadata,
        )


class UnauthorizedError(DomainError):
    """Raised when authentication credentials are missing or invalid."""

    def __init__(self, message: str = "Authentication required", metadata: Optional[Dict[str, MetadataValue]] = None):
        super().__init__(
            message=message,
            code=ErrorCode.UNAUTHORIZED,
            status_code=401,
            metadata=metadata,
        )


class LLMProviderError(DomainError):
    """Raised when primary or fallback LLM providers fail or exhaust retries."""

    def __init__(self, message: str = "LLM Provider service error", metadata: Optional[Dict[str, MetadataValue]] = None):
        super().__init__(
            message=message,
            code=ErrorCode.LLM_PROVIDER_ERROR,
            status_code=502,
            metadata=metadata,
        )


class RateLimitError(DomainError):
    """Raised when request rate limits or TPM quotas are exceeded."""

    def __init__(self, message: str = "Rate limit exceeded. Please try again later.", metadata: Optional[Dict[str, MetadataValue]] = None):
        super().__init__(
            message=message,
            code=ErrorCode.RATE_LIMITED,
            status_code=429,
            metadata=metadata,
        )
