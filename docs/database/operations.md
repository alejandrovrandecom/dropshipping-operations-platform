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
4. Regenerate the committed types: `pnpm -s db:types > src/lib/database.types.ts`.
5. Update `docs/database/architecture.md` and the security doc in the same PR.

## Undoing a shipped change

There is no `down` migration. To withdraw a capability, ship a **new** migration
that revokes its grants and `execute` privileges, which closes the surface while
retaining every row.

Dropping a table is a separate, deliberate decision about user data, not a
rollback. For the launch slice specifically, `trash` plus `restore_launch`
already provide recoverable removal, and owner-only whole-team deletion is the
one destructive path.

### Username reservation and gate

The two username migrations withdraw independently, and they are not alike:

| Migration | Withdraw by | Symmetric? |
|---|---|---|
| `20260901130000_username_gate` | Dropping the ten `*_require_username` triggers and revoking `execute` on `resolve_team_usernames(uuid)` | Yes — the schema returns to exactly its pre-gate state |
| `20260901120000_username_reservation` | Revoking `execute` on `claim_username(text)` only | No — **never drop `username_reservations`** |

The asymmetry is the contract, not an oversight. A reservation exists to outlive
the account that made it, so dropping the registry would release names that were
promised to be permanent. Withdraw the gate first if both are being withdrawn:
the gate depends on the registry, never the reverse.

### Account deletion

Finalization is privileged and on demand: nothing in this schema schedules it. An
operator holding `service_role` runs the pair, and a retry is the same pair again.

```sql
select public.claim_account_deletion('<user-uuid>');    -- pending|failed -> in_progress
select public.finalize_account_deletion('<user-uuid>'); -- done | failed
select public.account_deletion_status('<user-uuid>');   -- observe without acting
```

| Situation | What to do |
|---|---|
| `finalize` answered `failed` | Claim again and re-run. Completed steps stand; only unfinished work continues. |
| `claim` answered `failed` without moving | The three executions are spent. The receipt is frozen and no further run is admitted. |
| `finalize` raised `22023` | The receipt is not `in_progress`. Claim first — the observable state cannot be skipped. |
| A `23503` on `teams_owner_user_id_fkey` | The subject still owns a live team it never resolved. It must be handed over or condemned by a new request. |

Withdraw the surface by revoking `execute` on the three `service_role` functions;
that closes finalization while retaining every receipt. **Never drop
`account_deletion_requests`**, and never restore the finalizer with `drop` +
`create` — that resets its ACL to `DEFAULT` and reopens it to every caller. Use
`create or replace`.

### Adopting the contract locally

There is no backfill. The gate denies every protected write by a confirmed
account that holds no claim, so an account created before these migrations must
either claim a username or be recreated. Locally and in test, run `pnpm db:reset`
and recreate accounts. `tests/support/local-stack.ts` reflects this: `signIn`
claims a username by default, and callers that need the usernameless account pass
`false`.

## Verification

`pnpm db:smoke` reports each check as PASS, FAIL, or SKIP. A skipped clean
rebuild means the container runtime or stack was unavailable — it is never
counted as a pass.

`pnpm test` runs the behavioral, isolation and reproducibility suites, and the
reproducibility one resets the database before it asserts. It needs the stack up
(`pnpm db:setup`) and reads credentials from `supabase status -o env` at run
time, so no key is ever committed. Run it after `pnpm db:reset` to confirm the
boundary still holds on a database rebuilt only from `supabase/migrations/`.

The suites share one local database, so `vitest` runs files serially
(`fileParallelism: false` in `vitest.config.ts`). Keep it that way: the
reproducibility suite resets the database, which would destroy a parallel
suite's fixtures mid-run.

## Backup and restore

| Item | Owner | Status |
|---|---|---|
| Backup owner | _pending_ | No hosted project yet. |
| Retention / PITR | _pending_ | Recorded at the pre-launch gate. |
| Restore drill | _pending_ | Required before production. |
