# Behörden-Bot — GitHub Repository Metadata & Tech Inventory

> **Purpose:** Reference metadata, badges, topics, and complete inventory of all libraries, tools, models, and architectures used in this repository.

---

## 📌 GitHub Repository "About" Section

### Description (Max 350 chars)
> Enterprise Corrective RAG (CRAG) AI assistant for German immigration, student visas, APS, and blocked accounts. Built with Next.js 15, React 19, TypeScript 5, tRPC 11, Prisma, pgvector HNSW, Groq LLM, Cloudinary scroll-cinematic streaming, and BGE-M3 embeddings. Zero-hallucination, fail-closed guardrails, and bilingual (EN/DE).

### Website
> `https://behoerden-bot.vercel.app` (or custom production domain)

---

## 🏷️ GitHub Repository Topics (Tags)

Copy and paste these tags into the repository settings (`About` ⚙️ $\to$ `Topics`):

```text
corrective-rag, crag, agentic-rag, nextjs15, react19, typescript, trpc, prisma, pgvector, groq, bge-m3, embeddings, reranking, german-immigration, student-visa, aps-certificate, tailwindcss, vitest, playwright, cloudinary
```

---

## 🛡️ Repository Badges (Markdown for README Header)

```markdown
[![CI Web App](https://github.com/anomalyco/behoerden-bot/actions/workflows/ci-web-app.yml/badge.svg)](https://github.com/anomalyco/behoerden-bot/actions/workflows/ci-web-app.yml)
[![E2E Tests](https://github.com/anomalyco/behoerden-bot/actions/workflows/e2e-web-app.yml/badge.svg)](https://github.com/anomalyco/behoerden-bot/actions/workflows/e2e-web-app.yml)
[![Security Scan](https://github.com/anomalyco/behoerden-bot/actions/workflows/security-web-app.yml/badge.svg)](https://github.com/anomalyco/behoerden-bot/actions/workflows/security-web-app.yml)
[![Coverage Gate](https://img.shields.io/badge/Coverage-≥85%25-brightgreen.svg)](docs/TESTING_AND_QUALITY.md)
[![Tests](https://img.shields.io/badge/Tests-898%20passing-success.svg)](web-app/tests)
[![Next.js](https://img.shields.io/badge/Next.js-15.5-black.svg?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0-61dafb.svg?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8.svg?logo=tailwindcss)](https://tailwindcss.com/)
[![pgvector](https://img.shields.io/badge/PostgreSQL-pgvector-336791.svg?logo=postgresql)](https://github.com/pgvector/pgvector)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
```

---

## 🧰 Complete Technology Inventory ("What We Have Used")

### 1. Frontend & User Interface
| Component | Technology / Library | Purpose in Project |
|---|---|---|
| **Core Framework** | Next.js 15 (App Router) | Server Components, Route Handlers, Streaming SSR, Turbopack builds |
| **UI Library** | React 19 | Concurrent rendering, Action transitions, modern hooks |
| **Language** | TypeScript 5 | End-to-end static typing across UI, API, and RAG stages |
| **Styling** | Tailwind CSS v4 | CSS theme variables, `@theme` token system, utility-first layout |
| **Design Tokens** | Custom Theme Palette | Warm Diorama Porcelain (`#fbf9f5`) & Velvet Obsidian (`#0f0d13`) |
| **Typography** | `@fontsource-variable/source-sans-3`, `source-serif-4`, `jetbrains-mono` | Professional typography hierarchy |
| **Icons** | `lucide-react` | Semantic UI icons and status indicators |
| **Charts** | `recharts` | Admin analytics dashboards (sparklines, daily query distributions) |
| **UI Primitives** | Custom headless components | Accessible modals, tabs, dialogs, command palettes, toast system |
| **Theme Management** | `next-themes` | Seamless light/dark mode toggling with zero flash |

### 2. Media, Animation & Scroll Cinematic Engine
| Component | Technology / Library | Purpose in Project |
|---|---|---|
| **Scroll Engine** | Custom RAF-driven Scrub Loop (`scroll-engine.ts`) | Smooth interpolated video frame scrubbing synchronized with page scroll |
| **Interactive Hero** | `ScrollWorld` (`scroll-world.tsx`) | 4-scene continuous camera flight through the journey to Germany |
| **Media Delivery** | Cloudinary CDN | High-definition still posters and transition video clips |
| **Mobile Streaming** | Dynamic Cloudinary Transformations (`f_auto,q_auto:eco,w_720,vc_h264`) | 720p lightweight H.264 profile reducing decoder memory by ~65% on phones |
| **Streaming Protocol**| HTTP 206 Partial Content (Range Requests) | Sub-300ms video playback without heavy blob buffering |
| **Motion & Micro-interactions** | `framer-motion` | Page transitions, accordion reveals, shimmer effects |
| **Accessibility Motion** | `prefers-reduced-motion` | Automatic static 2×2 grid fallback for motion-sensitive users |

