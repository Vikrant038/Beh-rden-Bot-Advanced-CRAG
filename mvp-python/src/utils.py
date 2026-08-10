import os
import re
import unicodedata
from pathlib import Path
from typing import Optional
from pydantic import BaseModel, Field, field_validator
from src.logging_config import logger

def get_project_root() -> Path:
    """Returns the absolute root directory path of the repository."""
    return Path(__file__).resolve().parent.parent

def get_data_dir() -> Path:
    """Returns the data directory path, creating it if it doesn't exist."""
    data_dir = get_project_root() / os.environ.get("DATA_DIR", "data")
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir

class ChunkModel(BaseModel):
    """Pydantic model validating text chunk attributes."""

    text: str = Field(..., min_length=50, description="The chunk content text")
    source_id: str = Field(..., description="Unique source identifier")
    source_name: str = Field(..., description="Human readable document title")
    source_url: str = Field(..., description="URL or local path to source document")
    chunk_index: int = Field(..., ge=0, description="Sequential index within parent document")
    char_count: int = Field(..., gt=0, description="Length of chunk text in characters")
    
    @field_validator('text')
    @classmethod
    def text_must_not_be_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError('Chunk text cannot be blank')
        return v.strip()

def clean_text(text: str) -> str:
    """
    Clean extracted text for RAG ingestion.
    Preserves German characters and meaningful whitespace.
    """
    if not text:
        return ""
    
    # Step 1: Normalize unicode (keep German umlauts compostaion)
    text = unicodedata.normalize("NFC", text)
    
    # Step 2: Remove common PDF artifacts
    text = re.sub(r'\x00', '', text)           # null bytes
    text = re.sub(r'\uf0b7', '-', text)        # PDF bullet point artifact
    text = re.sub(r'\uf06c', '', text)         # common PDF artifact
    
    # Step 3: Remove repeated page headers/footers
    lines = text.split('\n')
    line_counts = {}
    for line in lines:
        stripped = line.strip()
        if len(stripped) > 5:   # ignore very short lines
            line_counts[stripped] = line_counts.get(stripped, 0) + 1
    
    # Remove lines that appear more than 3 times (boilerplate)
    cleaned_lines = []
    for line in lines:
        stripped = line.strip()
        if line_counts.get(stripped, 0) <= 3:
            cleaned_lines.append(line)
    
    text = '\n'.join(cleaned_lines)
    
    # Step 4: Normalize whitespace (collapse multiple blank lines to max 2)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)    # multiple spaces -> single space
    text = re.sub(r' \n', '\n', text)      # trailing spaces before newline
    
    # Step 5: Remove very short lines that are likely noise
    lines = text.split('\n')
    lines = [l for l in lines if len(l.strip()) > 2 or l.strip() == '']
    
    return '\n'.join(lines).strip()

def count_tokens_approx(text: str) -> int:
    """Approximate token count (1 token ≈ 4 chars for English/German text)."""
    return len(text) // 4

def print_text_stats(text: str, source_id: str):
    """Print statistics about extracted text for quality check."""
    lines = text.split('\n')
    words = len(text.split())
    tokens = count_tokens_approx(text)
    logger.info(
        f"[STATS] {source_id}: {len(text)} chars | {words} words | ~{tokens} tokens | {len(lines)} lines"
    )
