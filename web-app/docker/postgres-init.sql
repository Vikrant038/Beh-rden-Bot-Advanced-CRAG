-- web-app Postgres bootstrap (runs as the POSTGRES_USER superuser on first init).
-- Provisions the PoLP roles the app documents in .env.example (GUARDRAILS M1.2).

-- pgvector — pre-created here as the superuser so the migrator role (which runs
-- `prisma migrate deploy`) never needs superuser. Prisma's `CREATE EXTENSION IF
-- NOT EXISTS "vector"` then becomes a no-op.
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── PoLP roles ─────────────────────────────────────────────────────────────
-- DDL role: owns the database, runs Prisma migrations, may create the
-- `migrate dev` shadow database.
CREATE ROLE behoerden_migrator WITH LOGIN PASSWORD 'behoerden_password' CREATEDB;
-- DML-only role: the app runtime user. No DDL, no ownership.
CREATE ROLE behoerden_app WITH LOGIN PASSWORD 'behoerden_password' NOCREATEDB NOCREATEROLE;

-- Migrator owns the DB (and therefore the `public` schema under PG 15+).
ALTER DATABASE behoerden_bot OWNER TO behoerden_migrator;
GRANT CREATE ON DATABASE behoerden_bot TO behoerden_migrator;

-- App role: schema access + DML on existing and future tables.
GRANT USAGE ON SCHEMA public TO behoerden_app;

-- Future tables/sequences created by the migrator auto-grant DML to the app.
ALTER DEFAULT PRIVILEGES FOR ROLE behoerden_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO behoerden_app;
ALTER DEFAULT PRIVILEGES FOR ROLE behoerden_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO behoerden_app;
