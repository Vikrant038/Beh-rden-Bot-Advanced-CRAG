import os
from dotenv import load_dotenv

load_dotenv()

DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant"
DEFAULT_HF_MODEL = "meta-llama/Llama-3.1-8B-Instruct"

_groq_client = None
_hf_client = None


def get_groq_client():
    global _groq_client
    if _groq_client is None:
        groq_key = os.environ.get("GROQ_API_KEY")
        if groq_key:
            try:
                from groq import Groq
                _groq_client = Groq(api_key=groq_key)
            except Exception as e:
                print(f"[WARN] Failed to initialize Groq client: {e}")
    return _groq_client


def get_hf_client():
    global _hf_client
    if _hf_client is None:
        hf_token = os.environ.get("HF_TOKEN")
        if hf_token:
            try:
                from huggingface_hub import InferenceClient
                _hf_client = InferenceClient(token=hf_token)
            except Exception as e:
                print(f"[WARN] Failed to initialize HuggingFace client: {e}")
    return _hf_client


def call_llm(messages: list[dict], max_tokens: int = 600, temperature: float = 0.1) -> str:
    """
    Centralized Resilient LLM Caller:
    1. Tries Groq API (llama-3.1-8b-instant) first.
    2. Falls back to Hugging Face InferenceClient if Groq is unavailable or fails.
    """
    # 1. Primary: Groq API
    groq_client = get_groq_client()
    if groq_client:
        try:
            response = groq_client.chat.completions.create(
                model=DEFAULT_GROQ_MODEL,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"[WARN] Groq API call failed ({e}). Attempting HuggingFace fallback...")

    # 2. Fallback: Hugging Face API
    hf_client = get_hf_client()
    if hf_client:
        try:
            response = hf_client.chat.completions.create(
                model=DEFAULT_HF_MODEL,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"[ERROR] Hugging Face API fallback failed: {e}")

    raise RuntimeError(
        "No working LLM provider available! Please ensure GROQ_API_KEY or HF_TOKEN is set in your .env file."
    )
