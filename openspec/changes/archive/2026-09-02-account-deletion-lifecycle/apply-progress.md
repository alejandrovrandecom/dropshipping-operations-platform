# Apply Progress: Account Deletion Lifecycle

**Mode**: Strict TDD. **Delivery**: PR1–PR3a landed `stacked-to-main`; **PR3b alone uses
`feature-branch-chain`** behind draft tracker `pr3b-finalizer` at `9a17fb1`, with children 3b-1 →
3b-2 → 3b-3 targeting each other and only the tracker reaching `main`. PR4 follows the tracker.
One `size:exception` stands, scoped to **PR3a alone** at 415 native lines; the rejected 480-line
PR3b exception is withdrawn. 3b-1 is measured at 397, 3b-2 at 253, 3b-3 at 264 and PR4 at 385.
**All 24 tasks are complete.**

## Completed Tasks

- [x] 1.1 RED — deletion-boundary and null-initiator history tests
- [x] 1.2 GREEN — `20260902100000_account_deletion_fk_relaxation.sql`
- [x] 1.3 REFACTOR/evidence — inventories, rollback asymmetry proof, regenerated types
- [x] 2.1 RED — `tests/identity/account-deletion.test.ts`, transfer boundary and username gate
- [x] 2.2 GREEN — `20260902110000_account_deletion_transfers.sql`
- [x] 2.3 REFACTOR/evidence — transfer inventories (triggers 10→11), regenerated types
- [x] 3.1 RED — request resolution, self-only receipt and request gate cases
- [x] 3.2 GREEN — `20260902120000_account_deletion_requests.sql`
- [x] 3.3 REFACTOR/evidence — request inventories (triggers 11→12), regenerated types
- [x] 4.1 RED — bounded `pending`/`failed` claims, the refused fourth, and `tests/isolation/account-deletion-rls.test.ts`
- [x] 4.2 GREEN — `20260902130000_account_deletion_claim_ledger.sql`
- [x] 4.3 REFACTOR/evidence — claim/status inventories, `service_role` grants, forward revoke, types
- [x] 5.1 RED — spine: service-role denial, `22023` guard, teams→identity, retry, session/re-signup, no scheduler
- [x] 5.2 GREEN — `20260902140000_account_deletion_finalization.sql` (spine only)
- [x] 5.3 REFACTOR/evidence — function inventory, definer bodies 22→23, forward revoke, types
- [x] 6.1 RED — injected revocation fault: teams stand, identity halts, retry completes both scopes
- [x] 6.2 GREEN — `20260902145000_account_deletion_invitation_revocation.sql` (forward replace)
- [x] 6.3 REFACTOR/evidence — mutation, focused/full/runtime, forward-replace rollback
- [x] 7.1 RED — terminal-only, age-bounded, capped purge; injected cleanup fault cannot abort a run
- [x] 7.2 GREEN — `20260902150000_account_deletion_receipt_retention.sql` (trigger, not a sweep)
- [x] 7.3 REFACTOR/evidence — trigger/function inventories, definer bodies 23→24, mutation, rollback
- [x] 8.1 RED — typed wrapper path through the service, and no privileged entry point in `src/`
- [x] 8.2 GREEN — `src/modules/identity/{types,repository,service}.ts` request/transfer wrappers
- [x] 8.3 REFACTOR/evidence — architecture, operations and security docs; mutation; budget

> Two attempts in this file are **historical**, and neither contributes a completed task above.
> The combined Unit 2 was carved into PR2a and PR2b, both green. The combined **PR3** was
> re-carved into PR3a (below, green) and PR3b (not started); its 4.1–4.4 entries are withdrawn
> from the list above because the slice they described was never delivered.

---

# Unit 1 — `pr1-fk-history-foundation` (base `53d0907`)

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

---

# Unit 2 attempt (HISTORICAL) — combined `pr2-request-transfer-state`

Superseded by PR2a below and by PR2b. Kept because PR2b is reconstructed from it: the request
RPC, the receipt and selections tables, the enum, `account_deletion_requests_require_username`
and their inventories were all verified here before the slice was carved.

Runtime attempt ordinal 2, generation 2, request-id `account-deletion-pr2-20260901-1`,
revision `sha256:62bb967a567bac5b6d629cbc31824b135870c141e51d4434c1573fedea6c4922`.
Content hash of the four changed files: `dee74394abed5ed08b6514e6d0cc0a0b753ccccfea95c06d94243936ece0df29`.

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 2.1 | `tests/identity/account-deletion.test.ts` | Integration | N/A (new) | 8/8 failed | 8/8 passed | 8 cases across 3 boundaries | `cast` and `fact` helpers extracted |
| 2.2 | (driven by 2.1) | Integration | — | — | 8/8 passed | 3 RPCs, 3 tables, 1 enum, 1 partial index | Uniform refusal per entry point |
| 2.3 | `tests/database/reproducibility.test.ts` | Reproducibility | 25/25 passed | 9 failed | 27/27 passed | 2 new inventories + 8 extended | Enum guard scoped to launch |

RED was executed, not assumed. Before the migration all 8 tests failed, each naming a contract that
did not exist: `PGRST202` for all three RPCs, and `relation "public.account_deletion_requests" does
not exist` / `"public.team_ownership_transfers" does not exist` for the privileged reads.

The 2.3 RED is the drift detector doing its job: applying the migration broke 9 reproducibility
tests, including one the slice did not expect — `adds exactly six launch tables and two launch
enums` read every enum in `public`, so a second slice owning an enum failed it. Narrowed to
`typname like 'launch%'`; the unscoped enum inventory above it remains the general guard.

### Mutation / triangulation proof

| Mutation | Expected precise failure | Observed | Restored |
|---|---|---|---|
| `and x.expires_at > pg_catalog.now()` removed from acceptance | Only the expiry test breaks | Exactly 1 failed: `expires an offer after seven days and denies it without leaking transfer state`; 7 passed | Yes, via `db reset` |
| `and x.to_user_id = successor` removed from acceptance | Only the recipient-binding test breaks | Exactly 1 failed: `moves ownership to the intended recipient alone, with no ownerless interval`; 7 passed | Yes, via `db reset` |

The two failures are disjoint, so neither guard is carrying the other's proof.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command | `pnpm exec vitest run tests/identity/account-deletion.test.ts tests/database/reproducibility.test.ts` → **35 passed (2 files)** |
| Focused rerun, no reset | Re-run against the database the full suite left dirty → **8 passed (1 file)** |
| Full suite | `pnpm test` → **152 passed, 14 files** (was 142/13) |
| Runtime harness | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)**, 8 migrations applied in order |
| Rollback boundary | Delete `supabase/migrations/20260902110000_account_deletion_state.sql` and `tests/identity/account-deletion.test.ts`; revert the additive hunks in `tests/database/reproducibility.test.ts`; regenerate `src/lib/database.types.ts`. Unit 1 and Phases 3–4 are untouched. |

## Review Budget

| Bucket | Lines (`additions + deletions`) |
|---|---|
| Authored product + tests | **399** (migration 147, identity test 198, reproducibility 50+4) |
| Generated (`src/lib/database.types.ts`, excluded from budget) | 117 |
| Snapshot identity total | 516 |

Within the 400-line budget without an exception. First measurement was 417; the overrun was removed
by compression — a redundant header paragraph deleted, four near-identical fact readers collapsed
into one parameterized `fact` helper, and comment density brought to the repo's norm. No assertion,
DDL statement, grant or revoke was dropped.

## Deviations from Design

**One, additive and reported.** Design listed the tables and the three RPCs; it did not say how a
superseding offer interacts with the partial unique index on `(team_id) where accepted_at is null`.
Left alone, one expired-but-unaccepted row would block its team's owner from ever offering again,
since the predicate cannot reference `now()`. `request_team_ownership_transfer` therefore deletes
the standing unaccepted offer before inserting. That makes "at most one live offer per team" real
rather than merely indexed, and it is owner-scoped, so it exposes nothing.

Two design-silent decisions worth review: acceptance also requires the recipient to *still* be a
member, because an owner may remove a member between offer and acceptance and would otherwise hand
the team to a non-member, breaking the owner-is-a-member invariant `ensure_owner_membership`
establishes; and a team with a live pending transfer is refused *even when also named for deletion*,
which is the strict reading of "pending transfer is unresolved" and closes the window where a
recipient accepts a team its former owner has already condemned.

## Issues Found

- A selection naming a team the caller does not own had to be refused *before* the insert, not by
  the foreign key. A `23503` on `account_deletion_team_selections_team_id_fkey` distinguishes "no
  such team" from "not your team", which is an existence oracle. Both now fail one `exists` check
  and receive the identical `42501`; the test asserts the two messages are equal, not merely that
  both fail.
- `request_account_deletion` writes selections from the *owned* set rather than the caller's array,
  after proving the two sets equal. Writing the array directly would reintroduce the refusal above
  at the insert.
- Unqualified `unnest` would have failed the definer-body audit in `reproducibility.test.ts`, which
  reads `from <name>` as a relation reference; it is spelled `pg_catalog.unnest`. In-body comments
  are kept free of `from`/`join`/`update` for the same reason — `prosrc` includes them.

