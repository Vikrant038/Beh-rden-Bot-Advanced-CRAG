"""
Structured Pino-Style Logger with Automated Security Redaction
Complies with GUARDRAILS.md 6.4 and CODING_STANDARDS.md Pillar 4.7.
"""

import json
import logging
import re
import sys
from typing import Dict, Union

# Case-insensitive pattern matching sensitive fields requiring redaction
SENSITIVE_KEY_PATTERN = re.compile(
    r"^(password|passwd|pwd|token|jwt|accesstoken|refreshtoken|secret|apikey|clientsecret|creditcard|cvv|cardnumber)$",
    re.IGNORECASE,
)


class SensitiveDataRedactor(logging.Filter):
    """Filter that recursively redacts sensitive fields in log record dictionaries."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, dict):
            record.args = self._redact_dict(record.args)
        elif isinstance(record.msg, dict):
            record.msg = self._redact_dict(record.msg)
        return True

    def _redact_dict(self, data: dict) -> dict:
        redacted = {}
        for key, value in data.items():
            if SENSITIVE_KEY_PATTERN.match(str(key)):
                redacted[key] = "[REDACTED]"
            elif isinstance(value, dict):
                redacted[key] = self._redact_dict(value)
            elif isinstance(value, list):
                redacted[key] = [
                    self._redact_dict(item) if isinstance(item, dict) else item
                    for item in value
                ]
            else:
                redacted[key] = value
        return redacted


class JsonFormatter(logging.Formatter):
    """JSON log formatter adhering to structured logging standards."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry: Dict[str, Union[str, float, int]] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "module": record.module,
            "correlationId": getattr(record, "correlation_id", "N/A"),
            "message": record.getMessage(),
        }

        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)

        if hasattr(record, "duration_ms"):
            log_entry["durationMs"] = getattr(record, "duration_ms")

        return json.dumps(log_entry)


def setup_logger(name: str = "behoerden_bot") -> logging.Logger:
    """Configures and returns a structured logger instance."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        handler.addFilter(SensitiveDataRedactor())
        logger.addHandler(handler)
        logger.propagate = False
    return logger


# Global logger instance
logger = setup_logger()