### 3. AI, LLM & Corrective RAG (CRAG) Pipeline
| Component | Technology / Model | Purpose in Project |
|---|---|---|
| **Primary LLM** | Groq (`openai/gpt-oss-120b`) | High-throughput (~500 tok/s), low-latency reasoning and synthesis |
| **LLM Fallback** | Hugging Face Inference API / Gemini | Automatic circuit breaker failover for high availability |
| **Multi-Agent Orchestrator** | 3-Agent ReAct Pipeline (TypeScript) | **Research Agent** (tool calling) $\to$ **Analyst Agent** (5-D matrix) $\to$ **Writer Agent** (synthesis) |
| **Bilingual Query Expansion** | LLM Expansion Stage | Normalizes English & German queries into canonical search tuples |
| **Guardrails (Fail-Closed)** | Deterministic Negative Cache + LLM Filter | Instant refusal of out-of-domain traps and fraudulent requests (2/2 traps) |
| **Confidence Gate** | CRAG Confidence Scorer | Scores retrieved context quality; routes to grounded answer vs fallback |
| **Web Search Fallback** | `duck-duck-scrape` / DDGS | Live web retrieval when internal corpus confidence falls below threshold |
| **Streaming Output** | Server-Sent Events (SSE) | Real-time token streaming to chat bubbles |

### 4. Retrieval, Embeddings & Vector Search
| Component | Technology / Model | Purpose in Project |
|---|---|---|
| **Multilingual Embeddings**| `BAAI/bge-m3` (1024-dimensional) | Unified representation handling German compound words and English |
| **Embeddings Hosting** | Cloudflare Workers AI (`@cf/baai/bge-m3`) | Serverless, zero-maintenance, low-latency embedding generation |
| **Dense Vector Search** | PostgreSQL with `pgvector` HNSW indexes | Sub-millisecond approximate nearest neighbor (ANN) cosine similarity |
| **Sparse Lexical Search** | PostgreSQL Full-Text Search (tsvector/tsquery) + BM25 | Exact keyword, entity, and legal paragraph matching |
| **Rank Fusion** | Reciprocal Rank Fusion (RRF, $k=60$) | Mathematically merges dense semantic and sparse lexical rankings |
| **Cross-Encoder Reranking** | `BAAI/bge-reranker-base` / `bge-reranker-v2-m3` | Cross-attention scoring of top candidates for precision filtering |
| **Semantic Cache** | Dual-Keyed pgvector Store (Cosine $\ge 0.97$, 7-Day TTL) | Exact-hash and semantic similarity cache skipping full pipeline on hit |

### 5. Backend, API & Data Layer
| Component | Technology / Library | Purpose in Project |
|---|---|---|
| **API Layer** | tRPC v11 | End-to-end type-safe RPC procedures replacing REST/GraphQL |
| **Validation** | `zod` | Strict runtime input/output validation for all endpoints and tools |
| **Database ORM** | Prisma 6 | Type-safe queries, relational migrations, connection pooling |
| **Database Engine** | PostgreSQL 16 (Neon / Local Docker) | Relational storage, vector indexing, full-text indexes |
| **Security Roles (PoLP)**| `behoerden_migrator` (DDL) vs `behoerden_app` (DML) | Principle of Least Privilege database access |
| **Authentication** | Auth.js v5 (NextAuth) | GitHub OAuth, Google OAuth, Email magic link, and anonymous guest sessions |
| **Document Ingestion** | `pdf-parse`, `cheerio` | In-memory PDF parsing, SSRF-validated URL scraping, parent/child chunking |

### 6. Security, Compliance & Observability
| Component | Technology / Tool | Purpose in Project |
|---|---|---|
| **PII Masking (GDPR)** | Regex + Entity Masker | Masks names, passport numbers, IBANs, and emails before LLM requests |
| **Static Security Scanning**| Semgrep + CodeQL + Gitleaks | Automated AST analysis, secret leak prevention, raw-HTML XSS defense |
| **Content Security Policy**| Dynamic CSP Nonce Architecture | Inline script protection and strict resource domain whitelisting |
| **Observability & Tracing**| Langfuse | Full-pipeline execution tracing, latency breakdown, token costs |
| **Structured Logging** | `pino` | High-performance JSON logging with correlation IDs |

### 7. Quality Assurance & Testing
| Component | Technology / Tool | Metrics & Status |
|---|---|---|
| **Unit & Integration Suite**| Vitest | **898 tests across 83 test files** passing |
| **Coverage Floor Gate** | `@vitest/coverage-v8` | **$\ge 85.0\%$ enforced across Statements, Branches, Functions, Lines** |
| **End-to-End Testing** | Playwright (Desktop & Mobile) | 7 specs (54 tests) validating full chat, auth, and admin flows |
| **CRAG Evaluation** | 30-Question Multilingual Harness | Faithfulness 3.98/5.0, Relevance 4.83/5.0, Precision 100%, Traps 2/2 |
| **Continuous Integration**| GitHub Actions (`.github/workflows/`) | Automated formatting, linting, typechecking, coverage, and security gates |

---
