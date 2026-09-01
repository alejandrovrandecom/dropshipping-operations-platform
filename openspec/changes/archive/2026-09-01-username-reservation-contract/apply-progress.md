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

# Unit 2 — PR2, gate and scoped resolution

## Files Changed

| File | Action | Authored +/- | What |
|---|---|---|---|
| `supabase/migrations/20260901130000_username_gate.sql` | Created | +87 / -0 | `has_username`, `enforce_username_claim`, the ten statement-level gate triggers, `resolve_team_usernames`, grants and revokes |
| `tests/isolation/username-gate.test.ts` | Created | +210 / -0 | 16 behaviours: the one open door, 4 identity/team/membership/invitation surfaces, 9 launch surfaces, 2 resolver cases |
| `tests/database/reproducibility.test.ts` | Modified | +51 / -1 | 3 definer rows, body count 14→17, the new verbatim trigger inventory, and the symmetric-rollback proof |
| `tests/support/local-stack.ts` | Modified | +10 / -3 | `signIn` claims a username by default, with `false` for the usernameless case |
| `tests/identity/username-reservation.test.ts` | Modified | +2 / -1 | PR1's `account` helper opts out of the new default |
| `src/lib/database.types.ts` | Regenerated | +8 / -0 | Generated; excluded from the authored count, included in snapshot identity |
| `openspec/changes/username-reservation-contract/{tasks,apply-progress}.md` | Modified | artifact | Phase 2 checkboxes and this record |

The `signIn` fixture change PR1 avoided lands here, where it belongs: the gate is what forces every
pre-existing account to hold a claim. It cost **+10/-3** and left all 100 inherited tests untouched —
one default flipped in one helper rather than a hundred call sites edited.

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 2.1 | `tests/isolation/username-gate.test.ts` | Integration | ✅ 112/112 on PR1-on-main | ✅ **16 failed / 0 passed**; 14 read `expected 'ALLOWED' to be '42501: …'`, so the writes genuinely went through, and 2 read `PGRST202`, the resolver being absent | ✅ 16/16 pass | ✅ 16 behaviours over 10 gated tables and 21 gated operations, plus refused→claim→allowed on one account | ✅ Extracted the repeated refusal assertion (see below) |
| 2.2 | `tests/database/reproducibility.test.ts` | Integration | ✅ 18/18 before the edit, still 18/18 after | ✅ **4 failed / 18 passed** — 14 definer rows against 17 expected, 1 trigger against 11, body count 14, and the rollback block hitting an absent resolver | ✅ 22/22 pass | ✅ 3 definer rows + body count + 11 verbatim trigger definitions + symmetric rollback | ➖ Matched the file's existing entry shape |
| 2.3 | both above | Integration | ✅ Both suites red first | ✅ Drove the RED above | ✅ 130/130 full suite | ✅ Forced by the cases above | ✅ Prose sits above each body, never inside it |
| 2.4 | both above | Integration | ✅ 130/130 before and after | N/A (no behaviour change) | ✅ 16/16, then 16/16 again on the same database | N/A | ✅ 22 call sites, 7 fewer lines, identical assertions |

The REFACTOR in 2.1/2.4 replaced `expect(await refusal(x)).toBe(REFUSED)` with a named custom
assertion, `await denies(x)`. The comparison is unchanged — still code and message together, still
verbatim — but 22 repetitions of the wrapper collapsed, un-wrapping ten two-line statements. Tests
were green before and after.

### Anti-trivial-GREEN proof (three mutations, three precise detections)

Each mutation was applied through the repo's own `pg` client and followed by `pnpm db:reset`. Each
targets a different decision from `design.md`, and each was caught by exactly the test that owns it.

| Mutation | Decision under test | Result |
|---|---|---|
| `drop trigger launches_require_username on public.launches` | Gate mechanism is the trigger | ✅ **1 failed / 15 passed** — only `denies editing a launch`. `denies creating a launch` stayed green because `create_launch` also writes `launch_events`, which is still gated: the redundancy is real and visible |
| `create or replace enforce_username_claim` without the `auth.uid() is not null` guard | Non-JWT callers must no-op | ✅ **Suite could not start** — the migration-role team seed at `username-gate.test.ts:38` raised `username: claim a username before writing`. The no-op path is load-bearing, not decorative |
| `create or replace resolve_team_usernames` without `public.is_team_member(p_team_id)` | Resolver scope | ✅ **1 failed / 15 passed** — only `discloses nothing to an account that does not share the team` |

