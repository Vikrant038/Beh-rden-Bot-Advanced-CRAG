"""
One-Off PostgreSQL + pgvector Database Migration Script (Disk -> PostgreSQL)
Follows AGENTS.md (MVP conventions) and docs/basic-prompt/CODING_STANDARDS.md.
"""

import os
import json
import asyncio
import numpy as np
from typing import Optional
from sqlalchemy import select, func, delete

from src.database import init_db, SessionLocal, DocumentChunk
from src.logging_config import logger
from src.utils import get_data_dir
from src.errors import NotFoundError


async def migrate_chunks_to_postgres_async(force: bool = False) -> bool:
    data_dir = get_data_dir()
    meta_path = os.path.join(data_dir, "processed", "chunk_metadata.json")
    emb_path = os.path.join(data_dir, "processed", "embeddings.npy")

    if not os.path.exists(meta_path) or not os.path.exists(emb_path):
        raise NotFoundError(f"Required migration files not found: {meta_path} or {emb_path}. Run src/ingest.py and src/embed.py first.")

    logger.info("[MIGRATE] Loading metadata and embeddings...")
    with open(meta_path, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    embeddings = np.load(emb_path)
    logger.info(f"[MIGRATE] Loaded {len(metadata)} metadata items and embeddings matrix of shape {embeddings.shape}.")

    await init_db()

    async with SessionLocal() as db:
        try:
            count_res = await db.execute(select(func.count(DocumentChunk.id)))
            existing_count = count_res.scalar_one() or 0

            if existing_count > 0 and not force:
                logger.info(f"[MIGRATE] Table 'document_chunks' already contains {existing_count} rows. Skipping migration (use force=True to overwrite).")
                return True

            if force and existing_count > 0:
                logger.info(f"[MIGRATE] Force flag active. Clearing {existing_count} existing rows...")
                await db.execute(delete(DocumentChunk))

            logger.info("[MIGRATE] Bulk inserting document chunks into PostgreSQL...")
            chunks_to_insert = []
            for i, meta in enumerate(metadata):
                vector = embeddings[i].tolist()
                chunk_obj = DocumentChunk(
                    source_name=meta.get("source_name", "Unknown Source"),
                    source_url=meta.get("source_url", ""),
                    text=meta.get("text", ""),
                    embedding=vector
                )
                chunks_to_insert.append(chunk_obj)

            db.add_all(chunks_to_insert)
            await db.commit()
            logger.info(f"✅ Successfully migrated {len(chunks_to_insert)} document chunks into PostgreSQL pgvector table!")
            return True
        except Exception as e:
            await db.rollback()
            logger.warning(f"❌ Migration failed: {e}")
            return False


def migrate_chunks_to_postgres(force: bool = False) -> bool:
    return asyncio.run(migrate_chunks_to_postgres_async(force=force))


if __name__ == "__main__":
    migrate_chunks_to_postgres()
