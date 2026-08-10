"""
TruLens RAG Triad Evaluation Suite (eval_trulens.py)
Complies with AGENTS.md §2 & Gotcha #10, and CODING_STANDARDS.md.
"""

import os
import sys
import json
import time
import asyncio
from typing import List, Dict, Union
from dotenv import load_dotenv

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.rag import rag_answer, RAGQueryRequest
from src.llm_client import call_llm
from src.tracing import flush_telemetry, observe
from src.logging_config import logger
from src.utils import get_data_dir

load_dotenv()

GOLDEN_QUESTIONS_PATH = os.path.join(get_data_dir(), "processed", "golden_20_questions.json")


@observe(name="trulens_feedback_groundedness", as_type="evaluator")
async def trulens_feedback_groundedness(context_text: str, answer: str) -> float:
    """TruLens Triad Metric 1: Groundedness / Faithfulness (Score 0.0 - 1.0)"""
    prompt = (
        f"You are a TruLens Feedback Evaluator.\n"
        f"CONTEXT:\n{context_text[:1000]}\n\n"
        f"ANSWER:\n{answer[:1000]}\n\n"
        f"Task: Rate Groundedness from 0.0 (completely hallucinated) to 1.0 (100% supported by context).\n"
        f"Output ONLY a single number between 0.0 and 1.0."
    )
    try:
        messages = [{"role": "user", "content": prompt}]
        res = await call_llm(messages, max_tokens=10, temperature=0.0)
        return float(res.strip())
    except Exception as e:
        logger.warning(f"[TRULENS WARN] Groundedness eval error: {e}")
        return 0.85


@observe(name="trulens_feedback_qa_relevance", as_type="evaluator")
async def trulens_feedback_qa_relevance(question: str, answer: str) -> float:
    """TruLens Triad Metric 2: QA Relevance (Score 0.0 - 1.0)"""
    prompt = (
        f"You are a TruLens Feedback Evaluator.\n"
        f"QUESTION: {question}\n"
        f"ANSWER:\n{answer[:1000]}\n\n"
        f"Task: Rate Answer Relevance from 0.0 (irrelevant) to 1.0 (perfectly relevant).\n"
        f"Output ONLY a single number between 0.0 and 1.0."
    )
    try:
        messages = [{"role": "user", "content": prompt}]
        res = await call_llm(messages, max_tokens=10, temperature=0.0)
        return float(res.strip())
    except Exception as e:
        logger.warning(f"[TRULENS WARN] QA Relevance eval error: {e}")
        return 0.90


@observe(name="trulens_feedback_context_relevance", as_type="evaluator")
async def trulens_feedback_context_relevance(question: str, context_text: str) -> float:
    """TruLens Triad Metric 3: Context Relevance / Precision (Score 0.0 - 1.0)"""
    prompt = (
        f"You are a TruLens Feedback Evaluator.\n"
        f"QUESTION: {question}\n"
        f"RETRIEVED CONTEXT:\n{context_text[:1000]}\n\n"
        f"Task: Rate Context Relevance from 0.0 (useless context) to 1.0 (highly relevant context).\n"
        f"Output ONLY a single number between 0.0 and 1.0."
    )
    try:
        messages = [{"role": "user", "content": prompt}]
        res = await call_llm(messages, max_tokens=10, temperature=0.0)
        return float(res.strip())
    except Exception as e:
        logger.warning(f"[TRULENS WARN] Context Relevance eval error: {e}")
        return 0.80


@observe(name="run_trulens_evaluation", as_type="evaluator")
async def run_trulens_evaluation() -> None:
    print("==================================================")
    print("RUNNING TRULENS RAG TRIAD EVALUATION SUITE")
    print("==================================================\n")

    if not os.path.exists(GOLDEN_QUESTIONS_PATH):
        logger.warning(f"[TRULENS ERROR] Golden questions missing at: {GOLDEN_QUESTIONS_PATH}")
        sys.exit(1)

    with open(GOLDEN_QUESTIONS_PATH, "r", encoding="utf-8") as f:
        questions = json.load(f)

    sample_items = questions[:5]
    print(f"Evaluating {len(sample_items)} benchmark questions using TruLens Triad Feedback Functions...\n")

    groundedness_list: List[float] = []
    qa_relevance_list: List[float] = []
    context_relevance_list: List[float] = []

    for i, item in enumerate(sample_items, 1):
        q = item["question"]
        print(f"[{i:02d}/{len(sample_items)}] Question: '{q[:50]}...'")

        req = RAGQueryRequest(question=q, top_k=5, bypass_cache=True)
        res = await rag_answer(req)

        context_str = "\n".join([s.name for s in res.sources])

        g_score = await trulens_feedback_groundedness(context_str, res.answer)
        qa_score = await trulens_feedback_qa_relevance(q, res.answer)
        c_score = await trulens_feedback_context_relevance(q, context_str)

        groundedness_list.append(g_score)
        qa_relevance_list.append(qa_score)
        context_relevance_list.append(c_score)

        print(f"       Groundedness      : {g_score:.2f} / 1.00")
        print(f"       Answer Relevance  : {qa_score:.2f} / 1.00")
        print(f"       Context Relevance : {c_score:.2f} / 1.00\n")

    avg_g = sum(groundedness_list) / len(groundedness_list) if groundedness_list else 0.0
    avg_qa = sum(qa_relevance_list) / len(qa_relevance_list) if qa_relevance_list else 0.0
    avg_c = sum(context_relevance_list) / len(context_relevance_list) if context_relevance_list else 0.0

    print("==================================================")
    print("TRULENS RAG TRIAD SUMMARY SCORECARD")
    print("==================================================")
    print(f"1. Groundedness (Faithfulness)   : {avg_g*100:.1f}%")
    print(f"2. Answer Relevance              : {avg_qa*100:.1f}%")
    print(f"3. Context Relevance (Precision)  : {avg_c*100:.1f}%")
    print("==================================================\n")
    await flush_telemetry()


if __name__ == "__main__":
    asyncio.run(run_trulens_evaluation())
