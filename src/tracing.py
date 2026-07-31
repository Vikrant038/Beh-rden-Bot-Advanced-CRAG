"""
Langfuse v4 (OpenTelemetry-based) Unified APM & Telemetry Tracing Engine
Complies with AGENTS.md §2 & Environment Matrix, and CODING_STANDARDS.md.
"""

import os
import asyncio
from typing import Optional, Callable
from dotenv import load_dotenv

from src.logging_config import logger

load_dotenv()

_HAS_LANGFUSE = False
_HAS_WEAVE = False
observe: Optional[Callable] = None
propagate_attributes: Optional[Callable] = None

try:
    from langfuse import observe as _observe, Langfuse, propagate_attributes as _propagate_attributes
    observe = _observe
    propagate_attributes = _propagate_attributes
    _HAS_LANGFUSE = True
    logger.info("[TRACING] Langfuse v4 imports successful (observe + propagate_attributes).")
except ImportError:
    try:
        from langfuse import Langfuse
        from langfuse.decorators import observe as _observe, langfuse_context
        observe = _observe
        _HAS_LANGFUSE = True
        logger.info("[TRACING] Langfuse v2/v3 imports successful (decorators API).")
    except Exception as _lf_err:
        logger.warning(f"[TRACING DEBUG] Langfuse import failed with error: {_lf_err} ({type(_lf_err)})")

if not _HAS_LANGFUSE:
    def observe(*args, **kwargs):
        def decorator(func):
            return func
        return decorator

    from contextlib import contextmanager
    @contextmanager
    def propagate_attributes(**kwargs):
        yield

LANGFUSE_PUBLIC_KEY = os.getenv("LANGFUSE_PUBLIC_KEY", "")
LANGFUSE_SECRET_KEY = os.getenv("LANGFUSE_SECRET_KEY", "")
LANGFUSE_HOST = os.getenv("LANGFUSE_HOST", os.getenv("LANGFUSE_BASE_URL", "https://cloud.langfuse.com"))

langfuse_client: Optional['Langfuse'] = None

if not _HAS_LANGFUSE:
    logger.info("[TRACING] INFO: 'langfuse' package not installed. Skipping live APM. (Run: pip install langfuse)")
elif not LANGFUSE_PUBLIC_KEY or not LANGFUSE_SECRET_KEY:
    logger.info("[TRACING] INFO: LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not set in .env. Skipping live APM.")
else:
    os.environ["LANGFUSE_PUBLIC_KEY"] = LANGFUSE_PUBLIC_KEY
    os.environ["LANGFUSE_SECRET_KEY"] = LANGFUSE_SECRET_KEY
    os.environ["LANGFUSE_HOST"] = LANGFUSE_HOST
    try:
        langfuse_client = Langfuse(
            public_key=LANGFUSE_PUBLIC_KEY,
            secret_key=LANGFUSE_SECRET_KEY,
            host=LANGFUSE_HOST
        )
        logger.info(f"[TRACING] Langfuse APM initialized successfully for host: {LANGFUSE_HOST}")
    except Exception as e:
        logger.warning(f"[TRACING] WARN: Failed to initialize Langfuse: {e}")
        langfuse_client = None


def update_current_observation(**kwargs):
    """Compatibility wrapper for observation-level metadata updates."""
    if not _HAS_LANGFUSE:
        return
    try:
        from langfuse import get_client
        client = get_client()
        if client and hasattr(client, 'update_current_span'):
            client.update_current_span(**kwargs)
    except Exception:
        pass


async def flush_telemetry():
    """Flushes all queued Langfuse telemetry events on shutdown."""
    logger.info("[TRACING] Flushing telemetry queues...")
    if langfuse_client:
        try:
            langfuse_client.flush()
            logger.info("[TRACING] Langfuse telemetry flushed successfully.")
        except Exception as e:
            logger.warning(f"[TRACING] WARN: Failed to flush Langfuse: {e}")