### Test Summary

- Tests written: 18 (16 behaviour + 2 reproducibility: 1 trigger inventory, 1 symmetric rollback)
- Tests passing: 130/130 full suite, up from the 112/112 PR1-on-main baseline
- Layers: Integration 18, Unit 0, E2E 0
- Approval tests: none — no pre-existing production code was refactored
- Pure functions created: 0 — this slice is a database contract; `has_username` is its one predicate

### Scenario coverage

| Spec scenario | Covered by |
|---|---|
| Usernameless account attempts another write | All 14 denial behaviours; every one asserts `42501`, the gate's own message, and unchanged state |
| Usernameless account claims (the gate half PR1 could not reach) | `denies another protected write until the claim, and ignores callers carrying no subject` |
| Shared-team resolution | `returns the claimed members of a shared team, subjects other than the caller included` |
| Non-shared user is hidden | `discloses nothing to an account that does not share the team` |
| Registry enumeration is denied (re-proved behind the resolver) | same test, final assertion |

The gated account **owns and belongs to** its team, so every policy and column grant already says
yes; only the gate says no. Denials are asserted as code **and** message, so an RLS or grant refusal
— which carries the same `42501` — can never be mistaken for a gate hit. That is what makes these
16 proofs of the gate rather than proofs of the pre-existing tenant boundary.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `pnpm exec vitest run tests/isolation/username-gate.test.ts` → **16 passed (16)**, exit 0. Run twice against the same database with no reset between: **16 passed** both times |
| Full suite result | `pnpm test` → **130 passed (130)**, 12/12 files, zero failures. PR1-on-main baseline before this unit: **112 passed (112)**, 11/11 files. No inherited test was edited or skipped |
| Runtime harness command/scenario and exact result | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)**, exit 0. The clean rebuild applied all 6 migrations including `20260901130000` |
| Catalog verification | 17 definer bodies (14→17 exactly as forecast), all schema-qualified under the repo's audit regex. 11 triggers inventoried by verbatim `pg_get_triggerdef`, so timing, level, event list and the `profiles` column narrowing are all byte-compared |
| Base | PR1 on `main` at `b00ed5a`. Nothing from PR1 was re-created or modified; the registry and `claim_username` are consumed as they shipped |
| Rollback boundary | Delete `supabase/migrations/20260901130000_username_gate.sql` and `tests/isolation/username-gate.test.ts`; revert the reproducibility, `local-stack.ts`, PR1-test-helper and generated-types hunks. PR1 is untouched by all of it. In a deployed environment rollback is forward-only and, unlike PR1's, **fully symmetric**: drop the ten triggers and revoke `execute` on `resolve_team_usernames(uuid)`, and the schema is exactly pre-gate. Asserted by `reopens the gate through a symmetric rollback that leaves the registry standing`, which also fails if the rollback path removes the registry |

## Review Budget (hard guard)

| Bucket | Additions | Deletions | Sum |
|---|---|---|---|
| Migration | 87 | 0 | 87 |
| New PR2 gate suite | 210 | 0 | 210 |
| Reproducibility inventories and rollback | 51 | 1 | 52 |
| Shared test fixture (`signIn` default) | 10 | 3 | 13 |
| PR1 test helper opt-out | 2 | 1 | 3 |
| **Authored total (counts toward 400)** | **360** | **5** | **365** |
| Generated types (snapshot identity, not authored risk) | 8 | 0 | 8 |
| Snapshot identity total | 368 | 5 | 373 |
| OpenSpec artifacts (reported separately) | `tasks.md` + this file | — | not counted |

**365 of 400, measured by `git diff --numstat`, not estimated.** No size exception is requested or
needed. The forecast said 320–390. The REFACTOR pass took the suite from 217 to 210 lines.

## Deviations and Issues

1. **No deviation from `design.md`.** Statement-level `BEFORE` triggers carry the gate; no policy was
   added and no RPC body was rewritten. The gate no-ops on null `auth.uid()`.
   `resolve_team_usernames(p_team_id)` returns an empty set to non-members. Denials are `42501`, and
   PR1's `22023` rejection semantics are untouched. Objects are exactly the four the design lists,
   definer count 14→17, and the ten triggers cover exactly the `Gate Inventory` at `design.md:40`.