---

# Unit 2 correction (HISTORICAL) — `pr2-username-gate-correction`

Attempt ordinal 3, generation 3, request-id `account-deletion-pr2-gate-correction-1`,
revision `sha256:8195917ddccae8f24377b6560785d379e6a7e182ff9f29eb9f047df859df41bc`.
Content hash of the four changed files: `2f73b5b081d7d604a54ad201f8fb583807eeb6a35ce53322737984264bb2c71b`.

## The bypass

`openspec/specs/identity-session-contracts/spec.md` requires that a confirmed account without a
username be denied **every** other protected identity, invitation, team and membership write. The
new RPCs write protected identity and team state and were not covered. Every existing test missed it
because `signIn` claims a username on the way in; only the `signIn(email, false)` opt-out exposes it.

Probed on the running stack before fixing — the finding is **two of three**:

| RPC | Usernameless caller | Cause |
|---|---|---|
| `request_account_deletion` | **BYPASS**, returned `pending` | writes only the new, ungated tables |
| `request_team_ownership_transfer` | **BYPASS**, returned a transfer id | writes only the new, ungated table |
| `accept_team_ownership_transfer` | already denied `42501` | its `update public.teams` hits `teams_require_username` |

The third case is the gate architecture working as designed, and is the argument for the fix chosen.

## RED / GREEN

| Task | Test | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| gate | `tests/identity/account-deletion.test.ts` | Integration | 35/35 passed | failed: `expected undefined to be '42501'` — the request simply succeeded | 36/36 passed | claim-then-retry admits all three | gate reasoning documented at the triggers |

GREEN adds two statement-level triggers reusing `public.enforce_username_claim()` verbatim, on
`account_deletion_requests` (insert) and `team_ownership_transfers` (insert/update/delete).
`20260901130000_username_gate.sql` chose triggers over per-RPC checks precisely because in-RPC
checks leave "a fresh bypass every time an RPC is added" — which is this bug. In-RPC checks would
also have to restate the gate's message to keep the `42501` contract, duplicating it. Selections are
not gated separately: their only write shares a transaction with the gated request insert, and no
grant reaches them otherwise. Trigger count moves 10 → 12, updated in the inventory and the
symmetric-rollback proof.

### Mutation proof

| Mutation | Expected | Observed | Restored |
|---|---|---|---|
| `account_deletion_requests_require_username` dropped | only the usernameless case breaks | Exactly 1 failed: `denies all three RPCs to an account holding no username…`, `expected undefined to be '42501'`; 8 passed | Yes, via `db reset` |

## Verification

| Evidence | Value |
|---|---|
| Focused | `pnpm exec vitest run tests/identity/account-deletion.test.ts tests/database/reproducibility.test.ts` → **36 passed (2 files)** |
| Focused rerun, no reset | Against the dirty database the full suite left → **9 passed** |
| Full suite | `pnpm test` → **153 passed, 14 files** |
| Runtime harness | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)** |

One transient failure of the gate test occurred immediately after a `db reset` container restart and
did not reproduce across the two following runs; its message was not captured. Unit 1 recorded an
identical post-reset JWT skew flake. Treated as unconfirmed infrastructure noise, not a diagnosis.

## Review budget — over

| Bucket | Lines |
|---|---|
| Migration | 157 |
| `tests/identity/account-deletion.test.ts` | 238 |
| `tests/database/reproducibility.test.ts` | 54 + 6 = 60 |
| **Authored total** | **455** (budget 400, overrun **55**) |
| Generated types (excluded) | 117 |
| Snapshot identity | 572 |

The 399-line version had already been compressed once, from 417, by removing genuine redundancy;
that slack is spent. Composition of the two new files is now migration 102 code / 43 comment / 12
blank, and test 169 code / 36 comment / 33 blank. Deleting every comment and blank line would reach
331, so the number is arithmetically reachable — but only by removing the rationale this repo treats
as the reviewable artifact (the no-foreign-key receipt argument, the uniform-refusal oracle
argument, the trigger-placement argument, and the scenario-to-spec mapping in the tests). A
compression pass that keeps every argument in shortened form, drops half the blank lines, and folds
the two new inventory tuples into existing ones lands at roughly **409** — still over. Nothing was
compressed by dropping an assertion, DDL statement, grant, revoke or inventory.

## Recommended replan — split PR2 along its own seam

The forecast sized Unit 2 at 300–380 and did not account for the gate correction. The slice divides
cleanly, because transfers do not reference deletion state at all:

| Slice | Contents | Estimate |
|---|---|---|
| PR2a `team-ownership-transfer` | `team_ownership_transfers`, partial unique index, both transfer RPCs, its gate trigger, transfer + expiry + transfer-gate tests, its inventories | ~190 |
| PR2b `account-deletion-request` | enum, `account_deletion_requests`, `account_deletion_team_selections`, `request_account_deletion` including the pending-transfer check, its gate trigger, request + resolution + request-gate tests, its inventories, launch-scoped enum guard | ~195 |

PR2a must land first: `request_account_deletion` reads `team_ownership_transfers`. Both stay well
inside the budget, each independently green, with Phases 3–4 unchanged. The work in this worktree is
complete and verified and can be carved into these two slices without rewriting it.

---

# PR2a — `pr2a-team-ownership-transfer` (base `e709bd7`, code base `322f7e4`)

Attempt ordinal 5, generation 4, request-id `account-deletion-pr2a-transfer-1`,
revision `sha256:202d97dc2117af8334ef6c854154cc55cc3b7d74e79100799839ab6561f6beea`.
Carved from the combined attempt above; `20260902110000_account_deletion_state.sql` was replaced by
`20260902110000_account_deletion_transfers.sql` and no combined filename remains.

## Scope

Ships `team_ownership_transfers`, its partial unique pending index, both transfer RPCs, forced RLS
with no policy and no grant, and `team_ownership_transfers_require_username` (trigger count 10 → 11).
The deletion enum, receipt and selections tables, `request_account_deletion` and its gate trigger are
deliberately absent — PR2b owns them, and `request_account_deletion`'s pending-transfer check will
read this table once it lands.

## TDD Cycle Evidence

| Task | Test | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 2.1 retained | transfer + expiry + recipient cases | Integration | combined run 25/25 | original combined RED: `PGRST202` on both RPCs, `relation "public.team_ownership_transfers" does not exist` | 6/6 passed carved | expiry proved both sides | helpers reduced to transfer-only |
| 2.1 retained | username gate | Integration | 35/35 | original correction RED: `expected undefined to be '42501'`, the offer simply succeeded | 6/6 passed carved | claim-then-retry admits both | carved to two RPCs |
| 2.1 **new** | supersede + membership recheck | Integration | N/A (new) | both written first against the carved migration | 6/6 passed | supersede asserts the replaced id is refused | — |
| 2.2 | (driven by 2.1) | Integration | — | — | 6/6 passed | — | header rewritten for transfers only |
| 2.3 | `tests/database/reproducibility.test.ts` | Reproducibility | 25/25 (clean checkout) | inventories failed on the new object | 26/26 passed | constraint + index folded into one tuple | — |

Two behaviours `tasks.md` requires had **no coverage in the combined run** and are genuinely new
RED here: a re-offer superseding the standing row, and acceptance re-checking current membership.
The membership guard existed in the combined code but was never tested; it is now.

### Mutation proof

| Mutation | Expected | Observed | Restored |
|---|---|---|---|
| `and x.to_user_id = successor` removed from acceptance | only the recipient-binding test breaks | Exactly 1 failed: `moves ownership to the intended recipient alone…`; 5 passed | Yes, `db reset` |
| `team_ownership_transfers_require_username` dropped | only the usernameless test breaks | Exactly 1 failed: `denies both RPCs to an account holding no username…`; 5 passed | Yes, `db reset` |

Disjoint, so neither guard carries the other's proof.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused | `pnpm exec vitest run tests/identity/account-deletion.test.ts tests/database/reproducibility.test.ts` → **32 passed (2 files)** |
| Focused rerun, no reset | `tests/identity/account-deletion.test.ts` alone against the dirty database → **6 passed** |
| Full suite | `pnpm test` → **149 passed, 14 files** |
| Runtime harness | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)**, 8 migrations in order |
| Rollback boundary | Delete `supabase/migrations/20260902110000_account_deletion_transfers.sql` and `tests/identity/account-deletion.test.ts`; revert the additive hunks in `tests/database/reproducibility.test.ts`; regenerate `src/lib/database.types.ts`. PR1 untouched. |

Full-suite count moves 142 → 149: PR2a adds 6 transfer tests and reproducibility gains one tuple.

## Review Budget

| Bucket | Lines |
|---|---|
| `20260902110000_account_deletion_transfers.sql` | 92 |
| `tests/identity/account-deletion.test.ts` | 163 |
| `tests/database/reproducibility.test.ts` | 28 + 5 = 33 |
| **Authored total** | **288** (budget 400; forecast 190–260) |
| Generated types (excluded) | 60 |
| Snapshot identity | 348 |

