#!/usr/bin/env bash
# Smoke check for the database foundation.
#
# Static checks always run: required artifacts, secret protection, and config
# validity. The clean-rebuild check runs only when the local stack is
# reachable; otherwise it is reported as SKIPPED, never as passed.
# Use --require-runtime to turn a skipped rebuild into a failure.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
SUPABASE_CLI=${SUPABASE_CLI:-"npx --yes supabase"}
REQUIRE_RUNTIME=0
for arg in "$@"; do [ "$arg" = "--require-runtime" ] && REQUIRE_RUNTIME=1; done

failures=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; failures=$((failures + 1)); }
skip() { echo "SKIP  $1"; }

echo "== Required artifacts =="
for f in .env.example supabase/config.toml supabase/migrations \
  docs/database/architecture.md docs/database/operations.md \
  docs/security/database-security.md; do
  if [ -e "$f" ]; then pass "$f exists"; else fail "$f is missing"; fi
done

echo "== Secret protection =="
for f in .env .env.local supabase/.env; do
  if git check-ignore -q "$f"; then pass "$f is git-ignored"; else fail "$f is not git-ignored"; fi
done
if git check-ignore -q .env.example; then
  fail ".env.example must stay tracked"
else
  pass ".env.example stays tracked"
fi
if git ls-files --error-unmatch .env .env.local >/dev/null 2>&1; then
  fail "a real env file is tracked in git"
else
  pass "no real env file is tracked"
fi
# --untracked also covers files staged for the first commit; ignored files are skipped.
if git grep -nIE --untracked 'SERVICE_ROLE_KEY=.+|sb_secret_[A-Za-z0-9]|NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE' \
  -- . ':!scripts/db-smoke.sh' >/dev/null 2>&1; then
  fail "a privileged key value appears in committable files"
else
  pass "no privileged key value in committable files"
fi

echo "== Local stack configuration =="
status_output=$($SUPABASE_CLI status 2>&1)
if echo "$status_output" | grep -q "failed to read config"; then
  fail "supabase/config.toml does not parse"
else
  pass "supabase/config.toml parses"
fi

echo "== Clean rebuild =="
runtime_ready=1
if ! command -v docker >/dev/null 2>&1 && ! command -v podman >/dev/null 2>&1; then
  runtime_ready=0
  reason="no container runtime (Docker or Podman) on PATH"
elif echo "$status_output" | grep -qiE "not running|failed to inspect container health"; then
  runtime_ready=0
  reason="local Supabase stack is not running; run 'pnpm db:setup' first"
fi

if [ "$runtime_ready" -eq 1 ]; then
  if $SUPABASE_CLI db reset >/dev/null 2>&1; then
    pass "database rebuilt from version-controlled migrations"
    $SUPABASE_CLI migration list --local
  else
    fail "clean rebuild from migrations failed"
  fi
elif [ "$REQUIRE_RUNTIME" -eq 1 ]; then
  fail "clean rebuild required but unavailable: $reason"
else
  skip "clean rebuild not verified: $reason"
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "SMOKE OK ($( [ "$runtime_ready" -eq 1 ] && echo "static + rebuild" || echo "static only" ))"
  exit 0
fi
echo "SMOKE FAILED: $failures check(s)"
exit 1
