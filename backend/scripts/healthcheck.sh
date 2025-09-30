#!/bin/sh
set -eu

URL="${HEALTHCHECK_URL:-http://backend:3001/api/health}"

curl -fsS "$URL" >/dev/null
