"""
Multi-Provider Resilient LLM Wrapper: Groq Primary + HuggingFace Fallback
Complies with AGENTS.md §2 & Gotcha #4, GUARDRAILS.md 2.6, and CODING_STANDARDS.md.
"""

import os
import asyncio
import pybreaker
from typing import List, Dict, Optional, AsyncGenerator
from dotenv import load_dotenv

from src.logging_config import logger
from src.errors import LLMProviderError, RateLimitError

load_dotenv()

DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant"
DEFAULT_HF_MODEL = "meta-llama/Llama-3.1-8B-Instruct"

_groq_client = None
_hf_client = None

# Circuit Breaker: trips after 5 failures, half-opens after 60 seconds
groq_breaker = pybreaker.CircuitBreaker(fail_max=5, reset_timeout=60)
hf_breaker = pybreaker.CircuitBreaker(fail_max=5, reset_timeout=60)

# Semaphore to prevent rate limiting (HTTP 429 Too Many Requests)
llm_semaphore = asyncio.Semaphore(10)


def get_groq_client():
    global _groq_client
    if _groq_client is None:
        groq_key = os.environ.get("GROQ_API_KEY")
        if groq_key:
            try:
                try:
                    from langfuse.openai import AsyncOpenAI
                    _groq_client = AsyncOpenAI(
                        api_key=groq_key,
                        base_url="https://api.groq.com/openai/v1"
                    )
                    logger.info("[LLM CLIENT] Initialized Groq client via Langfuse OpenAI wrapper.")
                except ImportError:
                    from groq import AsyncGroq
                    _groq_client = AsyncGroq(api_key=groq_key)
                    logger.warning("[LLM CLIENT] WARN: 'openai' package not found. Using standard AsyncGroq.")
            except Exception as e:
                logger.warning(f"[WARN] Failed to initialize Groq client: {e}")
    return _groq_client


def get_hf_client():
    global _hf_client
    if _hf_client is None:
        hf_token = os.environ.get("HF_TOKEN")
        if hf_token:
            try:
                from huggingface_hub import AsyncInferenceClient
                _hf_client = AsyncInferenceClient(token=hf_token)
            except Exception as e:
                logger.warning(f"[WARN] Failed to initialize HuggingFace client: {e}")
    return _hf_client


@groq_breaker
async def _call_groq(messages: List[dict], max_tokens: int, temperature: float, user: Optional[str] = None) -> str:
    groq_client = get_groq_client()
    if not groq_client:
        raise LLMProviderError("Groq client unavailable (GROQ_API_KEY not configured).")
    
    create_kwargs = {
        "model": DEFAULT_GROQ_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature
    }
    if user:
        create_kwargs["user"] = user

    for attempt in range(1, 4):
        try:
            async with llm_semaphore:
                response = await groq_client.chat.completions.create(**create_kwargs)
            return response.choices[0].message.content.strip()
        except Exception as e:
            if attempt < 3:
                await asyncio.sleep(1.5 * attempt)
            else:
                raise LLMProviderError(f"Groq API call failed after {attempt} attempts: {e}")


@hf_breaker
async def _call_hf(messages: List[dict], max_tokens: int, temperature: float) -> str:
    hf_client = get_hf_client()
    if not hf_client:
        raise LLMProviderError("HuggingFace client unavailable (HF_TOKEN not configured).")
        
    for attempt in range(1, 3):
        try:
            async with llm_semaphore:
                prompt_str = "\n".join([f"{m['role']}: {m['content']}" for m in messages])
                response = await hf_client.text_generation(
                    prompt_str,
                    model=DEFAULT_HF_MODEL,
                    max_new_tokens=max_tokens,
                    temperature=temperature
                )
            return response.strip()
        except Exception as e:
            if attempt < 2:
                await asyncio.sleep(1.5)
            else:
                raise LLMProviderError(f"HuggingFace API call failed after {attempt} attempts: {e}")


async def call_llm(messages: List[dict], max_tokens: int = 600, temperature: float = 0.1, user: Optional[str] = None) -> str:
    """
    Centralized Resilient LLM Caller with Circuit Breaker and Semaphores.
    """
    try:
        return await _call_groq(messages, max_tokens, temperature, user=user)
    except pybreaker.CircuitBreakerError:
        logger.warning("[CIRCUIT BREAKER] Groq is OPEN! Instantly failing over to HuggingFace.")
    except Exception as e:
        logger.warning(f"[WARN] Groq API call failed: {e}. Falling back to HF.")

    try:
        return await _call_hf(messages, max_tokens, temperature)
    except pybreaker.CircuitBreakerError:
        logger.warning("[CIRCUIT BREAKER] HuggingFace is OPEN!")
    except Exception as e:
        logger.warning(f"[WARN] HuggingFace API call failed: {e}.")

    raise LLMProviderError("No working LLM provider available! Please ensure GROQ_API_KEY or HF_TOKEN is set.")


async def call_llm_stream(messages: List[dict], max_tokens: int = 600, temperature: float = 0.2, user: Optional[str] = None) -> AsyncGenerator[str, None]:
    """
    Streaming generator for FastAPI Server-Sent Events (SSE).
    Uses langfuse.openai AsyncOpenAI client for automatic, native stream tracing and token tracking.
    """
    groq_client = get_groq_client()
    if groq_client:
        stream = None
        try:
            create_kwargs = {
                "model": DEFAULT_GROQ_MODEL,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "stream": True,
                "stream_options": {"include_usage": True}
            }
            if user:
                create_kwargs["user"] = user

            async with llm_semaphore:
                stream = await groq_client.chat.completions.create(**create_kwargs)

            async for chunk in stream:
                if hasattr(chunk, "choices") and chunk.choices and chunk.choices[0].delta.content:
                    yield chunk.choices[0].delta.content
            return
        except Exception as e:
            logger.warning(f"[WARN] Groq API streaming failed ({e}). Falling back to HF call.")
        finally:
            if stream is not None and hasattr(stream, "aclose"):
                try:
                    await stream.aclose()
                except Exception:
                    pass

    hf_client = get_hf_client()
    if hf_client:
        res = await call_llm(messages, max_tokens, temperature, user=user)
        yield res
        return

    yield "Error: LLM Providers offline."