Slightly above the 260 forecast because the two newly required behaviours were not in the combined
estimate. Well inside budget, and no compression was needed, so every argument is intact.

## Deviations from Design

None. The design's transfer decisions — supersede on re-offer, membership re-check, gate trigger per
new table, inventory 10 → 11 — are each implemented and each has a test.

## Issues Found

- PR2a adds no enum, so the `adds exactly six launch tables and two launch enums` assertion is left
  unnarrowed here. PR2b introduces `account_deletion_state` and must narrow it to `launch%`, exactly
  as the combined attempt did; the combined evidence above records the failure it otherwise causes.
- PR2a changes no column in the deletion-nullability inventory: `from_user_id` and `to_user_id` are
  outside its filter list. PR2b's `user_id` columns will extend it.

## PR2b reconstruction notes

Preserved so PR2b needs no rediscovery: enum `account_deletion_state (pending, in_progress, done,
failed)`; `account_deletion_requests` with **no** foreign key and `account_deletion_team_selections`
cascading off both the receipt and `teams`; `request_account_deletion` refusing unowned/absent
selections through one `exists` check so a `23503` never distinguishes them; selections written from
the owned set after proving it equals the named set; a live pending transfer refusing the request
even when the team is also named; `account_deletion_requests_require_username` taking triggers to 12;
`pg_catalog.unnest` and comment hygiene for the definer-body audit.

---

# PR2b — `pr2b-account-deletion-request-state` (base `b1d5bbf`)

Attempt ordinal 6, generation 5, work unit `pr2b-account-deletion-request-state`,
revision `sha256:913623002ee879caa02621f2bf911b6e7147ddcba08c55f696520932dd4e088b`.
Reconstructed from the combined attempt and the PR2a notes above; nothing was rediscovered.

## Scope

Ships the enum `account_deletion_state`, the foreign-key-free receipt `account_deletion_requests`,
`account_deletion_team_selections`, `request_account_deletion` including its pending-transfer check,
forced RLS with no policy and no grant on both tables, and
`account_deletion_requests_require_username` (trigger count 11 → 12). The privileged claim, the
finalization, the status read and every `service_role` grant are deliberately absent: PR3 owns them.
A request records intent only — this slice deletes nothing.

## TDD Cycle Evidence

| Task | Test | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 3.1 | `tests/identity/account-deletion.test.ts` | Integration | 32/32 passed | 5 failed: 4 on `PGRST202`, 1 on a null receipt | 11/11 passed | 5 cases, each carrying its own second call | helpers `requestDeletion`/`requestFact`/`selectedTeams` extracted |
| 3.2 | (driven by 3.1) | Integration | — | — | 11/11 passed | 1 enum, 2 tables, 1 RPC, 1 trigger | linter-driven return cast |
| 3.3 | `tests/database/reproducibility.test.ts` | Reproducibility | 26/26 passed | 12 failed | 27/27 passed | 1 new inventory + 8 extended | launch enum guard narrowed |

RED was executed, not assumed. Before the migration all five new tests failed, four with `PGRST202`
naming an RPC that did not exist and the fifth with a null receipt where `pending` was expected.

Triangulation is real in every case rather than a second happy path: each refusal is followed by the
**identical call** succeeding once one fact changes — the live team is handed over, the offer is
expired, the username is claimed. So each refusal proves its own guard and not some other denial.

The 3.3 RED found one thing the slice did not plan for, exactly as the combined attempt predicted:
`adds exactly six launch tables and two launch enums` read every enum in `public`, so
`account_deletion_state` failed it. Narrowed to `typname like 'launch%'`; the unscoped enum
inventory above it remains the general guard.

### Mutation proof

| Mutation | Expected | Observed | Restored |
|---|---|---|---|
| live-offer clause removed from the resolution check | only the pending-transfer test breaks | Exactly 1 failed: `refuses while an owned team carries a live offer…`; 10 passed | Yes, `db reset` |
| `account_deletion_requests_require_username` dropped | only the usernameless test breaks | Exactly 1 failed: `denies the request RPC to an account holding no username…`; 10 passed | Yes, `db reset` |
| named-team ownership check removed | only the existence-oracle test breaks | Exactly 1 failed: `refuses an unowned team and an absent one identically`; 10 passed | Yes, `db reset` |

Three disjoint failures, so no guard is carrying another's proof. The migration was restored
byte-identically after each round (`diff -q` against a pre-mutation copy).

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused | `pnpm exec vitest run tests/identity/account-deletion.test.ts tests/database/reproducibility.test.ts` → **38 passed (2 files)** |
| Focused rerun, no reset | `tests/identity/account-deletion.test.ts` alone against the database the full suite left dirty → **11 passed** |
| Full suite | `pnpm test` → **155 passed, 14 files** (was 149/14) |
| Runtime harness | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)**, 9 migrations applied in order |
| Rollback boundary | Delete `supabase/migrations/20260902120000_account_deletion_requests.sql`; revert the additive hunks in `tests/identity/account-deletion.test.ts` and `tests/database/reproducibility.test.ts`; regenerate `src/lib/database.types.ts`. PR1 and PR2a are untouched, and no earlier migration is edited. |

Full-suite count moves 149 → 155: five new request tests and one new reproducibility inventory.

## Review Budget

| Bucket | Lines |
|---|---|
| `20260902120000_account_deletion_requests.sql` | 102 |
| `tests/identity/account-deletion.test.ts` | 112 + 8 = 120 |
| `tests/database/reproducibility.test.ts` | 38 + 12 = 50 |
| **Authored total** | **272** (budget 400; forecast 190–270) |
| Generated types (excluded) | 60 |
| SDD artifacts (`tasks.md`, this file) | tracked separately |

Two lines above the 270 forecast, and 128 inside the budget. No compression was needed, so every
argument in the migration and the tests is intact.

## Deviations from Design

**One, additive and reported.** Design named the tables and the RPC but did not say what a *second*
request does. `request_account_deletion` returns the standing receipt's state unchanged instead of
inserting or replacing. The alternative — refusing outright — was rejected because the caller then
cannot read its own state at all until PR3 lands `account_deletion_status`, and replacing was
rejected because deletion is definitive: a second call must never reopen a claimed request or
quietly condemn a different set of teams. `user_id` is unique, so the invariant is in the schema and
not only in the body.

Two design-silent decisions worth review: the receipt carries `requested_at` and `updated_at` so
PR3's state transitions and best-effort purge need no `alter table` on a table this slice owns; and
selections are deliberately ungated by a trigger of their own, since their only write shares a
transaction with the gated receipt insert and no grant reaches them by any other route.

## Issues Found

- **The schema linter caught a real defect the tests could not.** `return 'pending';` passed all
  eleven behavioral tests, because plpgsql casts the text literal on the way out — but
  `supabase db lint` reported `42804`, "the input expression type does not have an assignment cast
  to the target type". Fixed to `return 'pending'::public.account_deletion_state`. The behavior was
  identical either way; the contract was not, and `passes the schema linter` is the assertion that
  found it. This is the argument for keeping the linter inside the reproducibility suite.
- The pending-transfer refusal and the unowned-team refusal carry **different** messages on purpose.
  The security-relevant equality is unowned vs absent, and that pair is asserted equal by message,
  not merely both failed. A caller learning that its *own* teams are unresolved learns nothing about
  another tenant.
- Selections are written out of the owned set after the two checks prove it equal to the named set.
  Writing the caller's array directly would reintroduce the unowned refusal as a constraint
  violation — the distinguishable error the first check exists to prevent.
- `pg_catalog.unnest` is spelled qualified, and the in-body comments avoid `from`, `join`, `update`
  and `insert into` entirely, because the definer-body audit reads `prosrc` including its comments.

---

# PR3 attempt (HISTORICAL, FAILED) — combined `pr3-account-deletion-finalization`

**Not delivered.** This slice shipped `claim_account_deletion` with **no attempt bound**: a `failed`
receipt was re-claimable without limit, so the threat-matrix row "unbounded privileged retry" had no
design response and no test. It measured 399 authored lines with the bound absent, so adding the
bound could not fit; the slice was re-carved into **PR3a** (status, bounded claim, ledger — below,
green) and **PR3b** (the finalizer, unchanged — not started). Its content hash
`sha256:c3cf34b070a4ad783f46b0cc1e910337d8e35f8a9a185607e08e508441db7e1b` carries no retry budget.
Nothing below this heading is claimed as completed work; it is kept because PR3b is reconstructed
from it, exactly as PR2b was reconstructed from the combined Unit 2. The verified finalizer body and
its tests were copied to `/tmp/opencode/pr3-combined-backup/` before the carve (now unavailable).

Attempt ordinal 7, generation 6, work unit `pr3-account-deletion-finalization`,
revision `sha256:fa1cf4350bbcbf6a7e60540cb4117140518b59118074cf30f5813090810513a2`.

## Scope

Ships `account_deletion_status`, `claim_account_deletion` and `finalize_account_deletion`, the only
`service_role` grants in the schema, plus the three-step finalizer itself: condemned teams, both
invitation revocation scopes, the auth identity, bounded per-step retry, and the lazy receipt purge.
No new table, column, enum, trigger or policy — this slice is functions and grants alone, which is
why every inventory except the function one is untouched. PR4's typed application API and the docs
are deliberately absent.

