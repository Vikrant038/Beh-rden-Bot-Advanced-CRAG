"""
Production Summary-Buffer Conversational Memory Engine (PostgreSQL Backed)
Complies with AGENTS.md §1 & §2, and CODING_STANDARDS.md.
- Retains last 8 messages (4 turns) verbatim.
- Rolls older messages (turns 5+) into a background summary using Groq LLM.
- Maintains constant token footprint (~300 tokens) regardless of conversation length.
"""

import time
from typing import List, Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.llm_client import call_llm
from src.database import SessionLocal, SessionMemoryState
from src.logging_config import logger


class SummaryBufferMemory:
    """Summary-Buffer Conversational Memory Engine per session."""

    def __init__(self, session_id: str = "default", max_verbatim_messages: int = 8):
        self.session_id = session_id
        self.max_verbatim = max_verbatim_messages
        self.verbatim_buffer: List[Dict[str, str]] = []
        self.rolling_summary: str = ""
        self._loaded = False

    async def _ensure_loaded(self):
        if self._loaded:
            return
        try:
            async with SessionLocal() as db:
                result = await db.execute(select(SessionMemoryState).filter(SessionMemoryState.session_id == self.session_id))
                state = result.scalar_one_or_none()
                if state:
                    self.verbatim_buffer = state.history_json or []
                    self.rolling_summary = state.summary_text or ""
            self._loaded = True
        except Exception as e:
            logger.warning(f"[WARN] Failed to load memory from DB for session '{self.session_id}': {e}")

    async def _save_to_db(self):
        try:
            async with SessionLocal() as db:
                result = await db.execute(select(SessionMemoryState).filter(SessionMemoryState.session_id == self.session_id))
                state = result.scalar_one_or_none()
                if state:
                    state.history_json = self.verbatim_buffer
                    state.summary_text = self.rolling_summary
                else:
                    state = SessionMemoryState(
                        session_id=self.session_id,
                        history_json=self.verbatim_buffer,
                        summary_text=self.rolling_summary
                    )
                    db.add(state)
                await db.commit()
        except Exception as e:
            logger.warning(f"[WARN] Failed to save memory to DB for session '{self.session_id}': {e}")

    async def add_turn(self, user_query: str, assistant_response: str):
        await self._ensure_loaded()
        self.verbatim_buffer.append({"role": "user", "content": user_query})
        self.verbatim_buffer.append({"role": "assistant", "content": assistant_response})
        
        if len(self.verbatim_buffer) > self.max_verbatim:
            await self._prune_and_summarize()
            
        await self._save_to_db()

    async def _prune_and_summarize(self):
        """Prunes oldest turn (2 messages) and appends key facts to rolling background summary."""
        oldest_user = self.verbatim_buffer.pop(0)
        oldest_assistant = self.verbatim_buffer.pop(0)
        
        prompt = (
            f"You are a conversational summary engine.\n"
            f"Current Background Summary: '{self.rolling_summary}'\n\n"
            f"New messages to integrate:\n"
            f"User: {oldest_user['content']}\n"
            f"Assistant: {oldest_assistant['content'][:200]}\n\n"
            f"Update the background summary into 2-3 bullet points focusing ONLY on key user details (nationality, degree goal, university, visa stage). Keep under 100 words."
        )
        
        try:
            messages = [{"role": "user", "content": prompt}]
            summary_res = await call_llm(messages, max_tokens=150, temperature=0.1)
            self.rolling_summary = summary_res.strip()
            logger.info(f"[MEMORY SUMMARY UPDATED] Current Summary: '{self.rolling_summary[:60]}...'")
        except Exception as e:
            logger.warning(f"[WARN] Failed to update memory summary for session '{self.session_id}': {e}")

    async def get_context_formatted(self) -> str:
        """Returns clean, formatted context string for LLM system prompt."""
        await self._ensure_loaded()
        context_parts = []
        if self.rolling_summary:
            context_parts.append(f"=== ROLLING BACKGROUND SUMMARY ===\n{self.rolling_summary}")
            
        if self.verbatim_buffer:
            context_parts.append("=== RECENT CONVERSATION HISTORY ===")
            for msg in self.verbatim_buffer:
                role = "User" if msg["role"] == "user" else "Assistant"
                context_parts.append(f"{role}: {msg['content']}")
                
        return "\n\n".join(context_parts)

    async def clear(self):
        self.verbatim_buffer = []
        self.rolling_summary = ""
        await self._save_to_db()

_session_memories: Dict[str, SummaryBufferMemory] = {}

def get_session_memory(session_id: str = "default") -> SummaryBufferMemory:
    """Singleton Factory: Returns SummaryBufferMemory instance per session_id."""
    global _session_memories
    if session_id not in _session_memories:
        _session_memories[session_id] = SummaryBufferMemory(session_id=session_id, max_verbatim_messages=8)
    return _session_memories[session_id]
