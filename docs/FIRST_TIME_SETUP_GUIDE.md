# 🚀 First-Time Setup & Execution Guide: Behörden Bot (Repo-2)

This document provides complete, step-by-step instructions to set up, initialize, ingest data, verify, run, clear caches, and reset the enterprise 3-Agent ReAct RAG application from scratch.

---

## 📋 Prerequisites

- **OS:** macOS / Linux / Windows WSL2
- **Python:** Python 3.11+ (Python 3.14 supported)
- **Docker & Docker Compose:** Required for PostgreSQL + `pgvector`
- **API Keys:**
  - `GROQ_API_KEY`: Required (Free tier at [Groq Console](https://console.groq.com/))
  - `HF_TOKEN`: Required (Hugging Face Access Token for BGE models)
  - `LANGFUSE_PUBLIC_KEY` & `LANGFUSE_SECRET_KEY`: Optional (For APM tracing)

---

## 🛠️ Step 1: Environment Setup

Clone/navigate to the repository root directory and create the Python virtual environment:

```bash
# Navigate to project root
cd "/Users/vikranty/Documents/Project/OLD Lap Work/Repo-2"

# Create Python 3.11+ virtual environment
python3 -m venv .venv

# Activate virtual environment
source .venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Install minimal production & evaluation dependencies
pip install -r requirements.txt
```

---

## 🔐 Step 2: Environment Variables Configuration

Copy `.env.example` to create your local `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and fill in your environment variables:

```env
# Required API Keys
GROQ_API_KEY=your_groq_api_key_here
HF_TOKEN=your_huggingface_token_here

# PostgreSQL + pgvector Connection URL
DATABASE_URL=postgresql://behoerden_user:behoerden_password@localhost:5432/behoerden_bot

# Local Vector & Chunk Storage Paths
DATA_DIR=data
FAISS_INDEX_PATH=data/faiss_index.bin
CHUNKS_META_PATH=data/chunks_meta.jsonl

# Optional Tracing (Langfuse)
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=https://cloud.langfuse.com
```

> [!CAUTION]
> **Security Rule:** Never commit the `.env` file to Git. It is listed in `.gitignore`.

---

## 🐳 Step 3: Start Database Infrastructure

Start PostgreSQL with the `pgvector` extension via Docker Compose:

```bash
# Start PostgreSQL container in background
docker-compose up -d postgres

# Verify container is running on port 5432
docker-compose ps
```

---

## 🧹 Step 3B: Clear Semantic Cache & Reset Database (Maintenance)

Whenever you want to purge cached answers or reset the database completely:

```bash
# 1. Clear Semantic Cache entries (forces live pipeline evaluation)
python -c "from src.semantic_cache import SemanticCache; SemanticCache().clear()"

# 2. Complete Database Reset (drops volume & restarts fresh container)
docker-compose down -v && docker-compose up -d postgres
```

---

## 📥 Step 4: Document Ingestion Pipeline

Process raw German visa / university documents into structured text chunks:

```bash
# Run ingestion pipeline (Parses raw PDFs/sources into data/chunks.jsonl)
python src/ingest.py
```

*Output:* Standardized chunk file at `data/chunks.jsonl`.

---

## ⚡ Step 5: Embeddings Generation & Vector Indexing

Generate 768-dimensional BGE embeddings and build the FAISS index:

```bash
# Generate FAISS dense vector index and chunk metadata
python src/embed.py
```

*Output:* `data/faiss_index.bin` and `data/chunks_meta.jsonl`.

---

## 🔄 Step 6: PostgreSQL Database Migration

Sync vector chunks and metadata to PostgreSQL + `pgvector`:

```bash
# Migrate document metadata and vectors to PostgreSQL
python src/migrate_to_postgres.py
```

---

## 🧪 Step 7: Run Quality Gates & Tests (`bypass_cache=True`)

Verify the installation and pipeline quality before launching user interfaces. Always enforce `bypass_cache=True` during test and evaluation runs to ensure live retrieval accuracy:

```bash
# 1. Run Unit and Integration Tests (with bypass_cache=True)
python -m pytest tests/ -v

# 2. Run CI RAGAS Quality Gate (Faithfulness >= 3.5, Relevance >= 4.0)
python -m tests.eval_ragas
```

---

## 🌐 Step 8: Launch the Application Services

You can run the backend API server and Streamlit frontend UI:

### Option A: Run Streamlit Frontend (Main Interface)

```bash
# Launch Streamlit Multi-Page Web App
streamlit run app.py --server.port 8501
```
Open **http://localhost:8501** in your browser.

### Option B: Run FastAPI REST Service

```bash
# Launch FastAPI server with auto-reload
python -m uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```
API Documentation will be available at **http://localhost:8000/docs**.

---

## 📊 Step 9: Run Comparative Benchmark (`bypass_cache=True`)

Compare Baseline Single-Agent RAG against Advanced 3-Agent CRAG with cache bypassing enabled (`bypass_cache=True`):

```bash
python src/run_comparative_benchmark.py
```

---

## 🔍 Verification Checklist

| Step | Command | Expected Result |
|------|---------|-----------------|
| Postgres | `docker-compose ps` | State `Up` on port `5432` |
| Clear Cache | `python -c "from src.semantic_cache import SemanticCache; SemanticCache().clear()"` | Cache entries cleared |
| Ingestion | `ls -la data/chunks.jsonl` | File exists with processed text |
| Vector Index | `ls -la data/faiss_index.bin` | Vector index created |
| Unit Tests | `python -m pytest tests/ -v` | All tests `PASSED` |
| UI Interface | `streamlit run app.py` | App loads at `http://localhost:8501` |
