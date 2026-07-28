import os
import time
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator
from dotenv import load_dotenv

load_dotenv()

DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant"
DEFAULT_HF_MODEL = "meta-llama/Llama-3.1-8B-Instruct"


def call_llm(messages: list[dict], max_tokens: int = 600, temperature: float = 0.1) -> str:
    groq_key = os.environ.get("GROQ_API_KEY")
    if groq_key:
        try:
            from groq import Groq
            client = Groq(api_key=groq_key)
            response = client.chat.completions.create(
                model=DEFAULT_GROQ_MODEL,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"[WARN] Groq API failed ({e}), attempting HuggingFace fallback...")

    hf_token = os.environ.get("HF_TOKEN")
    if hf_token:
        try:
            from huggingface_hub import InferenceClient
            client = InferenceClient(token=hf_token)
            response = client.chat.completions.create(
                model=DEFAULT_HF_MODEL,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            print(f"[ERROR] Hugging Face API fallback failed: {e}")
            
    raise RuntimeError("No working LLM API keys found! Add GROQ_API_KEY or HF_TOKEN to your .env file.")


class SourceModel(BaseModel):
    name: str = Field(..., description="Document title")
    url: str = Field(..., description="URL or local path to official document")
    score: float = Field(0.0, description="Relevance score")


class RAGQueryRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=1000, description="User question")
    top_k: int = Field(5, ge=1, le=10, description="Number of context chunks to retrieve")

    @field_validator('question')
    @classmethod
    def validate_question(cls, v: str) -> str:
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Question cannot be empty or whitespace.")
        return cleaned


class RAGResponse(BaseModel):
    question: str
    answer: str
    sources: List[SourceModel]
    retrieval_path: str
    latency_ms: float
    is_grounded: bool
    is_ambiguous: bool = False
    clarification_options: List[str] = []


# ==========================================
# LEAN & FOCUSED SYSTEM PROMPT (NO BLOAT)
# ==========================================
SYSTEM_PROMPT = """You are Behoerden-Bot, an expert informational assistant specializing in German immigration, student visas, and university admission processes.

RULES:
1. Answer ONLY using the provided context documents. Do NOT use outside assumptions.
2. If the context does not contain enough information to answer the question, state: "I do not have sufficient information in my knowledge base to answer this question reliably."
3. Every factual claim must be backed by context. Never fabricate fees, deadlines, or requirements.
4. Structure your response with clear numbered lists and bold section headings.
5. End your response with: "Disclaimer: This is general information only. Always verify critical decisions with official German Embassy, DAAD, or BAMF portals."
"""

USER_PROMPT_TEMPLATE = """Use strictly the following retrieved context documents to answer the question.

=== RETRIEVED CONTEXT DOCUMENTS ===
{context_text}
===================================

USER QUESTION: {question}

Provide a clear, structured, step-by-step answer based ONLY on the context above."""


def format_context_for_prompt(chunks: list[dict]) -> str:
    if not chunks:
        return "No relevant context documents found."

    context_blocks = []
    for i, chunk in enumerate(chunks, 1):
        context_blocks.append(
            f"--- Document {i} (Source: {chunk['source_name']}) ---\n"
            f"{chunk['text']}\n"
        )
    return "\n".join(context_blocks)


def extract_unique_sources(chunks: list[dict]) -> List[SourceModel]:
    seen_names = set()
    sources = []
    for c in chunks:
        name = c.get("source_name", "Official Source")
        url = c.get("source_url", "")
        if url.startswith("local:"):
            url = "https://aps-india.de/"
            
        if name not in seen_names:
            seen_names.add(name)
            score_val = float(c.get("cross_score", c.get("similarity_score", 0.0)))
            sources.append(SourceModel(
                name=name,
                url=url,
                score=score_val
            ))
    return sources


def rag_answer(request: RAGQueryRequest) -> RAGResponse:
    from src.advanced_retrieval import advanced_crag_retrieve, detect_query_ambiguity
    
    start_time = time.time()

    # Step 0: Check Query Ambiguity Node
    ambiguity_res = detect_query_ambiguity(request.question)
    if ambiguity_res.get("is_ambiguous", False):
        total_latency = (time.time() - start_time) * 1000
        return RAGResponse(
            question=request.question,
            answer="Your question is broad and could refer to a few different topics. To give you the exact official information, please select what you meant:",
            sources=[],
            retrieval_path="DISAMBIGUATION_NODE",
            latency_ms=total_latency,
            is_grounded=True,
            is_ambiguous=True,
            clarification_options=ambiguity_res.get("options", [])
        )

    # Step 1: Execute CRAG Retrieval
    retrieval_res = advanced_crag_retrieve(request.question, final_top_k=request.top_k)
    raw_chunks = retrieval_res.get("chunks", [])
    needs_fallback = retrieval_res.get("needs_web_fallback", False)

    filtered_chunks = [c for c in raw_chunks if c.get("cross_score", c.get("similarity_score", 0.0)) >= 0.20]
    if not filtered_chunks and raw_chunks and raw_chunks[0].get("cross_score", 0.0) >= 0.10:
        filtered_chunks = [raw_chunks[0]]

    if needs_fallback or not filtered_chunks:
        fallback_answer = (
            "I do not have reliable information on this specific question in my current knowledge base.\n\n"
            "This question may fall outside my current domain (German immigration, student visas, and university applications).\n\n"
            "Please consult official German portals directly:\n"
            "- Make it in Germany: https://www.make-it-in-germany.com/en/\n"
            "- BAMF (Federal Office for Migration): https://www.bamf.de/EN/\n"
            "- DAAD: https://www.daad.de/en/\n"
            "- APS India: https://aps-india.de/"
        )
        total_latency = (time.time() - start_time) * 1000
        return RAGResponse(
            question=request.question,
            answer=fallback_answer,
            sources=[],
            retrieval_path=retrieval_res.get("path_used", "FALLBACK"),
            latency_ms=total_latency,
            is_grounded=False
        )

    context_text = format_context_for_prompt(filtered_chunks)
    user_prompt = USER_PROMPT_TEMPLATE.format(
        context_text=context_text,
        question=request.question
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt}
    ]
    
    print(f"[RAG GENERATION] Synthesizing answer using {len(filtered_chunks)} high-relevance chunks...")
    raw_answer = call_llm(messages, max_tokens=600, temperature=0.1)

    sources = extract_unique_sources(filtered_chunks)
    total_latency = (time.time() - start_time) * 1000

    return RAGResponse(
        question=request.question,
        answer=raw_answer,
        sources=sources,
        retrieval_path=retrieval_res.get("path_used", "CRAG"),
        latency_ms=total_latency,
        is_grounded=True
    )


if __name__ == "__main__":
    req = RAGQueryRequest(
        question="When I move into germany for pursuing masters",
        top_k=5
    )
    res = rag_answer(req)
    print(f"\n==================================================")
    print(f"QUESTION: {res.question}")
    print(f"IS AMBIGUOUS: {res.is_ambiguous}")
    print(f"CLARIFICATION OPTIONS: {res.clarification_options}")
    print(f"ANSWER:\n{res.answer}")
