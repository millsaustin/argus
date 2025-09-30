#!/usr/bin/env bash

# Small askpass helper that returns GitHub username or token based on prompt text.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  exit 1
fi

prompt="$1"

if [[ "$prompt" == *"Username"* || "$prompt" == *"username"* ]]; then
  echo "millsaustin"
  exit 0
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  exit 1
fi

echo "$GITHUB_TOKEN"