2. **PR1's carried-forward finding is confirmed and inventoried, not merely noted.** `teams` insert
   and delete really are gated twice — once directly, and once through the `memberships` write that
   `ensure_owner_membership` and the delete cascade each perform. It is kept as defense in depth, and
   the mutation that dropped `launches_require_username` demonstrated the same redundancy from the
   other side: `denies creating a launch` survived because `launch_events` is independently gated.
   The trigger inventory includes the row-level `teams_ensure_owner_membership` for exactly this
   reason, so the second path cannot be removed silently.
3. **`has_username()` is deliberately not granted to any client role.** The design does not call for
   a grant, PR3's typed API covers only `claimUsername` and `resolveTeamUsernames`, and an exposed
   predicate would be the reservation-status oracle the closed registry exists to prevent. If a
   future onboarding UI needs it, that grant belongs to that PR, and the definer inventory now pins
   the current state so it cannot drift in unnoticed.
4. **`signIn` claims by default; PR1's suite opts out.** The alternative was editing roughly a
   hundred call sites. The one file that genuinely needs usernameless accounts, PR1's
   `username-reservation.test.ts`, opts out in its single `account` helper (+2/-1).
5. **The email mirror is asserted, not assumed.** `profiles_require_username` is narrowed to
   `before update of display_name`, so `handle_user_email_change` never fires it. A confirmed address
   change is now checked end to end inside the profile-rename test.
6. **`launch_checklists` and `launch_events` update gates are currently unreachable** by any client:
   neither table grants `update`, and no RPC issues one. They are in the design's inventory and are
   kept as pure defense in depth, so a future `update` grant cannot open an ungated path.
7. **No `openspec/changes/account-deletion-lifecycle/` or `member-profile-enrichment/` file was
   touched**; both remain untracked planning directories.

# Unit 3 — PR3, typed API, docs and evidence

## Files Changed

| File | Action | Authored +/- | What |
|---|---|---|---|
| `src/modules/identity/types.ts` | Modified | +4 / -0 | `Username` and `TeamUsername`, both projected from `Database["public"]["Functions"]` |
| `src/modules/identity/repository.ts` | Modified | +7 / -1 | `claimUsername` and `resolveTeamUsernames` behind the existing `ok()` helper |
| `src/modules/identity/service.ts` | Modified | +5 / -1 | The two use cases, delegating to the repository port |
| `tests/database/identity-module.test.ts` | Modified | +44 / -4 | 3 new tests, plus the boundary test widened from `.from(` to `.from(`/`.rpc(` |
| `docs/database/architecture.md` | Modified | +80 / -1 | Registry row, ERD entity, RLS/grant row, 4 function rows, 2 ledger rows, and the gate/resolver section |
| `docs/security/database-security.md` | Modified | +26 / -1 | 7 threat-boundary rows, the enforced-denials paragraph, both rollbacks, the `has_username` gotcha |
| `docs/database/operations.md` | Modified | +23 / -0 | Asymmetry table for the two withdrawals, and local adoption without backfill |
| `openspec/changes/username-reservation-contract/{tasks,apply-progress}.md` | Modified | artifact | Phase 3 checkboxes and this record |

**No migration and no regenerated types**, exactly as `design.md:12` requires. The schema is frozen
at `fa1c6ff`; `src/lib/database.types.ts` is byte-identical to the committed file, so this PR's
authored count and its snapshot identity are the same number.

**No fourth file.** The two wrappers extend the three files that already exist, which is what keeps
`readdirSync(MODULE_DIR).sort()` equal to `["repository.ts", "service.ts", "types.ts"]`.

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 3.1 | `tests/database/identity-module.test.ts` | Integration | ✅ 2/2 on PR2-on-main before the edit | ✅ **4 failed / 1 passed** — 2 behavioural failures read `TypeError: service.claimUsername is not a function` and `service.resolveTeamUsernames is not a function`, so the production code genuinely did not exist; 2 structural failures on the absent `.rpc(` calls and the absent `Functions[` projection | ✅ 5/5 pass | ✅ 4 cases beyond the first GREEN: normalization, repeat-claim refusal, two-subject resolution, non-member empty set | ✅ Extracted `serviceFor` (see below) |
| 3.2 | same | Integration | ✅ Red first, in the same file | ✅ Drove the RED above | ✅ 5/5, then **133/133** full suite | ✅ Forced by the cases above | ✅ Comments state rationale, not restatement |
| 3.3 | — | — | ✅ 133/133 before and after; docs are not executable | N/A (documentation) | N/A | N/A | ✅ Ledger and matrix rows match each table's existing shape |
| 3.4 | — | — | ✅ Measured, not estimated | N/A (evidence) | N/A | N/A | N/A |

