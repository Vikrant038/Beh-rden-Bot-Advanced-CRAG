"""
BGE Embedding Fine-Tuning Pipeline with BM25 Hard Negative Mining & MNRL Loss
Complies with AGENTS.md §2 & §3, Gotcha #3 & #10, and CODING_STANDARDS.md.
"""

import os
import json
import time
import torch
import numpy as np
from pathlib import Path
from typing import List, Dict, Tuple
from dotenv import load_dotenv

from sentence_transformers import SentenceTransformer, InputExample
import sentence_transformers.losses as losses
from torch.utils.data import DataLoader

from src.advanced_retrieval import get_bm25_engine
from src.logging_config import logger
from src.utils import get_data_dir, get_project_root
from src.errors import NotFoundError

load_dotenv()

CHUNKS_PATH = os.path.join(get_data_dir(), "processed", "all_chunks.json")
MODEL_OUTPUT_DIR = os.path.join(get_project_root(), "models", "bge_base_german_visa_finetuned")
BASE_MODEL_NAME = "BAAI/bge-base-en-v1.5"


def get_device() -> str:
    """Detect Mac Apple Silicon Metal Performance Shaders (MPS) or CUDA."""
    if torch.backends.mps.is_available():
        return "mps"
    elif torch.cuda.is_available():
        return "cuda"
    return "cpu"


def generate_semantic_hard_negatives(chunks: List[dict], num_triples: int = 150) -> List[InputExample]:
    """
    Production Hard Negative Mining using BM25 Keyword Ranker.
    For each query and positive chunk P+, we mine the highest-scoring 
    NON-positive chunk in the entire corpus as the Hard Negative (N-).
    """
    logger.info(f"[DATA PREP] Mining {num_triples} Semantic Hard Negatives via BM25 Ranker...")
    bm25_engine = get_bm25_engine()
    
    examples = []
    num_chunks = len(chunks)
    
    for i in range(min(num_triples, num_chunks)):
        pos_chunk = chunks[i]
        text_pos = pos_chunk["text"]
        pos_id = f"{pos_chunk['source_id']}_{pos_chunk['chunk_index']}"
        
        sentences = [s.strip() for s in text_pos.split(".") if len(s.strip()) > 15]
        if not sentences:
            continue
            
        query = f"What are the official rules regarding {sentences[0][:60]}?"
        
        bm25_results = bm25_engine.search(query, top_k=10)
        
        hard_neg_text = None
        for res in bm25_results:
            res_id = f"{res['source_id']}_{res['chunk_index']}"
            if res_id != pos_id:
                hard_neg_text = res["text"]
                break
                
        if not hard_neg_text:
            hard_neg_text = chunks[(i + 7) % num_chunks]["text"]
            
        example = InputExample(texts=[query, text_pos, hard_neg_text])
        examples.append(example)
        
    logger.info(f"[DATA PREP] Created {len(examples)} mined InputExamples for MNRL training.")
    return examples


def calculate_mrr_at_k(model: SentenceTransformer, queries: List[str], positive_texts: List[str], corpus_texts: List[str], k: int = 10) -> float:
    corpus_embeddings = model.encode(corpus_texts, convert_to_tensor=True, normalize_embeddings=True)
    query_embeddings = model.encode(queries, convert_to_tensor=True, normalize_embeddings=True)
    
    reciprocal_ranks = []
    
    for i in range(len(queries)):
        q_emb = query_embeddings[i]
        pos_text = positive_texts[i]
        
        sim_scores = torch.mm(q_emb.unsqueeze(0), corpus_embeddings.T).squeeze(0)
        top_k_indices = torch.topk(sim_scores, k=min(k, len(corpus_texts))).indices.tolist()
        
        rank = 0
        for r, idx in enumerate(top_k_indices, start=1):
            if corpus_texts[idx] == pos_text:
                rank = r
                break
                
        if rank > 0:
            reciprocal_ranks.append(1.0 / rank)
        else:
            reciprocal_ranks.append(0.0)
            
    return float(np.mean(reciprocal_ranks))


def finetune_embedding_model(epochs: int = 3, batch_size: int = 16):
    device = get_device()
    logger.info(f"🚀 DOMAIN FINE-TUNING PIPELINE ({BASE_MODEL_NAME}) | DEVICE: {device.upper()}")
    
    if not os.path.exists(CHUNKS_PATH):
        raise NotFoundError(f"Processed chunks missing: {CHUNKS_PATH}. Run src/ingest.py first.")
        
    with open(CHUNKS_PATH, "r", encoding="utf-8") as f:
        chunks = json.load(f)
        
    corpus_texts = [c["text"] for c in chunks]
    
    logger.info(f"[1/4] Loading pre-trained base model: {BASE_MODEL_NAME} on device '{device}'...")
    model = SentenceTransformer(BASE_MODEL_NAME, device=device)
    
    training_examples = generate_semantic_hard_negatives(chunks, num_triples=150)
    
    test_queries = [e.texts[0] for e in training_examples[-20:]]
    test_positives = [e.texts[1] for e in training_examples[-20:]]
    train_examples_final = training_examples[:-20]
    
    logger.info(f"[2/4] Evaluating Baseline MRR@10 before fine-tuning...")
    baseline_mrr = calculate_mrr_at_k(model, test_queries, test_positives, corpus_texts, k=10)
    logger.info(f"   • Baseline Model MRR@10: {baseline_mrr:.4f} ({baseline_mrr*100:.1f}%)")
    
    train_dataloader = DataLoader(train_examples_final, shuffle=True, batch_size=batch_size)
    train_loss = losses.MultipleNegativesRankingLoss(model=model)
    
    logger.info(f"[3/4] Fine-tuning model for {epochs} epoch(s) on Apple Silicon / GPU...")
    t_start = time.time()
    
    model.fit(
        train_objectives=[(train_dataloader, train_loss)],
        epochs=epochs,
        warmup_steps=10,
        show_progress_bar=True
    )
    
    train_time = time.time() - t_start
    logger.info(f"   • Training Complete in {train_time:.1f} seconds!")
    
    logger.info(f"[4/4] Evaluating Fine-Tuned Model MRR@10...")
    finetuned_mrr = calculate_mrr_at_k(model, test_queries, test_positives, corpus_texts, k=10)
    mrr_jump = finetuned_mrr - baseline_mrr
    
    logger.info(f"🏆 FINE-TUNING EVALUATION SCORECARD (MRR@10)")
    logger.info(f"Baseline Model MRR@10   : {baseline_mrr:.4f} ({baseline_mrr*100:.1f}%)")
    logger.info(f"Fine-Tuned Model MRR@10  : {finetuned_mrr:.4f} ({finetuned_mrr*100:.1f}%)")
    logger.info(f"Net Accuracy Jump        : +{mrr_jump:.4f} (+{mrr_jump*100:.1f}%)")
    
    Path(os.path.dirname(MODEL_OUTPUT_DIR)).mkdir(parents=True, exist_ok=True)
    model.save(MODEL_OUTPUT_DIR)
    logger.info(f"✅ Saved Fine-Tuned Model Weights -> {MODEL_OUTPUT_DIR}")


if __name__ == "__main__":
    finetune_embedding_model(epochs=3, batch_size=16)
