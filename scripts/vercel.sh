#!/bin/bash
# Run any Vercel command for Kestrel with the private token from .vercel-token (never printed).
# Example: bash scripts/vercel.sh domains ls
set -euo pipefail
cd "$(dirname "$0")/.."
VERCEL_TOKEN="$(tr -d '[:space:]' < .vercel-token 2>/dev/null || true)"
[ -n "$VERCEL_TOKEN" ] || { echo "The file .vercel-token is empty."; exit 1; }
export VERCEL_TOKEN
exec npx --yes vercel@65.4.0 "$@"
