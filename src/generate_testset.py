import os
import json
import random
from pathlib import Path
from dotenv import load_dotenv
from huggingface_hub import InferenceClient
from pydantic import BaseModel, Field

load_dotenv()

OUTPUT_DATASET_PATH = "data/processed/synthetic_eval_dataset.json"
CHUNKS_PATH = "data/processed/all_chunks.json"


class SyntheticEvalItem(BaseModel):
    id: str
    source_id: str
    source_name: str
    source_url: str
    ground_truth_context: str
    question: str
    ground_truth_answer: str


def generate_synthetic_eval_dataset(num_questions: int = 15):
    """
    Generate synthetic (Question, Ground_Truth_Context, Ground_Truth_Answer) triples
    from actual document chunks using Qwen-72B LLM.
    """
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise ValueError("HF_TOKEN not found in environment!")

    if not os.path.exists(CHUNKS_PATH):
        raise FileNotFoundError(f"{CHUNKS_PATH} not found. Run chunking first!")

    with open(CHUNKS_PATH, "r", encoding="utf-8") as f:
        chunks = json.load(f)

    # Sample diverse chunks across sources
    sampled_chunks = random.sample(chunks, min(num_questions, len(chunks)))
    client = InferenceClient(token=token)

    eval_items = []
    print(f"==================================================")
    print(f"🤖 GENERATING {len(sampled_chunks)} SYNTHETIC GROUND-TRUTH TEST PAIRS")
    print(f"==================================================\n")

    for i, chunk in enumerate(sampled_chunks, 1):
        print(f"[{i}/{len(sampled_chunks)}] Generating Q&A pair from source: {chunk['source_id']}...")
        
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
            response = client.chat.completions.create(
                model="meta-llama/Llama-3.1-8B-Instruct",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=250,
                temperature=0.4
            )

            content = response.choices[0].message.content.strip()
            
            # Parse output
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
                    source_id=chunk["source_id"],
                    source_name=chunk["source_name"],
                    source_url=chunk["source_url"],
                    ground_truth_context=chunk["text"],
                    question=q_part,
                    ground_truth_answer=a_part
                )
                eval_items.append(item.model_dump())
                print(f"   • Q: {q_part[:60]}...")

        except Exception as e:
            print(f"   [WARN] Failed to generate for item {i}: {e}")

    # Save to disk
    Path("data/processed").mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_DATASET_PATH, "w", encoding="utf-8") as f:
        json.dump(eval_items, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Synthetic Dataset Created! Saved {len(eval_items)} pairs → {OUTPUT_DATASET_PATH}")
    return eval_items


if __name__ == "__main__":
    generate_synthetic_eval_dataset(num_questions=10)
