"""
Zero-Downtime Transactional Document Sync & Cache Invalidation Pipeline
Follows AGENTS.md (MVP conventions) and docs/basic-prompt/CODING_STANDARDS.md.
"""

import json
from sqlalchemy import delete

from src.database import SessionLocal, DocumentChunk
from src.semantic_cache import get_semantic_cache
from src.ingest import chunk_text
from src.embed import load_embedding_model, embed_chunks
from src.utils import clean_text
from src.logging_config import logger


async def sync_document_transactional(source_name: str, source_url: str, raw_text: str, source_id: str = "custom_sync") -> bool:
    """
    Perform a zero-downtime transactional update of a document's chunks in PostgreSQL.
    
    1. Clean and Chunk the new text
    2. Embed the new chunks
    3. Transactionally delete old chunks and insert new ones
    4. Invalidate Semantic Cache entries referencing this source_name
    """
    logger.info(f"[SYNC] Starting document sync for: {source_name}")
    
    # 1. Clean and Chunk
    cleaned = clean_text(raw_text)
    chunks = chunk_text(
        text=cleaned,
        source_id=source_id,
        source_name=source_name,
        source_url=source_url
    )
    
    if not chunks:
        logger.warning(f"[WARN] No valid chunks generated for {source_name}")
        return False
        
    logger.info(f"[SYNC] Generated {len(chunks)} chunks for {source_name}")
    
    # 2. Embed
    embed_model = load_embedding_model()
    embeddings = embed_chunks(chunks, embed_model)
    
    # 3. Transactional Database Update
    async with SessionLocal() as db:
        try:
            # Delete old chunks
            result = await db.execute(delete(DocumentChunk).where(DocumentChunk.source_name == source_name))
            deleted_count = getattr(result, "rowcount", 0)
            logger.info(f"[SYNC] Deleted {deleted_count} old chunks for {source_name}")
            
            # Insert new chunks
            objects = []
            for i, c in enumerate(chunks):
                vector = embeddings[i].tolist()
                obj = DocumentChunk(
                    source_name=source_name,
                    source_url=source_url,
                    text=c.get("text", ""),
                    embedding=vector
                )
                objects.append(obj)
                
            db.add_all(objects)
            logger.info(f"[SYNC] Inserted {len(objects)} new chunks for {source_name}")
            
            # 4. Invalidate Cache
            cache = get_semantic_cache()
            invalidated_count = await cache.invalidate_cache_for_document(source_name)
            
            # Commit the transaction (Atomic Swap)
            await db.commit()
            logger.info(f"✅ [SYNC] Successfully completed zero-downtime sync for {source_name} (Invalidated {invalidated_count} cache entries)")
            return True
            
        except Exception as e:
            await db.rollback()
            logger.warning(f"[ERROR] Sync transaction failed for {source_name}: {e}")
            return False
