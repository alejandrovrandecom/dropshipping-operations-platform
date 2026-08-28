#!/usr/bin/env bash
# Start the local Supabase stack for development.
# Local only: this script never links or touches a hosted project.
set -euo pipefail

cd "$(dirname "$0")/.."
SUPABASE_CLI=${SUPABASE_CLI:-"npx --yes supabase"}

if ! command -v docker >/dev/null 2>&1 && ! command -v podman >/dev/null 2>&1; then
  echo "BLOCKED: a container runtime (Docker or Podman) is required." >&2
  echo "Install one, start it, then rerun: pnpm db:setup" >&2
  exit 2
fi

echo "==> Starting local Supabase stack"
$SUPABASE_CLI start

echo "==> Applying migrations to a clean database"
$SUPABASE_CLI db reset

cat <<'EOF'
Next: cp .env.example .env.local, copy the anon key from `npx supabase status`,
then run `pnpm db:smoke`. Never put the service_role key in a NEXT_PUBLIC_* var.
EOF
