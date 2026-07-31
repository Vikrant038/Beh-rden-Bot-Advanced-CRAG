from src.database import engine, SessionLocal
from sqlalchemy import text

with engine.connect() as conn:
    try:
        conn.execute(text("ALTER TABLE semantic_cache ADD COLUMN parent_doc_ids JSON DEFAULT '[]';"))
        conn.commit()
        print("Successfully added parent_doc_ids column")
    except Exception as e:
        print("Error:", e)
