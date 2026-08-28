#!/usr/bin/env bash
# Rebuild the local database from scratch using only version-controlled
# migrations. Destroys local data; never runs against a hosted project.
set -euo pipefail

cd "$(dirname "$0")/.."
SUPABASE_CLI=${SUPABASE_CLI:-"npx --yes supabase"}

if ! command -v docker >/dev/null 2>&1 && ! command -v podman >/dev/null 2>&1; then
  echo "BLOCKED: a container runtime (Docker or Podman) is required." >&2
  exit 2
fi

echo "==> Rebuilding local database from supabase/migrations"
$SUPABASE_CLI db reset

echo "==> Applied migrations"
$SUPABASE_CLI migration list --local
