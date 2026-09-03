# Apply Progress: Username Reservation Contract

**Mode**: Strict TDD (`strict_tdd: true`, runner Vitest 3.2.7)
**Work units**: Unit 1 — PR1 registry and atomic claim (complete) · Unit 2 — PR2 gate and scoped
resolution (complete) · Unit 3 — PR3 typed API, docs, evidence (complete)
**Chain strategy**: stacked-to-main (PR1 merged at `b00ed5a`; PR2 at `fa1c6ff`; PR3 stacks on that)
**Batch**: 4 (Units 1 and 2 are carried forward unchanged; attempt 1 remains superseded)
**Outcome**: PR1 **247**, PR2 **365**, PR3 **197** authored lines, each of a 400 budget, all green.
The change is complete: no task remains.

## Completed Tasks

- [x] 1.1 Split the superseded migration and 269-line suite: registry/claim stayed in PR1, gates/resolver moved to PR2, `tests/support/local-stack.ts` minimized
- [x] 1.2 RED PR1 boundary in `tests/identity/username-reservation.test.ts` (9 behaviors)
- [x] 1.3 RED `tests/database/reproducibility.test.ts`: registry RLS/grants/constraint/index, definer 13→14, types, claim forward-revoke
- [x] 1.4 GREEN migration 1: forced-RLS no-FK registry and `claim_username`; types regenerated; PR1 inventories closed; fixtures refactored
- [x] 1.5 Unit-1 record: tests, smoke, numstat, clean-main base, durable-registry rollback
- [x] 2.1 RED `tests/isolation/username-gate.test.ts`: the remaining 16 behaviours
- [x] 2.2 RED catalog: `has_username`, enforcer and resolver rows, definer 14→17, trigger inventory
- [x] 2.3 GREEN migration 2: predicate, ten statement triggers, scoped resolver, grants, null-uid no-op
- [x] 2.4 REFACTOR after GREEN; Unit-2 record: tests, smoke, numstat, PR1-on-main base, symmetric rollback
- [x] 3.1 RED typed `claimUsername`/`resolveTeamUsernames` module-boundary and cross-slice tests; three identity files retained
- [x] 3.2 GREEN `src/modules/identity/{types,repository,service}.ts`; no direct service database access
- [x] 3.3 Docs: two migrations, gate mechanism and resolver, rollout and both rollbacks, deletion handoff
- [x] 3.4 Unit-3 record: tests, smoke, numstat, PR2-on-main base, rollback, cross-slice snapshot evidence

All 13 tasks across the three phases are complete.

# Unit 1 — PR1, registry and atomic claim (merged to `main` at `b00ed5a`)

## Files Changed

| File | Action | Authored +/- | What |
|---|---|---|---|
| `supabase/migrations/20260901120000_username_reservation.sql` | Created | +57 / -0 | `username_reservations` (forced RLS, no policy, no grant, no FK) and `claim_username` |
| `tests/identity/username-reservation.test.ts` | Created | +136 / -0 | 9 integration tests covering the 9 PR1 spec scenarios |
| `tests/database/reproducibility.test.ts` | Modified | +46 / -4 | Registry column/RLS/grant rows, `claim_username` definer row, body count 13→14, registry constraint and index inventories, claim forward-revoke |
| `tests/support/local-stack.ts` | Modified | +4 / -0 | `uniqueUsername` helper only |
| `src/lib/database.types.ts` | Regenerated | +19 / -0 | Generated; excluded from the authored count, included in snapshot identity |
| `openspec/changes/username-reservation-contract/{tasks,apply-progress}.md` | Modified | artifact | Phase 1 checkboxes and this record |

