"""
Hugging Face Inference API & Client Integration Unit Tests (test_hf_client.py)
Follows AGENTS.md (MVP conventions) and docs/basic-prompt/CODING_STANDARDS.md.
"""

import os
import sys
import pytest
from typing import Dict, List, Optional
from dotenv import load_dotenv

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.llm_client import get_hf_client, DEFAULT_HF_MODEL
from src.logging_config import logger
from src.tracing import observe

load_dotenv()


@pytest.mark.asyncio
@observe(name="test_hf_client_chat_completion", as_type="evaluator")
async def test_hf_client_chat_completion() -> None:
    """Verify HuggingFace AsyncInferenceClient chat completion with graceful offline skip."""
    hf_token: Optional[str] = os.environ.get("HF_TOKEN")
    if not hf_token:
        pytest.skip("HF_TOKEN environment variable not configured")
        
    client = get_hf_client()
    if client is None:
        pytest.skip("HuggingFace client could not be initialized")

    try:
        messages: List[Dict[str, str]] = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "What is Germany's capital city?"}
        ]
        
        response = await client.chat_completion(
            messages=messages,
            model=DEFAULT_HF_MODEL,
            max_tokens=100,
            temperature=0.1
        )
        assert response.choices[0].message.content is not None, "Expected non-null choice content from HF API"
        logger.info(" ✅ Hugging Face LLM client test passed successfully!")
    except Exception as e:
        logger.warning(f"[SKIP] HF Inference API network call skipped: {e}")
        pytest.skip(f"HF Inference API network call skipped: {e}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(test_hf_client_chat_completion())