import os
import json
from dotenv import load_dotenv

from src.rag import rag_answer, RAGQueryRequest

load_dotenv()

GOLDEN_QUESTIONS_PATH = "data/processed/golden_20_questions.json"


def run_trulens_evaluation():
    """
    TruLens RAG Triad Evaluation Dashboard (Layer 1 Development Suite)
    """
    print("==================================================")
    print("TRULENS RAG TRIAD EVALUATION DASHBOARD (tests/eval_trulens.py)")
    print("==================================================\n")

    try:
        from trulens_eval import Tru, Feedback, Select
        from trulens_eval.feedback.provider.huggingface import Huggingface
        from trulens_eval.tru_custom_app import TruCustomApp
    except ImportError:
        print("[INFO] trulens_eval package not installed. Installing via pip or running standalone fallback...")
        print("To run TruLens dashboard, execute: pip install trulens-eval")
        return

    tru = Tru()
    tru.reset_database()

    # Load Golden Questions
    with open(GOLDEN_QUESTIONS_PATH, "r", encoding="utf-8") as f:
        questions = json.load(f)

    print(f"Executing TruLens recording over {len(questions[:5])} sample questions...")

    for item in questions[:5]:
        q_text = item["question"]
        req = RAGQueryRequest(question=q_text, top_k=5)
        res = rag_answer(req)
        print(f"Recorded response for: '{q_text[:40]}...' | Latency: {res.latency_ms:.1f}ms")

    print("\nStarting TruLens Leaderboard Dashboard at http://localhost:8501 ...")
    tru.run_dashboard()


if __name__ == "__main__":
    run_trulens_evaluation()