`signIn` was left untouched. Attempt 1 had to make it claim a username by default because the gate
denied every protected write; PR1 ships no gate, so the 100 pre-existing tests need no fixture
change at all. That is 18 authored lines the split removed rather than deferred.

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | — | — | ✅ 100/100 on clean `main` | N/A (split, no behavior) | N/A | N/A | ✅ Gate/resolver removed from the slice |
| 1.2 | `tests/identity/username-reservation.test.ts` | Integration | ✅ 100/100 on clean `main` | ✅ 8 failed / 1 passed — `claim_username` absent from the schema cache | ✅ 9/9 pass | ✅ 9 behaviors: normalization, 7 malformed candidates, 30-char boundary, race, taken-vs-repeat, 3 read paths | ✅ Fixed a real isolation defect (see below) |
| 1.3 | `tests/database/reproducibility.test.ts` | Integration | ✅ 17/17 before edit | ✅ 8 failed / 12 passed — registry and definer facts absent | ✅ 20/20 pass | ✅ 6 inventories + body count + forward revoke | ➖ Matched the file's existing entry shape |
| 1.4 | both above | Integration | ✅ Both suites red first | ✅ Drove the RED above | ✅ 112/112 full suite | ✅ Forced by the cases above | ✅ Comments state rationale, not restatement |

The 9th test in 1.2, `adds no user-visible onboarding surface`, is green in RED by construction: it
asserts the change adds **no** UI file, so it can only go red if someone adds one. It is a guard,
not a behavior test, and it is reported as such rather than counted as a RED→GREEN transition.

### Anti-trivial-GREEN proof (two mutations, both detected)

Both mutations were applied through the repo's own `pg` client and the database was reset afterwards.
An earlier attempt used `psql`, which is not installed; that run's "pass" proved nothing and was
discarded rather than reported.

| Mutation | Expected detector | Result |
|---|---|---|
| `drop constraint username_reservations_user_id_key` (removes the one-time-claim rule) | uniform-refusal test | ✅ FAILED — `expected '22023' to be undefined`: the repeat claim wrongly succeeded |
| `create or replace claim_username` without `lower(btrim())` | normalization test | ✅ FAILED — padded uppercase candidate no longer normalized |

### Test Summary

- Tests written: 12 (9 behavior + 3 reproducibility: 2 inventories, 1 forward revoke)
- Tests passing: 112/112 full suite, up from a 100/100 clean-`main` baseline
- Layers: Integration 12, Unit 0, E2E 0
- Approval tests: none — no pre-existing production code was refactored
- Pure functions created: 0 — this slice is entirely a database contract

### Scenario coverage (9/9 PR1 scenarios)

| Spec scenario | Covered by |
|---|---|
| Valid first claim | `accepts a first claim from an account that has no username` |
| Usernameless account claims (claim path only; the gate half is PR2) | same test |
| Invalid username | `rejects every malformed candidate without reserving anything` |
| Deletion preserves reservation | `keeps the reservation, and only the reservation, once the account is deleted` |
| Concurrent duplicate claims | `lets exactly one of two concurrent claimants win the same name` |
| Unavailable and repeat claims indistinguishable | `refuses a taken name and a repeat claim with the identical rejection` |
| Registry enumeration is denied | `denies every direct read of the registry, broad or targeted` |
| Local or test recreation | `adopts the contract by recreating an account, with no backfill path` |
| No onboarding UI is introduced | `adds no user-visible onboarding surface` |

Normalization is proved as its own behavior (`normalizes the candidate...`), which is why the suite
has 9 tests for 9 scenarios while one scenario pair shares a test.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `pnpm exec vitest run tests/identity/username-reservation.test.ts` → **9 passed (9)**, exit 0. Run twice against the same database without a reset: **9 passed** both times, proving the suite is re-runnable. |
| Full suite result | `pnpm test` → **112 passed (112)**, 11/11 files, zero failures. Clean-`main` baseline before this unit: **100 passed (100)**, 10/10 files. |
| Runtime harness command/scenario and exact result | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)**, exit 0. The clean rebuild applied all 5 migrations including `20260901120000`. |
| Catalog verification | 14 definer bodies (13→14 exactly as forecast), all schema-qualified under the repo's audit regex. Registry constraints: `pkey/p`, `user_id_key/u`, `username_check/c` — **no `f` row**, so the deliberate absence of a foreign key is now inventoried and cannot be added silently. |
| Base | Clean `main` at `ded1555`. No PR1 dependency on unmerged work. |
| Rollback boundary | Delete `supabase/migrations/20260901120000_username_reservation.sql` and `tests/identity/username-reservation.test.ts`; revert the reproducibility, `local-stack.ts` and generated-types hunks. Nothing else is touched. In a deployed environment rollback is forward-only: a later migration revokes `execute` on `claim_username(text)`. **The registry MUST NOT be dropped once a claim exists** — that asymmetry is asserted by `closes the claim through a forward revoke that never drops the registry`, which fails if the rollback path removes the table. |

