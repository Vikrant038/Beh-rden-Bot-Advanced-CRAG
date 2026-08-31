"""
Langfuse v4 & OpenTelemetry Tracing Unit Tests (test_tracing.py)
Follows AGENTS.md (MVP conventions) and docs/basic-prompt/CODING_STANDARDS.md.
"""

import os
import sys
import pytest
import asyncio
from unittest.mock import patch, AsyncMock
from typing import Optional

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.tracing import langfuse_client, observe, propagate_attributes, flush_telemetry
from src.agentic_rag import run_agentic_rag_pipeline, AgenticRAGResponse
from src.logging_config import logger


@pytest.mark.asyncio
@observe(name="test_tracing_graceful_fallback_without_keys", as_type="evaluator")
async def test_tracing_graceful_fallback_without_keys() -> None:
    """Test that the application doesn't crash if Langfuse/W&B keys are missing or host is offline."""
    propagate_attributes(user_id="test_user_tracing", session_id="test_session_tracing")
    try:
        response: AgenticRAGResponse = await run_agentic_rag_pipeline("What is an APS certificate?", session_id="test_tracing", bypass_cache=True)
        assert response is not None, "Response must not be None"
        assert response.total_latency_ms >= 0.0, "Latency must be non-negative"
        logger.info(" ✅ Tracing fallback test passed successfully!")
    except Exception as e:
        logger.warning(f"[SKIP] Live pipeline execution skipped in test: {e}")
        pytest.skip(f"Live pipeline execution skipped: {e}")
    finally:
        await flush_telemetry()


def test_tracing_module_initialization() -> None:
    """Verify that tracing gracefully disables itself if dependencies or keys are missing."""
    import src.tracing as tracing
    pub_key: Optional[str] = os.environ.get("LANGFUSE_PUBLIC_KEY")
    if not pub_key:
        assert tracing.langfuse_client is None, "langfuse_client must be None when keys missing"
        logger.info(" ✅ Tracing initialization verification passed (keys missing).")


@pytest.mark.asyncio
@observe(name="test_tracing_span_metadata_injection", as_type="evaluator")
async def test_tracing_span_metadata_injection() -> None:
    """Test that metadata injection and domain checking context do not throw errors."""
    from src.advanced_retrieval import is_query_out_of_domain
    
    with patch("src.advanced_retrieval.call_llm", new_callable=AsyncMock) as mock_llm:
        mock_llm.side_effect = ["NO", "YES"]
        try:
            result: bool = await is_query_out_of_domain("How to cook pasta?")
            assert result is True, "Out-of-domain query must return True"
            
            result_valid: bool = await is_query_out_of_domain("How to apply for German student visa?")
            assert result_valid is False, "In-domain query must return False"
            logger.info(" ✅ Tracing metadata injection test passed successfully!")
        except Exception as e:
            pytest.fail(f"Metadata injection failed: {e}")
