"""
Lightweight PII Masker for GDPR Compliance & Data Privacy.
Complies with GUARDRAILS.md 6.4 and CODING_STANDARDS.md Pillar 4.7.
Regex + spaCy NER. Zero GPU requirement.
"""

import re
from typing import Tuple
from src.logging_config import logger

_PII_PATTERNS = [
    # IBAN unspaced: DE89370400440532013000, GB29NWBK60161331926819 (14-34 chars)
    (re.compile(r'\b[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}\b'), "[IBAN_REDACTED]"),
    # IBAN spaced: DE89 3704 0044 0532 0130 00 (groups of 4 uppercase/digits + optional 2-char tail)
    (re.compile(r'\b[A-Z]{2}[0-9]{2}(?:\s[A-Z0-9]{4})+(?:\s[A-Z0-9]{2})?\b'), "[IBAN_REDACTED]"),
    # Indian passport: A1234567 (letter + 7 digits)
    (re.compile(r'\b[A-PR-WY][1-9]\d\s?\d{4}[1-9]\b'), "[PASSPORT_REDACTED]"),
    # Generic 9-char alphanumeric national ID (German Personalausweis, etc.)
    (re.compile(r'\b[A-Z0-9]{2}[0-9]{7}\b'), "[PASSPORT_REDACTED]"),
    # Dates of birth: 15/01/1990 | 1990-01-15 (birth year range 1920-2010)
    (re.compile(r'\b(?:0?[1-9]|[12]\d|3[01])[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:19[2-9]\d|200\d|201\d)\b|\b(?:19[2-9]\d|200\d|201\d)[\/\-.](?:0?[1-9]|1[0-2])[\/\-.](?:0?[1-9]|[12]\d|3[01])\b'), "[DOB_REDACTED]"),
    # Phone numbers: +91-9876543210 | 0049-30-12345678
    (re.compile(r'(?<![A-Z0-9])(?:\+|00)[1-9]\d{0,2}[\s\-.\(]?\d{2,4}[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}\b'), "[PHONE_REDACTED]"),
    # Email addresses
    (re.compile(r'\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b'), "[EMAIL_REDACTED]"),
]

_nlp = None
_nlp_attempted = False

def _get_nlp():
    """Lazily load spaCy model for PERSON entity recognition."""
    global _nlp, _nlp_attempted
    if _nlp_attempted:
        return _nlp
    _nlp_attempted = True
    try:
        import spacy
        _nlp = spacy.load("en_core_web_sm", disable=["parser", "lemmatizer"])
        logger.info("[PII] spaCy en_core_web_sm loaded successfully. Name masking active.")
    except Exception as e:
        logger.warning(f"[PII] spaCy unavailable: {e}. Regex masking fallback active.")
    return _nlp

def mask_pii(text: str) -> Tuple[str, bool]:
    """
    Mask PII from user input before sending to LLM providers.
    Returns (masked_text, was_pii_detected).
    Fails open: on any error, returns original text unchanged.
    """
    if not text or not isinstance(text, str):
        return text, False
    try:
        masked = text
        found = False
        for pattern, replacement in _PII_PATTERNS:
            new = pattern.sub(replacement, masked)
            if new != masked:
                found = True
                masked = new
                
        nlp = _get_nlp()
        if nlp:
            doc = nlp(masked)
            for ent in reversed(doc.ents):
                if ent.label_ == "PERSON":
                    masked = masked[:ent.start_char] + "[NAME_REDACTED]" + masked[ent.end_char:]
                    found = True
                    
        if found:
            logger.info(f"[PII] Masked. Original: {len(text)} chars, Masked: {len(masked)} chars")
        return masked, found
    except Exception as e:
        logger.warning(f"[PII] Masking failed ({type(e).__name__}: {e}). Failing open safely.")
        return text, False
