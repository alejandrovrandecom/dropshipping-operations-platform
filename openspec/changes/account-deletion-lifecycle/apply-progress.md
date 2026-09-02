# Apply Progress: Account Deletion Lifecycle

**Work unit**: `pr1-fk-history-foundation` (Unit 1 of 4) · **Mode**: Strict TDD · **Base**: `53d0907`
**Delivery**: chained PR slice, `stacked-to-main`. No `size:exception`.

## Completed Tasks

- [x] 1.1 RED — deletion-boundary and null-initiator history tests
- [x] 1.2 GREEN — `20260902100000_account_deletion_fk_relaxation.sql`
- [x] 1.3 REFACTOR/evidence — inventories, rollback asymmetry proof, regenerated types

Phases 2–4 remain untouched and unstarted.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/database/account-deletion-finalization.test.ts` | Integration | N/A (new) | 3/4 failed on `23503` | 4/4 passed | 4 cases | Table-driven `authorship` helper |
| 1.1 | `tests/database/launch-history.test.ts` | Integration | 12/12 passed | 2/2 failed on `launches_created_by_fkey` | 14/14 passed | Outsider's own team reads back | `EventRow.actor_user_id` now nullable |
| 1.2 | (driven by 1.1) | Integration | — | — | 18/18 passed | 8 FKs relaxed, 2 held strict | Grouped by launch/invitation |
| 1.3 | `tests/database/reproducibility.test.ts` | Reproducibility | 22/22 passed | 3 inventories failed | 25/25 passed | 2 new inventories + rollback proof | Comments narrowed |

RED was executed, not assumed: 5 tests failed before the migration, each naming a restrictive
constraint (`launches_created_by_fkey`, `launch_events_actor_fkey`, `teams_owner_user_id_fkey`).

### Mutation / triangulation proof

| Mutation | Expected precise failure | Observed | Reverted |
|---|---|---|---|
| `launch_events_actor_fkey` restored to `on delete restrict` | Only actor-path tests break | 4 failed, all naming `launch_events_actor_fkey`; invitation and ownership tests still passed | Yes, via `db reset` |
| `create_launch` guard reverted to `existing_creator <> caller` | Only the retry guard breaks | Exactly 1 failed: `expected undefined to be '42501'` | Yes, via `db reset` |

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command | `pnpm exec vitest run tests/database/{account-deletion-finalization,launch-history,reproducibility}.test.ts` → **43 passed (3 files)** |
| Focused rerun, no reset | Same behavioral files re-run against a dirty database → **18 passed (2 files)** |
| Full suite | `pnpm test` → **142 passed, 13 files** |
| Runtime harness | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)**, 7 migrations applied in order |
| Rollback boundary | Delete `supabase/migrations/20260902100000_account_deletion_fk_relaxation.sql` and `tests/database/account-deletion-finalization.test.ts`; revert the additive hunks in `launch-history.test.ts` and `reproducibility.test.ts`; regenerate `src/lib/database.types.ts`. No other slice is touched. |

## Review Budget

| Bucket | Lines (`additions + deletions`) |
|---|---|
| Authored product + tests | **394** (migration 104, finalization test 157, reproducibility 87, launch-history 46) |
| Generated (`src/lib/database.types.ts`, excluded from budget) | 42 |
| Snapshot identity total | 436 |

Within the 400-line budget without an exception. The first measurement was 403; the overrun was
removed by compression (table-driven helper, grouped DDL, narrowed comments), not by dropping work.

## Deviations from Design

**One, deliberate and reported.** The migration also issues `create or replace function
public.create_launch(...)`, changing a single guard clause. Design listed only the eight FK alters.

Reason: `create_launch` decided the creator-only retry answer with `existing_creator <> caller`.
Once `created_by` is nullable that comparison evaluates to NULL rather than false, so the guard fell
through and answered *any* team member's retry — a regression introduced by this slice itself, and a
direct contradiction of the comment above it ("Only the original creator's own retry may be
answered"). The fix adds `existing_creator is null or` to the existing disjunction. `is distinct
from` was rejected because `reproducibility.test.ts` reads `from <name>` as an unqualified relation
reference — the same reason `set_default_checklist_template` already spells its comparison out.

Impact is a contract violation, not privilege escalation: the caller must already be a team member,
must already know the launch UUID, and receives only the id they supplied.

## Issues Found

- Ownership must move before an issuer is deletable, and the transfer RPC is Unit 2. The invitation
  test therefore reassigns `teams.owner_user_id` with privileged SQL as setup only, commented as
  such. It exercises no Unit 2 surface.
- `supabase db reset` restarts containers, and the next JWT mint can fail with `JWT issued at
  future` from host/container clock skew. Infrastructure flake, not a test defect; it cleared on
  retry and did not recur across the final full-suite runs.

## Remaining Tasks

- [ ] 2.1–2.3 Resolution state (request/transfer tables and RPCs)
- [ ] 3.1–3.4 Privileged finalization
- [ ] 4.1–4.3 Typed API and ledger