## TDD Cycle Evidence

| Task | Test | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 4.1 | `tests/isolation/account-deletion-rls.test.ts` | Integration | N/A (new) | 2 failed: `PGRST202` on all three, and an empty privilege set | 3/3 passed | 4 caller kinds × 3 RPCs, plus the catalog read | uniform refusal collapsed into one set assertion |
| 4.2 | `tests/database/account-deletion-finalization.test.ts` | Integration | 4/4 passed | 6 failed: `function public.claim_account_deletion(unknown) does not exist` and the same for `account_deletion_status` | 10/10 passed | 6 cases, each with its own second call | `status`/`claim`/`finalize`/`invite`/`profiles`/`teams`/`addressed` helpers extracted |
| 4.3 | (driven by 4.1 and 4.2) | Integration | — | — | 13/13 passed | 3 functions, 3 steps, 1 purge | explicit enum casts, dead guard removed |
| 4.4 | `tests/database/reproducibility.test.ts` | Reproducibility | 27/27 passed | 3 failed: function inventory 20→23, definer bodies 20→23, generated types | 28/28 passed | 3 inventory tuples + a new forward-revoke proof | — |

RED was executed, not assumed. Before the migration all six new behavioral tests failed naming an
RPC that did not exist, and the isolation file failed because PostgREST could not resolve any of the
three at all — `PGRST202` where the contract requires `42501`.

### Mutation proof

| Mutation | Expected | Observed | Restored |
|---|---|---|---|
| purge age predicate dropped | only the purge test breaks | 5 failed, every one `expected null to be 'done'` — the run swept its own receipt and every other | Yes, `db reset` |
| `i.email = subject_email` dropped | only the addressed scope breaks | Exactly 1 failed: `cancels invitations issued by and addressed to the account…`, `expected 1 to be +0`; 9 passed | Yes, `db reset` |
| `grant … to service_role, authenticated` | only the isolation file breaks | 3 failed, and the second is the harm itself: `expected 'done' to be 'pending'` — the subject finalized its own account | Yes, `db reset` |

The migration was restored byte-identically after each round (`diff -q` against a pre-mutation copy).

**A mutation that did not fail is the finding of this slice.** The purge began as
`where r.state = 'done' and r.user_id <> p_user_id and r.updated_at < now() - interval '30 days'`.
Removing the self-exclusion broke nothing; removing the age predicate *also* broke nothing. Each
conjunct was carrying the other's proof, so the test proved only their conjunction. The self-exclusion
turned out to be dead code: the statement immediately above stamps the row with the same
transaction's `now()`, so the age predicate already excludes it and no input can make the two differ.
It was removed rather than left as an untestable guard, and the purge test gained a third account —
another subject's *recent* completed receipt — which is what makes the age predicate discriminating.
The mutation above now fails loudly.

The definer-body audit then caught a comment of mine: `prosrc` includes comments, and "tell apart
from this one" reads as an unqualified relation reference. Reworded, as PR2b's notes warned.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused | `pnpm exec vitest run tests/database/account-deletion-finalization.test.ts tests/isolation/account-deletion-rls.test.ts tests/database/reproducibility.test.ts` → **41 passed (3 files)** |
| Focused rerun, no reset | The two behavioral files against the database the full suite left dirty → **13 passed (2 files)** |
| Full suite | `pnpm test` → **165 passed, 15 files** (was 155/14) |
| Runtime harness | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)**, 10 migrations applied in order |
| Rollback boundary | Delete `supabase/migrations/20260902130000_account_deletion_finalization.sql` and `tests/isolation/account-deletion-rls.test.ts`; revert the additive hunks in `tests/database/account-deletion-finalization.test.ts` and `tests/database/reproducibility.test.ts`; regenerate `src/lib/database.types.ts`. PR1, PR2a and PR2b are untouched and no applied migration is edited. |

Full-suite count moves 155 → 165: six new finalization tests, three isolation tests, and one new
reproducibility proof.

## Review Budget

| Bucket | Lines |
|---|---|
| `20260902130000_account_deletion_finalization.sql` | 111 |
| `tests/isolation/account-deletion-rls.test.ts` | 66 |
| `tests/database/account-deletion-finalization.test.ts` | 185 + 3 = 188 |
| `tests/database/reproducibility.test.ts` | 33 + 1 = 34 |
| **Authored total** | **399** (budget 400) |
| Generated types (excluded) | 12 |

One line inside the budget, without an exception. The first measurement was 416; the overrun was
removed by compressing prose only — no assertion, DDL statement, grant, revoke or inventory was
dropped. An intermediate pass that reached the number by folding comments into 190-character lines
was thrown away and redone as genuinely shorter wrapped text, because gaming the count is not
compression.

## Deviations from Design

**One, and it removes something rather than adding it.** Design says the finalizer purges
"expiry-eligible receipts best-effort"; the first implementation also excluded the current subject
explicitly. The mutation round proved that clause untestable and unreachable, so it is gone and the
comment records why a special case would be indistinguishable from the age boundary. The retention
constant is 30 days, which design left open precisely because the purge is best-effort.

Two design-silent decisions worth review: `finalize_account_deletion` **refuses** a request that has
not been claimed (`22023`), so the observable `in_progress` state cannot be skipped, and it is the
claim that admits both `pending` and `failed` — retry is therefore claim-then-finalize, the same pair
of calls either way. And `account_deletion_status` answers `null` for an account that never asked;
only `service_role` can ever draw that distinction, so it is not an oracle.

## Issues Found

- The retry test uses no injected fault. The subject starts a *new* team after its request is
  already `pending`, which nothing forbids, so by finalization time the identity step is genuinely
  refused by `teams_owner_user_id_fkey`. That same restriction is what orders the whole procedure —
  a `done` account that owned a condemned team is itself the proof the team went first.
- The issued-invitation scope only proves anything if the invitation outlives its team, so the test
  hands that team to a member instead of condemning it; condemning it would delete the invitation by
  cascade and the revocation would prove nothing. A fourth invitation, issued by a third party to the
  same address, is the control that keeps this a scoped revocation rather than a purge.
- `case when … then 'failed' else 'done' end` resolves to `text`, which has no assignment cast to the
  enum. It is spelled `::public.account_deletion_state`, exactly as PR2b's linter finding required.
- Three post-`db reset` runs reported `Database client error. Retrying the connection.` and cleared
  on rerun without recurring. PR1 and PR2's evidence record the same container-restart flake.

---

# PR3a — `pr3a-account-deletion-claim-ledger` (base `6c7befa`)

Attempt ordinal 8, generation 7, work unit `pr3a-account-deletion-claim-ledger`,
revision `sha256:b5cc7e60faa9aa2569e9e9fa10eb2c03952d4f5975cdeaeffd5425a38a33c50b`.
Carved from the failed combined attempt above. `20260902130000_account_deletion_finalization.sql`
was deleted and replaced by `20260902130000_account_deletion_claim_ledger.sql`; no combined
filename, finalizer body, finalizer test or finalizer grant remains anywhere in the tree.
Content hash of the four authored files: `86a480933e61dbd45621ef8848ae2dc9bcc3ee5c2fc5a9983a60e491924cc3ca`;
with the generated types included, `c2b2fdb23c25396833c7f00c4a1809c3352e37ff035e10694c699c61a3c7d70a`.

## Scope

Ships the `attempts` ledger column on the receipt, `account_deletion_status`,
`claim_account_deletion` **with the bound the combined attempt lacked**, and the only two
`service_role` grants in the schema. Three executions are admitted — one initial plus two retries —
and the fourth claim is refused by the same predicate that admitted the first.

Deliberately absent, all of it PR3b's or PR4's: `finalize_account_deletion` and its grant, ordered
deletion, invitation revocation, auth identity deletion, lazy receipt purge, and every typed
`src/modules/identity/` wrapper. This slice deletes nothing; it only admits and counts.

## TDD Cycle Evidence

| Task | Test | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 4.1 | `tests/database/account-deletion-finalization.test.ts` | Integration | 4/4 passed (PR1 describes, on the PR2b base) | 3 failed: `function public.account_deletion_status(unknown) does not exist`, same for `claim_account_deletion` | 7/7 passed | in-flight, completed and unknown subjects each take a different path | `privileged`/`status`/`claim`/`attemptsOf`/`settle` helpers extracted |
| 4.1 | `tests/isolation/account-deletion-rls.test.ts` | Integration | N/A (new) | 3 failed: `PGRST202` where `42501` is required, `column "attempts" does not exist`, and an empty privilege set | 3/3 passed | 4 caller kinds × 2 entry points, plus the catalog read | refusals collapsed into one set assertion |
| 4.2 | (driven by 4.1) | Integration | — | — | 10/10 passed | 1 column, 2 functions, 1 bound | `admissions` named constant instead of a literal 3 |
| 4.3 | `tests/database/reproducibility.test.ts` | Reproducibility | 27/27 passed | 4 failed: column inventory, function inventory, definer bodies 20→22, generated types | 28/28 passed | 3 inventories extended + a new forward-revoke proof | — |

