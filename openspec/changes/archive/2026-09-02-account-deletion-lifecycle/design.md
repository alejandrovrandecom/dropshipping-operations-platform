# Design: Account Deletion Lifecycle

## Technical Approach

Deletion is a database contract, not a service. `postgres` holds `BYPASSRLS` on `auth.users`, so a definer function deletes the identity in SQL — no Admin API, no `pg_cron`. A live owned team refuses it (`23503`).

## Architecture Decisions

| Decision | Choice over the alternative | Rationale |
|---|---|---|
| Privileged surface | `service_role` execute-only in SQL; only `authenticated` RPCs reach `src/` | An authenticated reader is an oracle. |
| Claim is the admission point, maintainer-confirmed | It commits `in_progress` and counts 3 executions (1 + 2 retries); the fourth returns `failed` | One RPC cannot expose an intermediate state; one admission point bounds each run. |
| Step isolation | Per-step `begin/exception`; a failed step stops those after it | Steps `1..k-1` stand; identity takes the address revocation needs. |
| Selected teams | Recorded at request, deleted at finalization | Selections cascade off `teams`; retry is a no-op. |
| Receipt | `account_deletion_requests`, no FK | Any referential action destroys what outlives the account. |
| No scheduler ≠ no purge | `pg_cron`/`pg_net` absence stays with the run; purging is the only MAY | Cleanup may fail without regressing a MUST. |
| Finalizer delivery, maintainer-selected | `feature-branch-chain` behind a draft tracker, scoped to PR3b | The run's MUSTs are one outcome; tracker children need not be main-safe. |
| Shipped, PR2a/PR2b | Re-offer supersedes, acceptance re-checks membership, `*_require_username` per table | Expired rows must not block re-offers; inventory 10 → 12. |

## Data Flow

    claim   ──→ in_progress, attempts+1  ── 4th refused ──→ frozen failed
    finalize ─→ teams → invitations → auth.users ──→ done | failed ──→ sweep

## File Changes

After `…130000_…claim_ledger.sql` ✅: `…140000_…finalization.sql`, `…145000_…invitation_revocation.sql`, `…150000_…receipt_retention.sql`; PR4 alone adds `src/modules/identity/` and docs.

## Interfaces / Contracts

`claim_account_deletion`, `finalize_account_deletion` and `account_deletion_status` take `p_user_id uuid`, return `account_deletion_state`, granted to `service_role` alone. Revocation deletes open invitations by `invited_by` or profile email, before the profile goes.

## Testing Strategy

Serial Vitest via `sql()`; gate tests MUST pass `signIn(email, false)`. **Integration** covers the shipped gates plus each child's scenarios. **Isolation/reproducibility**: `42501` denial, inventories, triggers, forward-revoke.

## Threat Matrix

Git, shell, subprocess, file-classification: **N/A**.

| Boundary | Applies | Response | RED test |
|---|---|---|---|
| Privileged entry point | `service_role` only | others refused identically | four caller kinds denied |
| Unbounded retry | `failed` re-claimable | 3 executions, then frozen | claimed thrice, refused, unfinalizable |
| Cleanup aborting a MUST | 3b-3 trigger | swallowed in its block | injected fault; run `done` |

## Migration / Rollout

PR1–PR3a shipped `stacked-to-main`; that history stands. **The PR3b sub-chain alone uses `feature-branch-chain`**: a draft/no-merge tracker `pr3b-finalizer` off `9a17fb1` carries this design and the `tasks.md` restructure (73 + 81 = 154); three children land on it, and only the tracker merges to `main`. PR4 follows, entering no child.

| Child | Targets | Owns | Lines |
|---|---|---|---|
| 3b-1 spine | tracker | `…140000_…finalization.sql` — `22023` guard, idempotent `done`, condemned teams, identity, outcome, grant; isolation file; reproducibility inventory and forward-revoke; types; no-scheduler proof | 69+138+30+24+4+6+126 = **397**, validated |
| 3b-2 revocation + ordered halt | 3b-1 | `…145000_…invitation_revocation.sql` replaces the finalizer to run both scopes before identity and add the `if not step_failed` guards — the validated early-step continuation fix — plus its injected-fault halt case | **253**, validated |
| 3b-3 lazy retention | 3b-2 | `…150000_…receipt_retention.sql`, the sweep case and helper, trigger and body counts | **264**, validated |

Each child must be green on its own base under focused vitest, `pnpm test` and `pnpm db:smoke --require-runtime`, with its own TDD, mutation, work-unit, runtime and rollback evidence; none defers. 3b-1 is validated at 397, 3b-2 at 253, 3b-3 at 264, so aggregates 397+253+264 = **914** child-chain and 154+914 = **1068** combined are measured, not forecast. 3b-1 left invitations un-revoked; 3b-2 closed that before the tracker reaches `main`.

**Retention.** `sweep_expired_deletion_receipts()`: a definer trigger function, `execute` revoked from `public`, `anon`, `authenticated`, `service_role`, fired `after update … when (new.state in ('done','failed'))`, taking terminal receipts past 30 days, 100 per firing. Its delete sits in a `begin/exception when others then null` block, so failed cleanup leaves the receipt and never aborts the finalizer. It fires where the inline sweep did: `claim` writes only `in_progress`, idempotent `done` returns first. No extension.

**Rollback**, forward-only per child. **3b-1**: revoke `execute` on `finalize_account_deletion(uuid)` from `service_role`, then drop it. **3b-2**: `create or replace` restoring 3b-1's body — a forward replace, never a drop. **3b-3**: drop the trigger, then its function. Never drop `account_deletion_requests`, re-tighten a relaxed FK after a null actor, or edit an applied migration.

**sdd-tasks**: Phases 5–8 are 3b-1, 3b-2, 3b-3, PR4; `chain_strategy: feature-branch-chain` scoped to PR3b; the 480-line `size:exception` is dropped, PR3a's 415 stands.

## Open Questions

- None; delivery is settled.