The REFACTOR in 3.1 extracted `serviceFor(client)` from the repeated
`identityServiceFor(client as unknown as IdentityClient)` cast, which the file already carried once
and the new tests would have carried three more times. It also matches `launch-module.test.ts:28`,
so both module suites now name the same helper. Tests were green before and after.

### Anti-trivial-GREEN proof (three mutations, three precise detections)

Each mutation targets a different obligation of this slice, and each was caught by exactly the test
that owns it — never by a second test, which is what shows the assertions are aimed rather than
merely numerous. Every mutation was reverted and the suite re-confirmed at 5/5.

| Mutation | Obligation under test | Result |
|---|---|---|
| `claimUsername` returns its own argument instead of the RPC's answer | The wrapper reports what the database stored | ✅ **1 failed / 4 passed** — only the normalization test: `expected '  UMTJ2DYTCRJR9MM  ' to be 'umtj2dytcrjr9mm'` |
| `identityServiceFor` overrides `resolveTeamUsernames` with a direct `client.rpc(...)` call | The service never reaches the database itself | ✅ **1 failed / 4 passed** — only the boundary test: `expected '// Identity use cases…' not to match /\.(from\|rpc)\(/` |
| `TeamUsername` hand-restated as `{ user_id: string; username: string }` | Domain types are projected, not restated | ✅ **1 failed / 4 passed** — only the projection test |

The second mutation is the important one: **the behavioural resolver test still passed.** A service
that bypasses the repository is functionally invisible, so behaviour alone cannot defend the
layering — which is precisely why the boundary assertion exists and why it was widened here from
`.from(` to `.from(`/`.rpc(`. Before this PR, a service calling `.rpc(` directly would have passed.

### Test Summary

- Tests written: 3 new (claim, resolution, type projection); 1 existing boundary test strengthened
- Tests passing: **133/133** full suite, up from the 130/130 PR2-on-main baseline
- Layers: Integration 3, Unit 0, E2E 0
- Approval tests: none — the boundary test's existing assertions were kept and widened, not replaced
- Pure functions created: 0 — the wrappers are the module's thin door onto a database contract

### Scenario coverage (the two PR3 reaches through the typed API)

| Spec scenario | Covered by |
|---|---|
| Valid first claim (through the module rather than the raw RPC) | `claims the account's one username through the service and lets the database normalize it` |
| Unavailable and repeat claims are indistinguishable (surfaced as a module error) | same test, second assertion |
| Shared-team resolution | `resolves the usernames of a shared team and discloses nothing outside it` |
| Non-shared user is hidden | same test, final assertion |

PR3 adds no database behaviour, so it re-proves nothing PR1 and PR2 already own. What it proves is
that the typed surface transmits that behaviour without altering it: the normalized name and the
refusal both arrive intact, and the resolver's scope is unchanged by the wrapper.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `pnpm exec vitest run tests/database/identity-module.test.ts` → **5 passed (5)**, exit 0. Run twice against the same database with no reset between: **5 passed** both times, so the permanent registry does not make the suite single-shot — the failure mode found in Unit 1 |
| Full suite result | `pnpm test` → **133 passed (133)**, 12/12 files, zero failures. PR2-on-main baseline before this unit: **130 passed (130)**. No inherited test was edited or skipped; the one existing test touched is this module's own boundary test, which was strengthened |
| Runtime harness command/scenario and exact result | `pnpm db:smoke --require-runtime` → **SMOKE OK (static + rebuild)**, exit 0. The clean rebuild applied all 6 migrations, `20260828170000` through `20260901130000`, confirming PR3 changes nothing about how the database is built |
| Cross-slice snapshot evidence | `src/lib/database.types.ts` unchanged (absent from `git diff --numstat`), so the frozen schema is proven by the diff itself rather than asserted. Both migration files are untouched. The 133 tests include PR1's 9, PR2's 16, and this unit's 5, all green together on one database |
| Base | PR2 on `main` at `fa1c6ff`. Nothing from PR1 or PR2 was re-created or modified |
| Rollback boundary | Revert the three `src/modules/identity/*.ts` hunks, the `tests/database/identity-module.test.ts` hunk, and the three docs hunks. **No database rollback exists or is needed** — PR3 ships no migration, so reverting it leaves the schema exactly as PR2 left it, and the shipped username contract keeps working with no typed caller. This is the only slice in the chain whose rollback is a pure code revert |