RED was executed, not assumed. **The fourth-claim case is genuinely new here**: the combined attempt
had no bound, so no test could have covered it. It was written before the `attempts < admissions`
predicate existed and failed against the unbounded body.

### Mutation proof

| Mutation | Expected | Observed | Restored |
|---|---|---|---|
| `and r.attempts < admissions` removed | only the bound test breaks | Exactly 1 failed: `admits three executions…refuses the fourth`, `expected 'in_progress' to be 'failed'`; 9 passed | Yes, `db reset` |
| `attempts = r.attempts + 1` removed | both admission tests break, isolation stands | Exactly 2 failed, each `expected +0 to be 1`; 8 passed | Yes, `db reset` |
| `r.state in ('pending','failed')` narrowed to `= 'pending'` | only retry continuation breaks | Exactly 1 failed: `expected 'failed' to be 'in_progress'` on the second admission; 9 passed | Yes, `db reset` |
| `grant … to service_role, authenticated` | only the isolation file breaks | 3 failed, and the second is the harm itself: `expected 'in_progress' to be 'pending'` — the subject claimed its own deletion | Yes, `db reset` |

Four disjoint failures: the bound, the counter, the `failed` admission and the grant each carry
their own proof. The migration was restored byte-identically after every round (`diff -q` against a
pre-mutation copy).

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused | `pnpm exec vitest run tests/database/account-deletion-finalization.test.ts tests/isolation/account-deletion-rls.test.ts tests/database/reproducibility.test.ts` → **38 passed (3 files)** |
| Focused rerun, no reset | The two behavioral files against the database the full suite left dirty → **10 passed (2 files)** |
| Full suite | `pnpm test` → **162 passed, 15 files** (was 155/14 at PR2b) |
| Runtime harness | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)**, 10 migrations applied in order |
| Rollback boundary | Delete `supabase/migrations/20260902130000_account_deletion_claim_ledger.sql` and `tests/isolation/account-deletion-rls.test.ts`; revert the additive hunks in `tests/database/account-deletion-finalization.test.ts` and `tests/database/reproducibility.test.ts`; regenerate `src/lib/database.types.ts`. PR1, PR2a and PR2b are untouched, no applied migration is edited, and the receipt table is never dropped. |

Full-suite count moves 155 → 162: three claim tests, three isolation tests, one forward-revoke proof.

## Review Budget

| Bucket | Lines (`additions + deletions`) |
|---|---|
| `20260902130000_account_deletion_claim_ledger.sql` | 58 |
| `tests/isolation/account-deletion-rls.test.ts` | 66 |
| `tests/database/account-deletion-finalization.test.ts` | 84 + 3 = 87 |
| `tests/database/reproducibility.test.ts` | 38 + 4 = 42 |
| **Authored total** | **253** (budget 400; forecast ~250) |
| Generated types (excluded from the authored count) | 11 |
| Snapshot identity (authored + generated) | 264 |

No compression was needed, so every argument in the migration and the tests is intact.

### Maintainer-approved `size:exception` — PR3a only

The **authored** count is 253 and never moved; it is 147 lines inside the 400-line budget and needs
no exception. The exception is about the **native** changed-line count, which also carries the
regenerated types and the SDD artifacts this slice revised while re-carving the failed combined PR3.

| Bucket | Native lines (`additions + deletions`) |
|---|---|
| Authored product + tests (the four files above) | 253 |
| Generated `src/lib/database.types.ts` | 11 |
| Revised `design.md` (re-carve to six slices, PR3a/PR3b split, bound decision) | 93 |
| Revised `tasks.md` (Phase 4/5 split, work-unit table, forecast) | 53 |
| **Native total, excluding this evidence file** | **410** |
| **Maintainer-accepted ceiling for this candidate** | **415** |

**Measured 410 against an accepted 415, so the candidate is inside the exception with 5 lines of
headroom.** `apply-progress.md` is deliberately outside the counted set: it is the evidence ledger
being written by the closure that records the exception, so counting it would make the number
self-referential and unstable on every edit. The 415 figure is the maintainer's stated acceptance for
this exact candidate, not a re-derivation; the 410 above is what this closure actually measured.

Scope of the exception, stated so no later slice inherits it:

- It applies to **PR3a and nothing else**. PR3b (`~240` authored, finalizer) and PR4 (typed API and
  docs) each keep the **400-line budget** and must be split again if they exceed it.
- It buys **no behavior**. No assertion, DDL statement, grant, revoke, inventory or test was added,
  removed or relaxed to obtain it; the candidate is byte-identical to the one that went green.
- The oversize is artifact-driven, not code-driven. The 146 lines of `design.md` and `tasks.md` are
  the record of *why* the combined PR3 was re-carved — the argument a reviewer needs most here, and
  the one thing that could not be deferred to a later slice without stranding PR3b.

## Closure Verification (attempt ordinal 9, `pr3a-size-exception-closure`)

Active revision `sha256:a365abf6d4f57e7dc1fa05d1d5a85498b648b745aa0b3a1cae27f3723e3a8cdb`. No
migration, test, generated type, design or task file was touched; this section and the header note
are the only edits. The candidate was re-verified unchanged:

| Evidence | Value |
|---|---|
| Content hash, four authored files | `86a480933e61dbd45621ef8848ae2dc9bcc3ee5c2fc5a9983a60e491924cc3ca` — **unchanged** |
| Content hash, with generated types | `c2b2fdb23c25396833c7f00c4a1809c3352e37ff035e10694c699c61a3c7d70a` — **unchanged** |
| Focused | `pnpm exec vitest run tests/database/account-deletion-finalization.test.ts tests/isolation/account-deletion-rls.test.ts tests/database/reproducibility.test.ts` → **38 passed (3 files)** |
| Focused rerun, no reset | The two behavioral files against the database the full suite left dirty → **10 passed (2 files)** |
| Full suite | `pnpm test` → **162 passed, 15 files** |
| Runtime harness | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)**, 10 migrations in order |

No mutation round was re-run: the four disjoint mutations above were executed against this exact
revision, and nothing under test has changed since.

## Deviations from Design

**One, and it is a narrowing.** `tasks.md` 4.1 asked for "no finalize outside `in_progress`". That
behavior belongs to a function this slice deliberately does not ship, so it cannot be proved here.
The test asserts the stronger in-slice fact instead — `public` holds **no** `finalize%` function at
all — and the task text was corrected to say so. PR3b task 5.1 still owns the `22023` refusal.

Design decisions are otherwise implemented as written: the bound is `attempts` on the receipt,
incremented by `claim` alone; three executions total; the fourth returns the standing `failed`.

Two design-silent decisions worth review: an already-`in_progress` receipt is **not** re-admitted, so
two callers racing the same request cannot both spend an execution and `attempts` counts admissions
rather than calls; and the exhausted refusal deliberately has no error path, so the claim's answer to
an exhausted, a completed and an unknown subject is byte-for-byte the answer a status read gives.

## Issues Found

- The bound needs a `failed` receipt, and the only thing that will ever write one is PR3b's
  finalizer. The bound test therefore seeds `failed` through `sql()` — sanctioned explicitly by the
  design's slice-independence note — and the helper is named `settle` and commented as writing the
  next slice's outcome. It exercises no PR3b surface.
- `attempts` is added to a table PR2b already writes through `request_account_deletion`, an RPC that
  names no such column. `not null default 0` is what keeps that RPC correct and what makes the alter
  safe on a table already holding receipts; the test reads `attempts = 0` straight after the PR2b
  RPC returns `pending`, and the nullability inventory pins the `not null` half.
- The definer-body audit moves 20 → 22 and passed first time: both bodies are schema-qualified and
  neither carries an in-body comment, so `prosrc` holds no unqualified `from`/`join`/`update`.
- One `db reset` during the mutation rounds left the stack briefly unreachable and cleared on rerun,
  the same container-restart flake PR1, PR2 and the combined PR3 each recorded.

## PR3b reconstruction notes

