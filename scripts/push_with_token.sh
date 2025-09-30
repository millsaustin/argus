#!/usr/bin/env bash

set -euo pipefail

REPO_URL="https://github.com/millsaustin/argus.git"
TOKEN_FILE="${TOKEN_FILE:-.github_token}"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Token file '$TOKEN_FILE' not found. Add your GitHub token there." >&2
  exit 1
fi

# Trim whitespace so stray newlines do not break auth.
TOKEN="$(tr -d '\r\n ' <"$TOKEN_FILE")"

if [[ -z "$TOKEN" ]]; then
  echo "Token file '$TOKEN_FILE' is empty." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASKPASS_HELPER="$SCRIPT_DIR/git_token_askpass.sh"

if [[ ! -x "$ASKPASS_HELPER" ]]; then
  echo "Askpass helper '$ASKPASS_HELPER' is not executable." >&2
  exit 1
fi

GITHUB_TOKEN="$TOKEN" GIT_ASKPASS="$ASKPASS_HELPER" git push "$REPO_URL" main