## Review Budget (hard guard)

| Bucket | Additions | Deletions | Sum |
|---|---|---|---|
| Identity module (three files) | 16 | 2 | 18 |
| Module test suite | 44 | 4 | 48 |
| `docs/database/architecture.md` | 80 | 1 | 81 |
| `docs/security/database-security.md` | 26 | 1 | 27 |
| `docs/database/operations.md` | 23 | 0 | 23 |
| **Authored total (counts toward 400)** | **189** | **8** | **197** |
| Generated types | 0 | 0 | 0 |
| Snapshot identity total | 189 | 8 | 197 |
| OpenSpec artifacts (reported separately) | `tasks.md` + this file | — | not counted |

**197 of 400, measured by `git diff --numstat`, not estimated.** No size exception is requested or
needed. The forecast said 180–300. Documentation is 131 of the 197, and code plus tests are 66 — a
proportion worth naming, because the reviewer's burden here is prose about a contract already
proven by 25 tests across the three slices.

### Chain total

| PR | Authored | Budget | Green |
|---|---|---|---|
| PR1 `b00ed5a` | 247 | 400 | 112/112 |
| PR2 `fa1c6ff` | 365 | 400 | 130/130 |
| PR3 | 197 | 400 | 133/133 |

Combined, 809 authored lines shipped as three independently reviewable and independently green
slices. The rejected attempt-1 alternative was 412 lines in one PR, over budget and 6 tests red.

## Deviations and Issues

1. **No deviation from `design.md`.** No migration; `src/lib/database.types.ts` untouched
   (`design.md:12`). The identity module stays three files, the module test still pins that list
   (`design.md:34`). The service reaches no database call directly. Docs cover both migrations, the
   gate mechanism, the resolver, rollout and both rollbacks, including the two ledger rows
   (`design.md:36`).
2. **The boundary assertion was widened, and it needed to be.** The pre-existing check was
   `expect(read("service.ts")).not.toMatch(/\.from\(/)` — table calls only. This PR is the first to
   put an **RPC** behind the repository, so that assertion would have permitted the exact violation
   the design forbids. It is now `.from(` **or** `.rpc(`, applied to every non-repository file rather
   than to `service.ts` by name, so a future fourth file cannot slip past it either. Mutation 2 above
   proves the widened form catches what the old form missed.
3. **`account-deletion-lifecycle`'s constraints are documented where that work will look.** The
   handoff (`design.md:65`) is recorded in `docs/database/architecture.md` under *Handoff*: the
   change depends on `20260901120000` alone, must not add a foreign key to `user_id`, and must not
   delete reservation rows. The registry's row in the migration ledger repeats the never-drop rule,
   so a reader arriving from either direction meets it.
4. **`has_username()` remains ungranted, and PR2's reasoning is now documented rather than only
   recorded here.** It appears in the architecture function table as *"nobody — the gate's own
   question"* and as a gotcha in the security doc: an exposed predicate is a reservation-status
   oracle. The typed API deliberately covers only the two granted RPCs.
5. **The ERD draws `username_reservations` unconnected**, with a one-line note explaining that this
   is the no-foreign-key decision made visible. A reader scanning the diagram for relationships
   would otherwise read the absence as an omission.
6. **`openspec/changes/account-deletion-lifecycle/` and `member-profile-enrichment/` untouched**;
   both remain untracked planning directories, unstaged and unmodified.

## Superseded record — attempt 1 (combined 412-line slice)

Kept for traceability. These checkboxes were reset by the replan; the work below is **superseded
evidence, not completed work**, and its task numbering belongs to the pre-replan `tasks.md`.

- Shipped one 412-line migration containing registry, claim, `has_username`, `enforce_username_claim`,
  10 gate triggers and `resolve_team_usernames`, with a 269-line 13-test suite and a `signIn` fixture
  change (+19/-3).
- Result: **107 passed, 6 failed** — all 6 in `tests/database/reproducibility.test.ts`, whose
  inventories the combined slice deliberately deferred.
- Result: **412 authored lines against a 400 budget**; `size:exception` was rejected.
- Its mutation check (`drop trigger teams_require_username`) confirmed the gate assertions bit.
- Every behavioral finding above was re-derived or carried forward in this batch; nothing was lost.