Preserved so PR3b needs no rediscovery. Its migration is `20260902140000_account_deletion_finalization.sql`
and its body is preserved in `/tmp/opencode/pr3b-monolith-backup-20260902/` (non-authoritative and
temporally mixed), minus `status`/`claim`: three per-step `begin/exception` blocks, order teams →
invitations (both scopes, unaccepted only) → `auth.users`; a `22023` refusal for anything not
`in_progress`; `done`/`failed` written by `finalize` alone; the lazy purge with its 30-day age
predicate and **no** self-exclusion clause (proved dead code by mutation — the same statement stamps
the row with the run's own `now()`); a third account holding a *recent* completed receipt is what
makes the age predicate discriminating. `case … end` must be cast `::public.account_deletion_state`.
The isolation file's `PRIVILEGED` array and the reproducibility function inventory, definer-body
count (22 → 23) and forward-revoke proof each gain `finalize_account_deletion`.

---

# PR3b-1 — `pr3b-1-spine` (child of tracker `pr3b-finalizer` at `9a17fb1`)

Attempt token `sha256:44e16002…6ccd4`, request `pr3b-1-spine-apply-20260902`; remediates evidence
`sha256:d1130df6…1a9b4ce`. First child of the PR3b feature-branch chain, targeting the tracker.

**Superseded history.** A monolithic PR3b candidate was corrected and green but measured 575 native
lines and was rejected; its 480-line exception is withdrawn and it is **source, not evidence**,
claiming no completion state here. It survives at `/tmp/opencode/pr3b-monolith-backup-20260902/`
(13 manifested entries plus the self-excluded `MANIFEST.sha256`,
`1d2ad956a38b47b62453e3922c0e0c82893932a6505e3be49ea9c60d0a6e54b3`), whose `fragments/` hold what
this child excludes — the 3b-2 ordered-halt RED test and revocation step, the 3b-3 sweep test and
inline purge. That bundle is non-authoritative and temporally mixed; the current proposal, specs,
`design.md` and `tasks.md` are authoritative.

## Scope

Ships the finalizer **spine** and the third `service_role` grant: the `22023` guard for every state
but `in_progress`, the idempotent `done` answer, condemned teams before the auth identity, the
outcome write, and the grant. No new table, column, enum, trigger, policy or index. Absent by child
boundary: **invitation revocation and the `if not step_failed` ordered halt (3b-2)** and **receipt
retention (3b-3)**. This child therefore leaves invitations un-revoked — why children target each
other, not `main`: every MUST is to hold before the tracker merges, once 3b-2 lands. PR4 untouched.

## TDD Cycle Evidence

The carve did not inherit chronology. The finalizer was **removed from the repository candidate**
and the carved tests were executed against a ten-migration schema, so RED below is this child's own.

| Task | Test | Layer | Safety Net | RED (executed on the carved candidate) | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 5.1 | `tests/database/account-deletion-finalization.test.ts` | Integration | 7/7 pre-finalizer describes passed | 4 failed `42883`, `function public.finalize_account_deletion(unknown) does not exist` | 11/11 | 3 outcome cases + the unclaimed control | `finalize`/`profiles`/`teamCount` helpers |
| 5.1 | `tests/isolation/account-deletion-rls.test.ts` | Integration | 1/3 passed | 2 failed: `PGRST202` where `42501` is required, and a two-entry privilege set | 3/3 | 4 caller kinds × 3 entry points | one set assertion |
| 5.2 | (driven by 5.1) | Integration | — | — | 14/14 | 2 steps, 1 guard, 1 idempotent answer | — |
| 5.3 | `tests/database/reproducibility.test.ts` | Reproducibility | 28/28 | function inventory, definer bodies 22→23, generated types | 28/28 | inventory + forward-revoke extended | revoke covers all three entry points |

**One assertion is honestly not RED-driven, and is reported as such.** The no-scheduler proof
(`pg_cron`/`pg_net` absent) passed before the spine existed: it is a schema guard this child carries
per design, paired with a real behavioural one — an unclaimed receipt stays `pending`.

### Mutation proof

| Mutation | Expected | Observed | Restored |
|---|---|---|---|
| `grant … to service_role, authenticated` | only isolation breaks | Exactly 2, both isolation; the harm is the first: the caller reaches the body and gets `22023`, a state oracle, instead of `42501` | Yes |
| `22023` guard removed | only the two refusal assertions break | Exactly 2; the harm is `expected 'done'` — an **exhausted** receipt finalized anyway, defeating PR3a's bound | Yes |
| idempotent `done` early return removed | only the completed-retry case breaks | Exactly 1: `expected { code: '22023' } to be 'done'` | Yes |
| condemned-teams step neutered to `perform 1` | only the outcome cases break | Exactly 3, each `expected 'failed' to be 'done'` — the restrictive owner key refusing an identity whose team still stands | Yes |

Four disjoint groups, so no guard carries another's proof; the migration was restored
**byte-identically** after every round (`diff -q`). Two rounds first reported suite-level failures
from a post-`db reset` flake; both were **re-run individually and reported only from clean re-runs**.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused (exact `tasks.md` command) | `pnpm exec vitest run tests/{database/account-deletion-finalization,isolation/account-deletion-rls,database/reproducibility}.test.ts` → **42 passed (3 files)** |
| Dirty-db rerun, no reset | The two behavioural files against the database the previous run left → **14 passed (2 files)** |
| Full suite | `pnpm test` → **166 passed, 15 files** (162 at PR3a; the spine adds four) |
| Runtime harness | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)**, 11 migrations applied in order |
| Rollback | Per design: revoke `execute` on `finalize_account_deletion(uuid)` from `service_role`, then drop the function; revert the named hunks in the three test files and regenerate types. Never drop `account_deletion_requests`. PR1–PR3a untouched, no applied migration edited. |
| Cleanup | Mutation copy and helper scripts removed from the worktree; only the seven child paths differ. |

## Review Budget — child diff against the tracker base

The tracker owns planning: `design.md` 73 + `tasks.md` restructure 81 = 154, none of it counted
here. This child owns 6 checkbox-flip lines, its implementation, tests, types and this evidence.

| Path | Native (`+`/`-`) |
|---|---|
| `supabase/migrations/20260902140000_account_deletion_finalization.sql` | 69 |
| `tests/database/account-deletion-finalization.test.ts` | 127 + 11 = 138 |
| `tests/database/reproducibility.test.ts` | 19 + 11 = 30 |
| `tests/isolation/account-deletion-rls.test.ts` | 13 + 11 = 24 |
| `src/lib/database.types.ts` | 4 |
| `tasks.md` 5.1–5.3 flips | 6 |
| `apply-progress.md` (this evidence section) | 116 + 10 = 126 |
| **Total** | 69 + 138 + 30 + 24 + 4 + 6 + 126 = **397 / 400**, no exception |

## Deviations from Design

**None.** The spine answers `done` with `done` and refuses every other state with `22023` — what the
current design requires, since its child table names the idempotent `done` as 3b-1's own and the
spec's *Done request is retried* scenario demands the same. `pending` is refused, so the observable
`in_progress` cannot be skipped, and `failed` is refused, so an exhausted receipt stays frozen.
*Historical only:* an earlier design revision worded that row as rejecting anything not
`in_progress`, literally excluding `done`. That wording is gone, so this is no longer a deviation.

## Issues Found

- PR3a's stand-in assertion — that `public` held no `finalize%` function — necessarily broke when the
  spine shipped, and became the real refusal it held the place for: an exhausted `failed` receipt is
  refused `22023`. The only pre-existing assertion this child changed, and PR3a predicted it.
- The spine needs no `if not step_failed` guard: with two steps, a failed teams step leaves a live
  owned team and `teams_owner_user_id_fkey` refuses the identity delete by itself. The guard becomes
  load-bearing in 3b-2, where the invitation step sits between them — where the defect was found.
- The definer-body audit was run against the spine body before its first execution, because `prosrc`
  includes comments; it passed first time and the count moves 22 → 23.

---

# PR3b-2 — `pr3b-2-revocation-halt` (child of `pr3b-1-spine`, PR target `pr3b-1-spine`)

Attempt token `sha256:cdf92865…2be37`, request `pr3b-2-revocation-halt-apply-20260902`. Second child
of the PR3b feature-branch chain. Measured against the PR3b-1 tip, not `main`.

## Scope

Forward `create or replace` of `finalize_account_deletion(uuid)` adding both invitation revocation
scopes — unaccepted rows `invited_by` the subject, or addressed to its normalized profile email —
before the identity step, plus `if not step_failed` guards so a failed step stops every later one.
Every PR3b-1 behaviour is preserved verbatim: `22023` guard, idempotent `done`, condemned teams
before identity, outcome write, `service_role`-only boundary. `attempts` stays the claim's alone;
this finalizer never increments it. No retention, sweep, trigger or scheduler — those are 3b-3's.

## TDD Cycle Evidence

| Task | Test | Layer | Safety Net | RED (executed) | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 6.1 | `tests/database/account-deletion-finalization.test.ts` | Integration | 14/14 on the PR3b-1 tip | `expected 'done' to be 'failed'` — the spine has no revocation step, so the injected fault never fires and the identity goes while both invitations live | 15/15 | both scopes + a same-address control + the halt + retry | fault injection scoped by `when (old.email = …)`, dropped in `finally` |
| 6.2 | (driven by 6.1) | Integration | — | — | 15/15 | 2 scopes, 2 guards | replace, never drop |
| 6.3 | `tests/database/reproducibility.test.ts` | Reproducibility | 28/28 | — | 28/28 unchanged | — | no new hunk needed; see below |

**Reproducibility needed no new assertion, and that is proved rather than assumed.** `create or
replace` preserves the function's ACL, so the existing inventory row still reads
`service_role=X/postgres`. Replacing it with `drop` + `create` resets the ACL to `DEFAULT` and
**four** existing assertions fail — the function inventory (`acl=DEFAULT`), the forward-revoke proof,
and both isolation assertions, the third of which is the harm itself: every caller reaches the body,
so the `42501` denial disappears. Generated types are byte-identical: no schema surface changed.

