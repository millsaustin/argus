#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  local exit_code=$?
  trap - SIGINT SIGTERM EXIT
  set +e
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null
    wait "$BACKEND_PID" 2>/dev/null
  fi
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null
    wait "$FRONTEND_PID" 2>/dev/null
  fi
  exit "$exit_code"
}

trap cleanup SIGINT SIGTERM EXIT

echo "Starting Argus backend on http://localhost:3001 (mock mode)"
(
  cd "$ROOT_DIR/backend"
  PROXMOX_MOCK_MODE="${PROXMOX_MOCK_MODE:-true}" \
  PROXMOX_MOCK_LATENCY_MS="${PROXMOX_MOCK_LATENCY_MS:-0}" \
  npm run dev
) &
BACKEND_PID=$!

echo "Starting Argus frontend on http://localhost:${ARGUS_FRONTEND_PORT:-3000}"
(
  cd "$ROOT_DIR/frontend"
  NEXT_PUBLIC_BACKEND_BASE="${NEXT_PUBLIC_BACKEND_BASE:-http://localhost:3001}" \
  NEXT_PUBLIC_API_BASE="${NEXT_PUBLIC_API_BASE:-http://localhost:3001/api/proxmox}" \
  npm run dev -- --port "${ARGUS_FRONTEND_PORT:-3000}"
) &
FRONTEND_PID=$!

wait "$BACKEND_PID"
wait "$FRONTEND_PID"
