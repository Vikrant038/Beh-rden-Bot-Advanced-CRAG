# Postgres / Docker Setup — Python App vs Web-App

The repo ships **two** docker-compose files, each owning a Postgres instance with
**identical credentials and the same host port (5432)**. This note explains why
that is intentional, why the Python app stays on the legacy compose, and how to
keep the two from fighting each other.

| | Root `docker-compose.yml` | `web-app/docker-compose.yml` |
|---|---|---|
| **Owner** | Python pipeline (Streamlit + RAG research/benchmark) | Web-app (Next.js + Prisma, the shipped product) |
| **Image** | `ankane/pgvector:v0.5.1` (legacy pin) | `pgvector/pgvector:pg16` (upstream, PG 16) |
| **User / pass / DB** | `behoerden_user` / `behoerden_password` / `behoerden_bot` | same — deliberately identical |
| **Host port** | `5432` | `5432` ⚠️ same port |
| **Role model** | single `behoerden_user` (the image's `POSTGRES_USER` → **superuser**) | PoLP: `behoerden_migrator` (DDL) + `behoerden_app` (DML), via `docker/postgres-init.sql` |
| **Schema manager** | SQLAlchemy (`Base.metadata.create_all`) | Prisma (`prisma migrate deploy`) |
| **Extras** | — | healthcheck, read-only init mount |
| **Data volume** | compose-scoped (`pgdata`, project-prefixed) | compose-scoped (`pgdata`, project-prefixed) — **separate from root** |

---

## Why the Python app stays on the root (ankane) compose

1. **It is the documented, tested workflow.** `AGENTS.md` quickstart and the root
   README both say `docker-compose up -d postgres` for the Python pipeline. It is
   the single source of truth for the research/benchmark side — not broken, so we
   don't touch it.

2. **The Python app needs superuser DDL.** `src/database.py` runs
   `CREATE EXTENSION IF NOT EXISTS vector` and `Base.metadata.create_all` at
   startup, connecting as `behoerden_user`. In the root compose that role is the
   image's `POSTGRES_USER` — a superuser — so extension creation and table
   creation "just work". The web-app compose deliberately gives `behoerden_user`
   **no such privilege** (it owns nothing; `behoerden_migrator`/`behoerden_app`
   are the actors).

3. **Two schema managers must never share one database.** SQLAlchemy creates
   tables outside Prisma's `_prisma_migrations` ledger. If the Python app wrote
   into the web-app DB, `behoerden_app` would have no grants on those tables
   (default privileges only cover tables the migrator creates) and `prisma
   migrate diff` would report phantom drift. Conversely, pointing the web-app at
   the Python DB fails Prisma's schema-ownership expectations. Separate
   databases, full stop.

4. **Postgres is storage-only for the Python side.** Its real vector index is a
   local FAISS file; Postgres holds chunks + pgvector for CRAG. There is no
   benefit to migrating it to the pg16 image, and doing so would orphan the
   documented `migrate.py` / `migrate_to_postgres.py` workflow.

---

## How the two composes are kept from conflicting

**Rule 1 — one Postgres at a time.** Both bind host port `5432`; they cannot run
simultaneously. Run whichever your current work needs:

```bash
# Python/Streamlit work (root):
docker compose up -d postgres          # or: docker-compose up -d postgres
docker compose down

# Web-app work:
cd web-app && docker compose up -d postgres
cd web-app && docker compose down
```

**Rule 2 — the volumes never mix.** Each compose prefixes its volume with its
project (directory) name, so the root `pgdata` and the web-app `pgdata` are two
distinct named volumes. Resetting one does not touch the other:

```bash
# Wipe ONLY the web-app DB (keeps Python DB intact):
cd web-app && docker compose down -v

# Wipe ONLY the Python DB (keeps web-app DB intact):
docker compose down -v
```

**Rule 3 — never cross-wire the connection strings.** `DATABASE_URL` in the
Python `.env` must always point at the database the *root* compose created, and
`web-app/.env` at the one *web-app/docker-compose.yml* created. They happen to
share host/port/credentials, so the risk is silent — the only difference is
which volume backs `5432`. When in doubt, check which compose is up:

```bash
docker ps --format '{{.Names}} {{.Image}}' | grep -i postgres
# image ankane/pgvector  → Python DB
# image pgvector/pgvector:pg16 → web-app DB
```

**Rule 4 — if you genuinely need both at once** (rare; e.g. web-app dev while the
Python pipeline runs), remap one of them to a second port *and* update the other
side's URL to match — e.g. publish the web-app DB on `5433`:

```bash
cd web-app && docker compose up -d postgres   # then change web-app/.env port to 5433
```

This is the one case where the identical credentials make it easy to point the
wrong app at the wrong DB, so verify with Rule 3 afterwards.

---

## Schema-ownership cheat-sheet

| Who | Role it connects as | Privileges it needs | Owns schema via |
|---|---|---|---|
| Python `database.py` | `behoerden_user` (root compose superuser) | `CREATE EXTENSION`, `CREATE TABLE` | SQLAlchemy `create_all` |
| Prisma migrations | `behoerden_migrator` (web-app compose) | DDL, `CREATEDB` (shadow DB) | Prisma `_prisma_migrations` |
| Web-app runtime | `behoerden_app` (web-app compose) | DML + `<=>` vector ops only | — (grants from migrator's default privileges) |

---

## Related reading

- `web-app/docker-compose.yml` header — the web-app-side warning about the port conflict
- `web-app/docker/postgres-init.sql` — PoLP role bootstrap for the web-app DB
- `web-app/prisma/migrations/MIGRATION_POLICY.md` — migration rules for the web-app DB
- `AGENTS.md` → *Docker & Infrastructure* / *Database Schema* — Python-side ground truth
