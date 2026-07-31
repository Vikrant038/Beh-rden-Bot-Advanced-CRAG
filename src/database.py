"""
PostgreSQL + pgvector Database Models & Connection Pool Engine
Complies with AGENTS.md §2 & Environment Matrix, and CODING_STANDARDS.md.
"""

import os
import json
from datetime import datetime, timezone
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import Column, Integer, String, Text, DateTime, JSON, text
from sqlalchemy.orm import declarative_base
from pgvector.sqlalchemy import Vector
from dotenv import load_dotenv

from src.logging_config import logger

load_dotenv()

# Read DATABASE_URL or construct from individual POSTGRES_* environment variables
DEFAULT_DB_USER = os.environ.get("POSTGRES_USER", "behoerden_user")
DEFAULT_DB_PASS = os.environ.get("POSTGRES_PASSWORD", "behoerden_password")
DEFAULT_DB_HOST = os.environ.get("POSTGRES_HOST", "localhost")
DEFAULT_DB_PORT = os.environ.get("POSTGRES_PORT", "5432")
DEFAULT_DB_NAME = os.environ.get("POSTGRES_DB", "behoerden_bot")

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    f"postgresql+asyncpg://{DEFAULT_DB_USER}:{DEFAULT_DB_PASS}@{DEFAULT_DB_HOST}:{DEFAULT_DB_PORT}/{DEFAULT_DB_NAME}"
)

# Convert legacy synchronous postgresql:// prefix to asyncpg scheme
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

engine = create_async_engine(
    DATABASE_URL, 
    echo=False,
    pool_size=20,
    max_overflow=10
)
SessionLocal = async_sessionmaker(autocommit=False, autoflush=False, bind=engine, class_=AsyncSession)
Base = declarative_base()


class DocumentChunk(Base):
    """PostgreSQL table storing document text chunks and 768d vector embeddings."""
    __tablename__ = "document_chunks"
    id = Column(Integer, primary_key=True, index=True)
    source_name = Column(String, index=True)
    source_url = Column(String)
    text = Column(Text)
    embedding = Column(Vector(768))


class SemanticCacheEntry(Base):
    """PostgreSQL table storing multi-tier semantic cache entries."""
    __tablename__ = "semantic_cache"
    id = Column(Integer, primary_key=True, index=True)
    query_hash = Column(String, unique=True, index=True)
    query_text = Column(Text)
    query_vector = Column(Vector(768))
    response_json = Column(JSON)
    parent_doc_ids = Column(JSON, default=list)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class SessionMemoryState(Base):
    """PostgreSQL table storing user session memory and conversation turns."""
    __tablename__ = "session_memory"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, unique=True, index=True)
    history_json = Column(JSON, default=list)
    summary_text = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))


async def init_db():
    """Initializes PostgreSQL schema and enables pgvector extension."""
    logger.info("Initializing PostgreSQL Database...")
    try:
        async with engine.begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    except Exception as e:
        logger.warning(f"[WARN] Could not create vector extension (might already exist): {e}")
        
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("PostgreSQL Database tables created successfully.")


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency provider yielding async DB session."""
    async with SessionLocal() as db:
        try:
            yield db
        finally:
            await db.close()