### Mutation proof

| Mutation | Observed | Restored |
|---|---|---|
| issued scope `i.invited_by = p_user_id` removed | Exactly 1 failed at L401, `expected [ Array(1) ] to deeply equal []` — the issued invitation survived | Yes |
| addressed scope `or i.email = subject_email` removed | Exactly 1 failed at L382, `expected 'done' to be 'failed'` — the fault never fires, identity goes | Yes |
| `if not step_failed` removed from the identity step | Exactly 1 failed at L386, `expected +0 to be 1` — the profile was destroyed past a failed revocation | Yes |
| `create or replace` → `drop` + `create` | 4 failed: ACL reset to `DEFAULT`, privileged surface opened to every caller | Yes |

The two scope mutations break at **different assertion lines**, so neither carries the other's proof.
The migration was restored **byte-identically** (`diff -q`). One mutation round first reported two
unrelated PR1 failures from the post-`db reset` JWT/container flake, and one RED run reported
`Unknown Error: JWT issued at future`; both were **re-run and are reported only from clean runs** —
the same flake PR1, PR2, PR3a and PR3b-1 each recorded.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused, exact `tasks.md` 3b-2 command (finalization + reproducibility) | **40 passed (2 files)** |
| Extended focused suite (adds the isolation file) | **43 passed (3 files)** (42 at PR3b-1) |
| Dirty-db rerun, no reset | **15 passed (2 files)** |
| Full suite | `pnpm test` → **167 passed, 15 files** (166 at PR3b-1) |
| Runtime harness | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)**, 12 migrations in order |
| Rollback | Forward-only: a later migration `create or replace`s `finalize_account_deletion(uuid)` back to the PR3b-1 spine body, then revert the named test hunk. **Never a drop** — that would reset the ACL, as the mutation above proves. `account_deletion_requests` is never dropped and no applied migration is edited. |
| Cleanup | Injected trigger and function dropped in a `finally`; mutation copy and helper script removed; PR3b-1 functional bytes unchanged except the intended forward replace. |

## Review Budget — child diff against the PR3b-1 baseline tree

Baseline: native tree `bda58baaedc46a38b9e42c46ca4ea0b229d411c0`, the PR3b-1 tip. It carries every
PR3b-1 tracked hunk — its `account-deletion-finalization.test.ts` blob is `30d166b6…`, the recorded
PR3b-1 parent hash — but, being a tree, it holds no untracked file. **Method:** tracked paths are
measured by `git diff --numstat <tree>`; the two untracked migrations are counted by line and
attributed by owner. Reproduce with `git add -N . && git diff --numstat bda58ba…`.

| Path | Native (`+`/`-`) |
|---|---|
| `…/20260902145000_account_deletion_invitation_revocation.sql` (untracked, this child) | 76 |
| `tests/database/account-deletion-finalization.test.ts` | 64 + 0 = 64 |
| `apply-progress.md` (this evidence) | 96 + 3 = 99 |
| `tasks.md` 6.1–6.3 flips and 3b-2 status corrections | 5 + 5 = 10 |
| `design.md` 3b-2 status correction | 2 + 2 = 4 |
| **Total** | 76 + 64 + 99 + 10 + 4 = **253 / 400**, no exception |
| `…/20260902140000_account_deletion_finalization.sql` (untracked, PR3b-1) | 69 — **excluded**, parent-owned |

## Deviations from Design

**None.** Design's revocation contract — open invitations by `invited_by` or profile email, before
the profile goes — and its step-isolation row are implemented exactly, and both have tests.

## Issues Found

- The issued scope only proves anything if the invitation outlives its team, so the subject invites
  from a team it hands to a successor rather than one it condemns; a condemned team deletes its
  invitations by cascade. The control is a third-party invitation to the **same address** as the
  subject's own, so only the issuer distinguishes them.
- The spine's two-step ordering was self-protecting — a failed teams step left a live owned team and
  the restrictive owner key refused the identity anyway. Inserting revocation between them is what
  makes the guard load-bearing, which is why it ships in this child and not the last.

---

# PR3b-3 — `pr3b-3-retention` (child of `pr3b-2-revocation-halt`, PR target `pr3b-2-revocation-halt`)

Attempt token `sha256:69049108…130116`, request `pr3b-3-retention-apply-20260902`. Third and last
child of the PR3b chain. Measured against pre-Phase-7 tree `545e621148f64952b956c1396c78ff01a7826cb5`.

## Scope

Ships `sweep_expired_deletion_receipts()` and the `after update … when (new.state in ('done','failed'))`
trigger on the receipt, `execute` revoked from every client role and from `service_role`. Terminal
receipts past a 30-day retention are deleted, at most 100 per firing, inside a block whose handler
discards everything. **A trigger, not an inline finalizer sweep and not a scheduler** — the recovery
bundle's inline `3b3-lazy-sweep.sql` fragment was rejected for exactly that reason. No extension is
installed. Every PR3a/3b-1/3b-2 behaviour is untouched: their functional bytes are byte-identical.

## TDD Cycle Evidence

| Task | Test | Layer | Safety Net | RED (executed) | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 7.1 | `tests/database/account-deletion-finalization.test.ts` | Integration | 12/12 on the 3b-2 tip | `expected 120 to be 20` — no sweep exists | 14/14 | eligible / fresh / non-terminal / capped / claim-does-not-fire | `seedReceipts`/`eligible`/`receiptOf` helpers |
| 7.1 | threat case, same file | Integration | — | `expected 1 to be +0` — the mechanism was absent, so the case could not be trivially green | 14/14 | fault present, then removed | fault scoped by `when (old.user_id = …)`, dropped in `finally` |
| 7.2 | (driven by 7.1) | Integration | — | — | 14/14 | 2 bounds, 1 cap, 1 swallow | — |
| 7.3 | `tests/database/reproducibility.test.ts` | Reproducibility | 28/28 | 3 failed: function inventory 23→24, trigger inventory 13→14, definer bodies | 28/28 | inventories + ACL | — |

The receipt carries no foreign key, so 120 synthetic receipts cost one statement and no auth rows —
which is what makes the cap testable at its real value instead of a token one.

### Mutation proof

| Mutation | Observed | Restored |
|---|---|---|
| age predicate dropped | **5 failed**, and the harm is the first: the run sweeps its own just-written receipt, so `status`/`claim` answer `null` | Yes |
| retention constant `interval '30 days'` → `interval '31 days'` | Exactly 1: `expected 120 to be 20` — eligible receipts were not swept | Yes |
| retention constant `interval '30 days'` → `interval '29 days'` | Exactly 1: `expected +0 to be 1` — the just-within receipt was swept | Yes |
| terminal filter widened to `where true` | Exactly 1: `expected +0 to be 1` — the live `pending` receipt was purged | Yes |
| `limit cap` removed | Exactly 1: `expected +0 to be 20` — all 120 went in one firing | Yes |
| swallowing block removed | Exactly 1: `expected { code: 'P0001' } to be 'done'` — **the MAY aborted the MUST**, the exact threat-matrix row | Yes |
| trigger `WHEN` clause removed | Exactly 1: `expected 20 to be 120` — a claim's `in_progress` fired a purge | Yes |
| `service_role` dropped from the revoke | **28/28 still passed** — see below | Yes |

Seven failing mutations, each at its own assertion, so no bound carries another's proof; the two
constant ones fail on opposite assertions, pinning 30 days from both sides. Each restored **byte-identically** before GREEN: `52b3dce4b6aaa5994c8fdf276bb685b748f054e42bde384db6d6da04bd015a2f`.

**One clause is not independently provable, and is reported rather than hidden.** Revoking `execute`
from `service_role` is currently redundant — it holds no explicit grant and inherits PUBLIC, so that
revoke alone denies it; probed, `has_function_privilege` is `false` for all three roles and `proacl`
is `postgres=X/postgres` either way. It is **not** a guard against a future grant: REVOKE removes a
privilege, it does not persist a deny. Only the ACL inventory catches that. Kept: design names it.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused, exact `tasks.md` 3b-3 command | **42 passed (2 files)** |
| Dirty-db rerun, no reset | **42 passed (2 files)** |
| Full suite | `pnpm test` → **169 passed, 15 files** (167 at 3b-2) |
| Runtime harness | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)**, 13 migrations in order |
| Generated types | byte-identical — a trigger function adds no generated surface |
| Rollback | Forward-only, per design: drop `account_deletion_requests_sweep_expired`, then
`sweep_expired_deletion_receipts()`; revert the named test/reproducibility hunks. Never drop `account_deletion_requests`; no applied migration is edited. |
| Cleanup | Injected fault trigger/function dropped in a `finally`; mutation copy and helper script removed; parent functional bytes byte-identical. |

## Review Budget — child diff against the pre-Phase-7 tree

Baseline `545e621148f64952b956c1396c78ff01a7826cb5` equals the tracked worktree at the 3b-2 tip and,
being a tree, holds no untracked migration. **Method:** tracked paths by `git diff --numstat <tree>`;
untracked migrations counted by line and attributed by owner — 140000 (69) and 145000 (76) are
parent-owned and excluded, 150000 is this child's.

