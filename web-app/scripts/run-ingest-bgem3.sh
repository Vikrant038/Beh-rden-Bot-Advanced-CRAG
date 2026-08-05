#!/usr/bin/env bash
# Full corpus re-ingest with bge-m3 embeddings (1024-dim).
# Logs to /tmp/ingest-bgem3.log so a long run can be monitored/tailed.
set -u
cd "$(dirname "$0")/.." || exit 1
exec > >(tee -a /tmp/ingest-bgem3.log) 2>&1
echo "=== ingest start $(date -u +%FT%TZ) ==="
pnpm ingest --file ../data/sources.json --force
code=$?
echo "=== ingest end $(date -u +%FT%TZ) exit=$code ==="
exit $code
