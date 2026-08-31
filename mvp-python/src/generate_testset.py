"""
Synthetic Evaluation Ground-Truth Dataset Generator
Follows AGENTS.md (MVP conventions) and docs/basic-prompt/CODING_STANDARDS.md.
"""

import os
import json
import random
from pathlib import Path
from typing import List, Dict
from dotenv import load_dotenv
from pydantic import BaseModel, Field

from src.llm_client import call_llm
from src.logging_config import logger
from src.utils import get_data_dir
from src.errors import NotFoundError

load_dotenv()

OUTPUT_DATASET_PATH = os.path.join(get_data_dir(), "processed", "synthetic_eval_dataset.json")
CHUNKS_PATH = os.path.join(get_data_dir(), "processed", "all_chunks.json")


class SyntheticEvalItem(BaseModel):
    id: str
    source_id: str
    source_name: str
    source_url: str
    ground_truth_context: str
    question: str
    ground_truth_answer: str


async def generate_synthetic_eval_dataset(num_questions: int = 15) -> List[dict]:
    if not os.path.exists(CHUNKS_PATH):
        raise NotFoundError(f"Chunks file missing: {CHUNKS_PATH}. Run src/ingest.py first.")

    with open(CHUNKS_PATH, "r", encoding="utf-8") as f:
        chunks = json.load(f)

    sampled_chunks = random.sample(chunks, min(num_questions, len(chunks)))

    eval_items = []
    logger.info(f"GENERATING {len(sampled_chunks)} SYNTHETIC GROUND-TRUTH TEST PAIRS")

    for i, chunk in enumerate(sampled_chunks, 1):
        logger.info(f"[{i}/{len(sampled_chunks)}] Generating Q&A pair from source: {chunk.get('source_id', 'unknown')}...")
        
        prompt = (
            f"Given the following official document text:\n"
            f"\"{chunk['text']}\"\n\n"
            f"Tasks:\n"
            f"1. Generate 1 specific, natural question that can be answered using ONLY this text.\n"
            f"2. Provide a concise, accurate ground truth answer to that question based ONLY on the text.\n\n"
            f"Format output EXACTLY as:\n"
            f"QUESTION: <your question>\n"
            f"ANSWER: <your ground truth answer>"
        )

        try:
            messages = [{"role": "user", "content": prompt}]
            content = await call_llm(messages, max_tokens=250, temperature=0.4)

            q_part = ""
            a_part = ""
            for line in content.split("\n"):
                if line.startswith("QUESTION:"):
                    q_part = line.replace("QUESTION:", "").strip()
                elif line.startswith("ANSWER:"):
                    a_part = line.replace("ANSWER:", "").strip()

            if q_part and a_part:
                item = SyntheticEvalItem(
                    id=f"SYN-{i:02d}",
                    source_id=chunk.get("source_id", "unknown"),
                    source_name=chunk.get("source_name", "Unknown"),
                    source_url=chunk.get("source_url", ""),
                    ground_truth_context=chunk["text"],
                    question=q_part,
                    ground_truth_answer=a_part
                )
                eval_items.append(item.model_dump())
                logger.info(f"   - Q: {q_part[:60]}...")

        except Exception as e:
            logger.warning(f"[WARN] Failed to generate for item {i}: {e}")

    Path(os.path.dirname(OUTPUT_DATASET_PATH)).mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_DATASET_PATH, "w", encoding="utf-8") as f:
        json.dump(eval_items, f, ensure_ascii=False, indent=2)

    logger.info(f"Synthetic Dataset Created! Saved {len(eval_items)} pairs -> {OUTPUT_DATASET_PATH}")
    return eval_items


if __name__ == "__main__":
    import asyncio
    asyncio.run(generate_synthetic_eval_dataset(num_questions=10))
