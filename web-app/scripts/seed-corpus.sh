#!/usr/bin/env bash
#
# seed-corpus.sh — one-time corpus transfer: local docker Postgres → Neon.
#
# Why: the vector corpus (documents + parent chunks + child chunks with
# 1024-dim bge-m3 embeddings) is the expensive thing to produce. Production never
# needs to re-embed it: embed once locally (or wherever quota allows), then
# ship the vectors with this script. Auth, sessions, conversations, messages
# and ingest_jobs are intentionally NOT transferred — prod keeps its own.
#
# Prereqs:
#   * Local postgres container running (docker compose up -d postgres)
#   * Migrations already applied on the target (prisma migrate deploy)
#   * NEON_DATABASE_URL exported (never echoed; passwords redacted)
#
# Usage:
#   NEON_DATABASE_URL="postgresql://behoerden_app:...@ep-xxx-pooler.eu-central-1.aws.neon.tech/behoerden_bot?sslmode=require" \
#     ./scripts/seed-corpus.sh [--replace] [--include-cache]
#
#   --replace         wipe the corpus tables on the target first (DELETE then
#                     load). Without it the script aborts if the target already
#                     has corpus rows, so a misdirected run can't clobber data.
#   --include-cache   also transfer semantic_cache rows (optional — it is a
#                     cache; prod will repopulate it naturally).
set -euo pipefail

if [[ -z "${NEON_DATABASE_URL:-}" ]]; then
  echo "ERROR: NEON_DATABASE_URL is required (set it in the env; it is never echoed)" >&2
  exit 2
fi

REPLACE=0
INCLUDE_CACHE=0
for arg in "$@"; do
  case "$arg" in
    --replace) REPLACE=1 ;;
    --include-cache) INCLUDE_CACHE=1 ;;
    *) echo "unknown arg: $arg (expected --replace | --include-cache)" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# --- local source (docker postgres) -------------------------------------------
CID="$(docker compose ps -q postgres 2>/dev/null || true)"
if [[ -z "$CID" ]]; then
  echo "ERROR: local postgres container not running (start: docker compose up -d postgres)" >&2
  exit 1
fi
LOCAL_USER="${LOCAL_USER:-behoerden_app}"
LOCAL_DB="${LOCAL_DB:-behoerden_bot}"

# --- redact connection strings in any error output -----------------------------
redact() { sed -E 's#(//[^:/]+:)[^@]+@#\1***@#g'; }

# psql against the Neon target through the container's client (never echoes URL)
psql_target() { docker exec -i "$CID" psql "$NEON_DATABASE_URL" -v ON_ERROR_STOP=1 "$@" 2> >(redact >&2); }

dump_table() { # $1 = table name; appends a data-only dump to $DUMP
  docker exec "$CID" pg_dump -U "$LOCAL_USER" -d "$LOCAL_DB" \
    --data-only --no-owner --no-privileges -t "$1" >> "$DUMP"
}

DUMP="$(mktemp /tmp/corpus-dump.XXXXXX.sql)"
trap 'rm -f "$DUMP"' EXIT

echo "=== 1/6 dumping corpus from local docker Postgres (${LOCAL_USER}@${LOCAL_DB}) ==="
# Three pg_dump invocations in FK dependency order: documents → parents → children.
: > "$DUMP"
dump_table "documents"
dump_table "document_parent_chunks"
dump_table "document_chunks"
if [[ "$INCLUDE_CACHE" == "1" ]]; then
  dump_table "semantic_cache"
fi
if ! grep -q '^COPY ' "$DUMP"; then
  echo "ERROR: dump is empty — is the local corpus populated?" >&2
  exit 1
fi
echo "dumped $(grep -c '^COPY ' "$DUMP") table(s)"

echo "=== 2/6 checking target schema ==="
if ! psql_target -t -A -c "SELECT to_regclass('public.documents') IS NOT NULL;" | grep -q 't'; then
  echo "ERROR: target has no 'documents' table — run 'prisma migrate deploy' against the target first" >&2
  exit 1
fi

count_target() { psql_target -t -A -c "SELECT count(*) FROM $1;"; }
LOCAL_DOCS="$(docker exec "$CID" psql -U "$LOCAL_USER" -d "$LOCAL_DB" -t -A -c 'SELECT count(*) FROM documents;')"
TARGET_DOCS="$(count_target documents)"
echo "target currently has $TARGET_DOCS document(s); local has $LOCAL_DOCS"

if [[ "$TARGET_DOCS" != "0" ]] && [[ "$REPLACE" != "1" ]]; then
  echo "ERROR: target already has corpus rows and --replace was not given." >&2
  echo "       Re-run with --replace to wipe and reseed the corpus tables (DELETE then load)." >&2
  exit 1
fi

if [[ "$REPLACE" == "1" ]] && [[ "$TARGET_DOCS" != "0" ]]; then
  echo "=== 3/6 wiping target corpus tables (DELETE, children → parents → documents) ==="
  psql_target -c "DELETE FROM document_chunks; DELETE FROM document_parent_chunks; DELETE FROM documents;"
  if [[ "$INCLUDE_CACHE" == "1" ]]; then
    psql_target -c "DELETE FROM semantic_cache;"
  fi
fi

echo "=== 4/6 loading dump into target ==="
docker exec -i "$CID" psql "$NEON_DATABASE_URL" -v ON_ERROR_STOP=1 < "$DUMP" 2> >(redact >&2)
if [[ "$INCLUDE_CACHE" == "1" ]]; then
  # semantic_cache.id is an Int autoincrement; bump the sequence past restored rows.
  psql_target -c "SELECT setval('semantic_cache_id_seq', (SELECT COALESCE(max(id), 1) FROM semantic_cache));" > /dev/null
fi

echo "=== 5/6 ensuring Postgres FTS GIN index on target ==="
# Sparse retrieval runs inside Postgres (vectorQueries.sparseSearch) via the
# document_chunks_text_fts_idx GIN index from migration 20260806000001. The dump
# above is data-only, so the index must exist on the target for the FTS path to
# work after a fresh seed. Guard with pg_indexes inside a DO block instead of
# plain CREATE INDEX IF NOT EXISTS — Postgres checks table ownership *before*
# the existence short-circuit, which errors when the target role is not the
# table owner even though the index is already there.
psql_target -c "DO \$\$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'document_chunks'
      AND indexname = 'document_chunks_text_fts_idx'
  ) THEN
    CREATE INDEX document_chunks_text_fts_idx
      ON document_chunks USING GIN (to_tsvector('simple', text));
  END IF;
END
\$\$" > /dev/null
echo "document_chunks_text_fts_idx present (FTS sparse path intact)"

echo "=== 6/6 verifying counts (local → target) ==="
ok=1
for t in documents document_parent_chunks document_chunks semantic_cache; do
  [[ "$INCLUDE_CACHE" != "1" && "$t" == "semantic_cache" ]] && continue
  l="$(docker exec "$CID" psql -U "$LOCAL_USER" -d "$LOCAL_DB" -t -A -c "SELECT count(*) FROM $t;")"
  r="$(count_target "$t")"
  status="OK"; [[ "$l" != "$r" ]] && { status="MISMATCH"; ok=0; }
  printf "%-24s %s -> %s  %s\n" "$t" "$l" "$r" "$status"
done
[[ "$ok" == "1" ]] || { echo "ERROR: count mismatch — target NOT fully seeded" >&2; exit 1; }
echo "Done. Corpus seeded to Neon; no re-embedding was needed."
