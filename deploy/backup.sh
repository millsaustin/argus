#!/usr/bin/env bash
#
# Simple backup helper for Argus data stores.
#
# Usage: deploy/backup.sh
# Schedule via cron (example):
#   30 2 * * * /path/to/repo/deploy/backup.sh >> /var/log/argus-backup.log 2>&1
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${ROOT_DIR}/backup"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "${BACKUP_DIR}"

# Export Postgres database (requires pg_dump and valid auth env vars)
if command -v pg_dump >/dev/null 2>&1; then
  echo "[backup] Dumping Postgres database to ${BACKUP_DIR}/argus-${TIMESTAMP}.sql"
  pg_dump -U argus -d argus > "${BACKUP_DIR}/argus-${TIMESTAMP}.sql"
else
  echo "[backup] pg_dump not found; skipping Postgres dump" >&2
fi

# Archive Redis data directory
REDIS_SOURCE="${ROOT_DIR}/data/redis"
if [ -d "${REDIS_SOURCE}" ]; then
  echo "[backup] Archiving Redis data directory"
  tar -czf "${BACKUP_DIR}/redis-${TIMESTAMP}.tar.gz" -C "${ROOT_DIR}/data" redis
else
  echo "[backup] Redis data directory not found at ${REDIS_SOURCE}; skipping" >&2
fi

echo "[backup] Completed at $(date --iso-8601=seconds 2>/dev/null || date)"
