# Database Operations

How to build, rebuild, and verify the database locally. Every environment is
reconstructed from version-controlled artifacts only.

**Status**: skeleton. Hosted-environment sections stay empty until a project exists.

## Quick path

```bash
pnpm db:setup   # start the local stack and apply migrations
pnpm db:smoke   # verify artifacts, secret protection, and clean rebuild
```

## Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 20+ with Corepack | Runs `pnpm` scripts. |
| Docker or Podman | Required by the local Supabase stack. |
| Supabase CLI | Invoked via `npx supabase`; override with `SUPABASE_CLI`. |

## Local commands

| Command | Effect |
|---|---|
| `pnpm db:setup` | Starts the stack and applies all migrations. |
| `pnpm db:start` / `pnpm db:stop` | Controls the local containers. |
| `pnpm db:reset` | Destroys local data and rebuilds from migrations. |
| `pnpm db:smoke` | Runs the smoke check; add `--require-runtime` in CI. |
| `pnpm db:functions` | Serves the Edge Functions with `supabase/functions/local.env`, so invitation mail is captured to the log instead of sent. |
| `pnpm test` | Runs the Vitest suites against the running local stack. |

## Changing the schema

1. Create a migration: `npx supabase migration new <name>`.
2. Write forward-only SQL; never edit an applied migration.
3. Run `pnpm db:reset` and confirm a clean rebuild.
4. Update `docs/database/architecture.md` and the security doc in the same PR.

## Verification

`pnpm db:smoke` reports each check as PASS, FAIL, or SKIP. A skipped clean
rebuild means the container runtime or stack was unavailable — it is never
counted as a pass.

`pnpm test` runs the isolation and reproducibility suites, and the second one resets the database before it asserts. It needs the stack up (`pnpm
db:setup`) and reads credentials from `supabase status -o env` at run time, so
no key is ever committed. Run it after `pnpm db:reset` to confirm the boundary
still holds on a database rebuilt only from `supabase/migrations/`.

## Backup and restore

| Item | Owner | Status |
|---|---|---|
| Backup owner | _pending_ | No hosted project yet. |
| Retention / PITR | _pending_ | Recorded at the pre-launch gate. |
| Restore drill | _pending_ | Required before production. |