| Path | Native (`+`/`-`) |
|---|---|
| `…/20260902150000_account_deletion_receipt_retention.sql` (untracked, this child) | 51 |
| `tests/database/account-deletion-finalization.test.ts` | 84 + 0 = 84 |
| `tests/database/reproducibility.test.ts` | 7 + 1 = 8 |
| `apply-progress.md` (this evidence) | 102 + 3 = 105 |
| `tasks.md` 7.1–7.3 flips and status | 5 + 5 = 10 |
| `design.md` retention bounds and status | 3 + 3 = 6 |
| **Total** | 51 + 84 + 8 + 105 + 10 + 6 = **264 / 400**, no exception |

## Deviations from Design

**One, additive and reported.** Design fixed the mechanism, the firing condition, the revokes and
the swallowing block, but named no retention window and no batch size. This ships 30 days and 100
rows per firing, and design now records both. The window matches the value the rejected monolith
used; the cap is new, and exists so a long-neglected table cannot turn an unbounded delete loose
inside a finalizing transaction. The spec permits both: purging is a MAY with no fixed retention or
purge-time guarantee, so a gradual drain is conforming.

## Issues Found

- The age predicate is doing more than expiry: without it the sweep deletes the receipt the current
  run has just written, and `status` then answers `null` for a completed deletion. That is why its
  mutation breaks five tests rather than one, and it is the same trap the rejected monolith hit.
- Purging is bounded but not scheduled, so a table nobody finalizes against is never swept. That is
  the spec's position, not an oversight: no timing guarantee is offered and none is implied.

---

# PR4 — `pr4-authenticated-wrappers-docs` (follows the tracker, entering no child)

Request `phase8-pr4-apply-20260902`, attempt ordinal 22. Measured against the pre-Phase-8 tree
`2768b1e840ad944954cb6a2e35a93fcf086d76f1`, written from the worktree exactly as PR3b-3 left it, so
every PR1–PR3b hunk — the three untracked migrations included — is baseline here and none of it is
counted below.

## Scope

Ships the typed wrappers for the three deletion RPCs the database grants `authenticated`, and the
documentation the whole change deferred to this slice. **No migration, no schema object, no grant
and no generated type changes**, which is why the reproducibility suite needed no new assertion and
`src/lib/database.types.ts` is byte-identical. The three `service_role` functions are deliberately
absent from `src/`, and their absence is asserted rather than assumed.

## TDD Cycle Evidence

| Task | Test | Layer | Safety Net | RED (executed) | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 8.1 | `tests/identity/account-deletion.test.ts` | Integration | 11/11 passed | `TypeError: service.requestAccountDeletion is not a function` | 12/12 | refusal, then the identical call admitted, plus the recorded selection | `serviceFor` helper |
| 8.1 | `tests/database/identity-module.test.ts` | Integration | 5/5 passed | 2 failed: `expected '…' to contain '.rpc("request_account_deletion"'` and the missing `Functions["request_account_deletion"]` projection | 6/6 | granted trio present, privileged trio absent, `service_role` absent | `sources()` walker extracted |
| 8.2 | (driven by 8.1) | Integration | — | — | 18/18 | 3 wrappers, 3 projected types | wrappers named for the use case, not the RPC |
| 8.3 | docs | — | — | — | — | — | three docs updated in this slice |

RED was executed, not assumed: 3 tests failed before the wrappers existed, one naming a method the
service did not have and two naming source the repository and the types file did not contain.

**One half of one assertion is a guard, not RED-driven, and is reported as such.** `src/` named no
privileged RPC and no `service_role` before this slice, so that half passed already — the same
honesty PR3b-1 recorded for its no-scheduler proof. It is paired with the positive half, which was
genuinely RED, and mutation below proves the guard is not a ghost.

### Mutation proof

| Mutation | Expected | Observed | Restored |
|---|---|---|---|
| `service.requestAccountDeletion` drops its `deleteTeamIds` argument | only the wrapper test breaks | Exactly 1 failed: `identity: request account deletion failed: deletion: owned teams are unresolved` — the condemned team was never named | Yes |
| `repository.requestTeamOwnershipTransfer` swaps team and recipient | only the wrapper test breaks | Exactly 1 failed: `identity: request ownership transfer failed: transfer: offer not permitted` | Yes |
| a module comment made to contain `account_deletion_status` | only the boundary test breaks | Exactly 1 failed: `expected '// Identity use cases. account_deleti…' not to contain 'account_deletion_status'` | Yes |
| a source comment made to contain `service_role` | only the boundary test breaks | Exactly 1 failed: `expected '// Identity domain types, never servi…' not to contain 'service_role'` | Yes |

Four disjoint failures at four different assertions, so no wrapper and no guard carries another's
proof. The three module files were restored **byte-identically** after every round, verified by
`sha256sum -c` against the pre-mutation copies (`repository.ts` `e2d153b5…`, `service.ts`
`8efaf741…`, `types.ts` `7b3214e3…`).

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused | `pnpm exec vitest run tests/database/identity-module.test.ts tests/identity/account-deletion.test.ts` → **18 passed (2 files)** (16 at the baseline) |
| Dirty-db rerun, no reset | The same two files against the database the full suite left → **18 passed (2 files)** |
| Full suite | `pnpm test` → **171 passed, 15 files** (169 at PR3b-3; PR4 adds two behavioural tests and no file) |
| Runtime harness | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)**, 13 migrations applied in order |
| Generated types | `pnpm -s db:types` re-run after the rebuild and `diff -q` against the committed file → **byte-identical**; this slice changes no schema surface |
| Rollback | Revert the additive hunks in `src/modules/identity/{types,repository,service}.ts`, in the two test files and in the three docs. Nothing else is touched: no migration, no grant, no generated type, and no PR1–PR3b behaviour. The database is unaffected either way, because this slice only wraps RPCs that already exist. |
| Cleanup | Pre-mutation copies and the regenerated type file live under `/tmp/opencode/phase8/`, outside the repository; the working tree holds no scratch file. Budget accounting used a throwaway `GIT_INDEX_FILE`, so the real index was never staged. |

## Review Budget — slice diff against the pre-Phase-8 tree

**Method:** both trees are written from the full worktree into a temporary index
(`GIT_INDEX_FILE=… git add -A && git write-tree`) and compared with
`git diff-tree -r --numstat`, so the three untracked PR3b migrations are present on **both** sides
and correctly contribute zero. Reproduce against `2768b1e8…`.

| Path | Native (`+`/`-`) |
|---|---|
| `docs/database/architecture.md` | 105 + 14 = 119 |
| `tests/identity/account-deletion.test.ts` | 32 |
| `docs/security/database-security.md` | 24 + 2 = 26 |
| `docs/database/operations.md` | 24 |
| `tests/database/identity-module.test.ts` | 22 |
| `src/modules/identity/service.ts` | 15 + 1 = 16 |
| `src/modules/identity/repository.ts` | 12 + 1 = 13 |
| `src/modules/identity/types.ts` | 6 |
| `tasks.md` 8.1–8.3 flips and the forecast line | 4 + 4 = 8 |
| `apply-progress.md` (this evidence) | 114 + 5 = 119 |
| **Total** | **385 / 400**, no exception |

The three PR3b migrations, `src/lib/database.types.ts` and every PR1–PR3b test hunk measure **0**:
they are identical on both sides of the baseline. Docs are 169 of the 385 because this slice is
where the whole change's documentation debt was deliberately parked — `design.md` says PR4 alone
adds `src/modules/identity/` and docs, and seven migrations' worth of schema, threat boundaries and
operator runbook land here at once. No compression was needed, so every argument is intact.

## Deviations from Design

**One, and it is a narrowing of the task text rather than of the design.** `tasks.md` 8.1 asks for
"no `service_role` in `src/`". Taken literally across the whole tree, the privileged **RPC names**
cannot be excluded from `src/lib/database.types.ts`: the generated file restates every function the
database has, which is what makes it generated. The assertion is therefore split, and both halves
are stronger than one loose scan — `service_role` itself must appear in **no** source file at all,
generated one included, and the three privileged RPC names must appear in **no** file under
`src/modules/`. Design is implemented as written: only `authenticated` RPCs reach `src/`.

## Issues Found

- The module's `types.ts` is pinned by an existing assertion that every exported type is projected
  from `Tables["` or `Functions["`. Spelling the receipt state as
  `Enums["account_deletion_state"]` would have failed it. It is projected from
  `Functions["request_account_deletion"]["Returns"]` instead, which is both admissible and more
  faithful: the wrapper's answer *is* that RPC's return type, so a signature change arrives here.
- The wrappers are named for the use case (`offerTeam`, `acceptTeam`, `requestAccountDeletion`) and
  not for the RPC, matching the launch module. The repository keeps the RPC-shaped names, which is
  what the boundary test reads.
- `service.requestAccountDeletion()` defaults its array to `[]`. The mutation round shows why that
  default is not the same as ignoring the argument: dropping the parameter leaves a condemned team
  unresolved and the database refuses, which is exactly the failure observed.