## Review Budget (hard guard)

| Bucket | Additions | Deletions | Sum |
|---|---|---|---|
| Migration | 57 | 0 | 57 |
| New PR1 test suite | 136 | 0 | 136 |
| Reproducibility inventories | 46 | 4 | 50 |
| Shared test fixture | 4 | 0 | 4 |
| **Authored total (counts toward 400)** | **243** | **4** | **247** |
| Generated types (snapshot identity, not authored risk) | 19 | 0 | 19 |
| Snapshot identity total | 262 | 4 | 266 |
| OpenSpec artifacts (reported separately) | `tasks.md` + this file | — | not counted |

**247 of 400.** No size exception is requested or needed. The forecast said 300–380; the split came
in below it because removing the gate also removed the `signIn` fixture change it forced.

## Deviations and Issues

1. **No deviation from `design.md`.** The registry is `username text primary key` with the
   `^[a-z0-9_]{3,30}$` check, `user_id uuid not null unique` with no foreign key, and
   `claimed_at timestamptz not null default now()`. `claim_username` is `lower(btrim())` plus a
   single `insert ... on conflict do nothing`, `security definer`, definer count 13→14. Rejection
   codes are `22023` for both invalid format and refused claim, with one shared message for
   taken/already-claimed and a distinct one only for format. PR1 objects are exactly the two the
   design lists; `has_username`, `enforce_username_claim`, the 10 triggers and
   `resolve_team_usernames` were all held back for PR2.
2. **A real defect was found and fixed during REFACTOR.** The first draft asserted the lower length
   boundary with the literal name `"abc"`. In a permanent registry a fixed candidate is spent on its
   first run and collides on every run after, so the suite passed once and then failed — the exact
   class of non-reproducibility that sank attempt 1. It surfaced only because the mutation check
   forced a second run. Replaced with a unique 30-character candidate for the upper boundary; the
   lower boundary stays pinned by the rejected 2-character case plus the regex now byte-compared in
   the constraint inventory. The suite is verified re-runnable without a reset.
3. **Attempt 1's central finding is confirmed and resolved, not worked around.** It reported that
   PR1 "cannot be fully green by construction" because 6 reproducibility assertions belonged to a
   later slice. That was true of the *combined* slice, not of the change: moving the gate out and
   letting PR1 close its own inventories makes PR1 independently green, 112/112. The replan was
   correct.
4. **`openspec/changes/account-deletion-lifecycle/` untouched** — `exploration.md` md5
   `35abf2f7e2a82d9efc544d9a49e493e7`, 15049 bytes, unchanged.
5. **Carried forward for PR2**: attempt 1 measured that `teams.insert` and `teams.delete` are gated
   twice, because `ensure_owner_membership` and the FK cascade both reach `memberships`, whose gate
   fires — cascade deletes do fire statement-level triggers. That is defense in depth to keep, and it
   matters when PR2 writes its trigger inventory.
6. **Suggested tasks.md correction (cosmetic)**: attempt 1 noted that `pnpm test -- <file>` does not
   filter. Unit 1's row already uses `pnpm exec vitest run <file>`, which does. Units 2 and 3 use the
   same correct form. No change needed.

