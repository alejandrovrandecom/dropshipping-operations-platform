# Apply Progress: Launch Workspace Core

**Slices applied**: PR1 — complete database contract, docs and types · PR2 — launch module
**Mode**: Strict TDD (`strict_tdd: true`, runner `pnpm test`, Vitest 3.2.7 serial against local Supabase)
**Delivery**: `exception-ok` · chain strategy `stacked-to-main` · maintainer-approved `size:exception` for PR1 only; PR2 stayed inside the 400-line budget
**Status**: 13/13 implementation tasks complete. PR3 is downstream evidence, not an apply task.
**Review corrections**: one bounded remediation applied — `R4-001` under lineage `review-f17b14c66df60034`. See "Review remediation R4-001" below.

---

# PR1 — Database contract (merged as `be84b9f`)

## Completed tasks

- [x] 1.1 RED lifecycle/retention scenarios
- [x] 1.2 RED template/default/snapshot/retention scenarios
- [x] 1.3 RED event facts, order, continuity and retention
- [x] 1.4 RED six-table isolation
- [x] 1.5 RED reproducibility `INVENTORY`
- [x] 2.1 Forward-only migration: six tables, two enums, tenant FKs, checks and indexes
- [x] 2.2 Forced RLS, member predicates, revoke-then-column grants, no DELETE anywhere
- [x] 2.3 Five RPCs with lock order, atomic events, eligibility and error codes
- [x] 2.4 GREEN tests, regenerated types, and the three database/security docs
- [x] 2.5 REFACTOR, full serial suite, and required runtime smoke

## Files changed

| File | Action | What was done |
|---|---|---|
| `supabase/migrations/20260829170000_launch_workspace_core.sql` | Created | Two enums, six team-owned tables, forced RLS, 12 policies, column grants, five `security definer` RPCs |
| `tests/database/launch-lifecycle.test.ts` | Created | 11 lifecycle scenarios |
| `tests/database/launch-templates.test.ts` | Created | 13 template, default and snapshot scenarios |
| `tests/database/launch-history.test.ts` | Created | 12 history scenarios |
| `tests/database/launch-retention.test.ts` | Created | 11 retention scenarios across all three specs |
| `tests/isolation/launch-rls.test.ts` | Created | Six-table denial matrix, forged payloads, opaque `42501` |
| `tests/database/reproducibility.test.ts` | Modified | Extended six inventories; added enum, constraint and index inventories, the six-tables/two-enums count, and the forward-revoke proof |
| `src/lib/database.types.ts` | Regenerated | `pnpm -s db:types > src/lib/database.types.ts` |
| `docs/database/architecture.md` | Modified | ERD, tables, status machine, ledger with forward-only rollback, RLS/grant matrix, RPC and SQLSTATE tables |
| `docs/security/database-security.md` | Modified | Launch threat boundaries, enforced denials, forward-only rollback |
| `docs/database/operations.md` | Modified | Type regeneration step, "Undoing a shipped change", serial-suite rationale |

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 1.1 | `tests/database/launch-lifecycle.test.ts`, `tests/database/launch-retention.test.ts` | Integration | N/A (new) | ✅ Written before SQL | ✅ 13 + 5 passed | ✅ Two trash origins, 120 vs 121 name, blocked-then-unblocked activation | ✅ Clean |
| 1.2 | `tests/database/launch-templates.test.ts` | Integration | N/A (new) | ✅ Written before SQL | ✅ 13 passed | ✅ Cross-team `22023` vs `42501`; promote/demote/clear default | ✅ Clean |
| 1.3 | `tests/database/launch-history.test.ts` | Integration | N/A (new) | ✅ Written before SQL | ✅ 12 passed | ✅ Two independent launches; four failure modes; equal-time ordering | ✅ Clean |
| 1.4 | `tests/isolation/launch-rls.test.ts` | Integration | N/A (new) | ✅ Written before SQL | ✅ 8 passed | ✅ All six tables + own-team control; five RPCs probed absent vs foreign | ✅ Clean |
| 1.5 | `tests/database/reproducibility.test.ts` | Integration | ✅ 12/12 before edit | ✅ 12 failed first | ✅ 17 passed | ✅ Nine inventories plus count and revoke proofs | ✅ Clean |
| 2.1 | (satisfies 1.1–1.5) | — | ✅ 33/33 baseline | ✅ Inherited | ✅ `db reset` exit 0 | ➖ Driven by existing tests | ✅ Named every constraint explicitly |
| 2.2 | (satisfies 1.4, 1.5) | — | ✅ 33/33 baseline | ✅ Inherited | ✅ Grant/policy inventories passed | ➖ Driven by existing tests | ✅ Clean |
| 2.3 | (satisfies 1.1–1.4) | — | ✅ 33/33 baseline | ✅ Inherited | ✅ 49 behavioral passed | ➖ Driven by existing tests | ✅ Replaced `is distinct from`; reworded body comment |
| 2.4 | all PR1 files | Integration | ✅ 33/33 baseline | ✅ Inherited | ✅ Types + docs checks passed | ➖ N/A | ✅ Docs restructured per cognitive-doc-design |
| 2.5 | full suite | Integration | ✅ 33/33 baseline | ✅ Inherited | ✅ 87/87 + smoke OK | ➖ N/A | ✅ No behavior change |

### Test summary

- **Tests written**: 56 (51 launch behavioral/isolation + 5 new reproducibility proofs)
- **Spec scenarios covered**: 49/49 (18 lifecycle · 16 templates · 15 history)
- **Total passing**: 89/89 across 9 files (baseline was 33/33 across 4 files)
- **Layers used**: Integration (54). Unit and E2E are disabled in `openspec/config.yaml`.
- **Pre-existing failures**: none. No prior test regressed.

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command | `pnpm vitest run tests/database/launch-lifecycle.test.ts tests/database/launch-templates.test.ts tests/database/launch-history.test.ts tests/database/launch-retention.test.ts tests/isolation/launch-rls.test.ts` → **exit 0, 5 files, 51/51 passed** (after R4-001) |
| Full serial suite | `pnpm test` → **exit 0, 9 files, 89/89 passed** (48.91s, after R4-001) |
| Runtime harness | `pnpm db:smoke --require-runtime` → **exit 0, `SMOKE OK (static + rebuild)`**; ledger lists all four migrations including `20260829170000` |
| Clean rebuild | `npx supabase db reset` → **exit 0**, migration applied from scratch |
| Rollback boundary | Uncommitted: delete the six new files and revert the five modified ones; nothing outside the launch slice is touched. Shipped: a later forward migration revokes the six table grants and the five `execute` privileges — the applied migration is never edited and no table is dropped. |

### Command ledger

| # | Command | Result |
|---|---|---|
| 1 | `pnpm test` (baseline safety net) | exit 0 — 33/33 |
| 2 | `pnpm vitest run` (5 launch files) | exit 1 — 41 failed, 8 skipped: every failure a missing relation/function |
| 3 | `pnpm vitest run tests/database/reproducibility.test.ts` | exit 1 — 12 failed, 5 passed |
| 4 | `npx supabase db reset` | exit 0 — migration applied |
| 5 | `pnpm vitest run` (5 launch files) | exit 1 — 4 failed, 45 passed |
| 6 | `pnpm vitest run` (5 launch files) | exit 1 — 1 failed, 48 passed |
| 7 | `pnpm vitest run` (5 launch files) | exit 0 — 49/49 |
| 8 | `pnpm -s db:types > src/lib/database.types.ts` | exit 0 |
| 9 | `pnpm vitest run tests/database/reproducibility.test.ts` | exit 1 — 2 failed, 15 passed |
| 10 | `pnpm vitest run tests/database/reproducibility.test.ts` | exit 0 — 17/17 |
| 11 | `pnpm test` | exit 0 — 87/87 |
| 12 | `pnpm db:smoke --require-runtime` | exit 0 — `SMOKE OK (static + rebuild)` |

Three GREEN corrections were required, each diagnosed before any change:

1. **`pg` decodes `timestamptz` into `Date` objects**, so `new Set` on timestamps compared object identity, not instants. The equal-time test now reads `created_at::text`.
2. **`text || "char"` is an ambiguous operator**; `pg_constraint.contype` needed an explicit `::text` cast.
3. **The definer-body audit scans `prosrc` including comments.** Both `IS DISTINCT FROM` and the phrase "apart from trash" read as `from <unqualified relation>`. The predicate was rewritten to `is null or <>` and the comment reworded, rather than weakening the shared guard.

## Review remediation R4-001

**Finding** (deterministic CRITICAL, `supabase/migrations/20260829170000_launch_workspace_core.sql:242`): retrying
`create_launch` after the write committed but its response was lost created a second launch and a second `created`
event. The client had no safe move — retry duplicated, not retrying lost the launch.

**Correction**: the caller now supplies the launch id, so resource identity *is* the idempotency key.
`create_launch(p_launch_id uuid, p_team_id uuid, p_name text) → uuid` inserts with
`on conflict (id) do nothing`. A retry writes no row, so it appends no event, and the launch and its
`created` event stay one atomic pair. The existing row is returned only when it belongs to the same team
*and* the same creator; any other holder is refused with the unchanged opaque `42501`, and a null id
raises `22023`.

Rejected alternatives: deduplicating by name (a team may legitimately create two launches with one name)
and a separate idempotency-key table (a second source of truth for identity the database already owns).

### R4-001 TDD cycle evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| R4-001 | `tests/database/launch-lifecycle.test.ts` | Integration | ✅ 87/87 before edit | ✅ 13 failed, all `PGRST202` — the contract did not exist | ✅ 51/51 focused | ✅ Same name under a fresh id creates a second launch; null id `22023`; foreign-team and foreign-creator ids `42501` | ➖ Smallest correction; no restructuring |

### R4-001 command ledger

| # | Command | Result |
|---|---|---|
| 1 | `pnpm test` (safety net) | exit 0 — 9 files, 87/87 |
| 2 | `pnpm vitest run tests/database/launch-lifecycle.test.ts` (RED) | exit 1 — 13 failed, every failure `PGRST202` "Could not find the function public.create_launch(p_launch_id, p_name, p_team_id)" |
| 3 | `npx supabase db reset` | exit 0 — four migrations applied from scratch |
| 4 | `pnpm vitest run` (5 launch files, GREEN) | exit 0 — 51/51 (was 49/49; +2 scenarios) |
| 5 | `pnpm -s db:types > src/lib/database.types.ts` | exit 0 |
| 6 | `pnpm vitest run tests/database/reproducibility.test.ts` | exit 0 — 17/17, incl. definer-body audit (13 bodies), ACL inventory and schema linter |
| 7 | `pnpm test` (full serial suite) | exit 0 — 9 files, 89/89 (48.91s) |
| 8 | `pnpm db:smoke --require-runtime` | exit 0 — `SMOKE OK (static + rebuild)` |

No GREEN correction was needed: the first implementation passed. The definer-body audit constrained the
comment wording — `from <bare word>` reads as an unqualified relation — so every added comment avoids it.

### R4-001 idempotency proof

`tests/database/launch-lifecycle.test.ts` → "returns the same launch with no second record or event when a
launch id is retried" asserts, for one id retried twice by one actor in one team:

- both calls return that same id, and neither errors;
- `select count(*) from public.launches where team_id = $1` grows by exactly **1**;
- the append-ordered event history for that id is exactly `["created:->preparing"]` — one event.

Counts and history are read with the migration role, so an RLS-filtered view cannot disguise a duplicate.

### R4-001 footprint

| File | Action | Δ lines |
|---|---|---|
| `supabase/migrations/20260829170000_launch_workspace_core.sql` | Modified | +34 / −7 |
| `tests/database/launch-lifecycle.test.ts` | Modified | +45 / −4 |
| `openspec/changes/launch-workspace-core/specs/launch-lifecycle/spec.md` | Modified | +16 / −0 |
| `tests/isolation/launch-rls.test.ts` | Modified | +4 / −3 |
| `docs/database/architecture.md` | Modified | +2 / −2 |
| `tests/database/reproducibility.test.ts` | Modified | +2 / −2 |
| `tests/database/launch-{history,retention,templates}.test.ts` | Modified | +2 / −1 each |
| `openspec/changes/launch-workspace-core/design.md` | Modified | +1 / −1 |
| `docs/security/database-security.md` | Modified | +1 / −0 |
| `src/lib/database.types.ts` | Regenerated | +1 / −1 (generated; excluded from the authored count) |

**Authored total: 133 changed lines**, within the 180-line correction limit. The migration is unshipped and
uncommitted, so editing it in place is lawful; once re-frozen it is immutable again.

**Rollback boundary**: revert `create_launch` to the two-argument signature in the migration, drop the two
new lifecycle tests plus the `p_launch_id` argument at each call site, restore the two spec scenarios and the
five doc/design lines, and regenerate types. Nothing outside `create_launch` and its callers is touched;
PR2 files do not exist yet.

## PR1 deviations from design

None. The delivered contract matches `design.md` exactly: six tables, two enums, the composite tenant keys, the PostgreSQL 17 column-list `set null` on `origin_template_id`, forced RLS with `is_team_member` predicates, no delete policy or grant, the five RPCs with the `teams → launches → templates` lock order, and the `42501`/`22023`/`23514`/`23505` code mapping.

## PR1 issues found

1. **Whitespace-only names other than spaces are accepted.** `btrim(text)` strips spaces only, so a name of `"\t\n "` passes `btrim(name) <> ''` and creates a launch. This is exactly the `nonblank` rule `design.md` specifies and the rule `teams.name` already uses, so it was **not** changed here: fixing it in this slice would diverge from the design and leave the launch tables inconsistent with the identity tables. It needs a design decision and, if accepted, one forward migration correcting every affected table together.
2. **PR1 is far larger than forecast.** The tasks forecast 900–1,150 lines for all three PRs; PR1 alone is ~1,791 authored changed lines. The original 47 mandated RED scenarios plus the complete inventory dominate the count; R4-001 later added two lifecycle scenarios, bringing the final total to 49. The approved `size:exception` covers PR1, but PR2 and PR3 should be re-estimated before they start.

## PR1 workload / PR boundary

- **Mode**: stacked PR slice with maintainer-approved `size:exception` (PR1 only)
- **Current work unit**: Unit 1 — complete database contract, docs and types
- **Boundary**: starts from the identity-only schema at `ef1c88f`; ends with the complete launch database contract independently green — migration, the original 47 scenarios, isolation, inventory, regenerated types and the three docs; R4-001 later brought the final scenario total to 49
- **Review budget**: **1,780 authored additions + 11 deletions ≈ 1,791 changed lines**, plus `src/lib/database.types.ts` (+318/−2) which is generated and excluded from the authored count but included in the snapshot
- **Why it is not split**: any split merges incomplete database behavior — revoked tables or fail-closed transitions — so the exception buys review size only, never test order or gates

---

# PR2 — Launch module (`feat/launch-workspace-core-02-module`)

**Work unit**: `launch-workspace-core-pr2-module` · branched from merged `main@be84b9f`, targets `main` under `stacked-to-main`
**Budget**: no `size:exception` — this slice is inside the 400-line budget

## Completed tasks

- [x] 3.1 RED `tests/database/launch-module.test.ts` — service contracts, RPC/list/history order, generated projections, repository-only `.from()`/`.rpc()`
- [x] 3.2 GREEN `src/modules/launch/{types,repository,service}.ts` — caller → service → repository → Supabase preserved
- [x] 3.3 REFACTOR names, types and comments; focused command rerun; 390 authored lines, inside the 400 budget

## Files changed

| File | Action | What was done |
|---|---|---|
| `tests/database/launch-module.test.ts` | Created | 11 tests: 5 service-contract scenarios, 3 order/isolation scenarios, 3 boundary/projection contracts. Attempt 2 added three assertions pinning per-template item association (probe E). |
| `src/modules/launch/types.ts` | Created | Nine domain types, every one projected from `Database` — no restated column |
| `src/modules/launch/repository.ts` | Created | The module's only door: five RPCs and the six launch tables, with ordered reads |
| `src/modules/launch/service.ts` | Created | Ten use cases plus the pure `withItems` assembler; never touches the database itself |
| `openspec/changes/launch-workspace-core/tasks.md` | Modified | 3.1–3.3 marked `[x]` |
| `openspec/changes/launch-workspace-core/apply-progress.md` | Modified | This merged PR1 + PR2 record |

The PR1 migration, `src/lib/database.types.ts`, PR1 tests and PR1 docs were **not** touched.

## PR2 provenance and TDD evidence limitation

PR2 was produced across two apply attempts against one objective (`launch-workspace-core-pr2-module`).
Attempt 1 authored the four-file candidate but its response transport failed, so it finished as
**interrupted without claiming evidence**. Attempt 2 inherited the preserved candidate and re-derived every
claim below by direct execution.

**Honest limitation — the RED→GREEN ordering of attempt 1 is not independently verifiable.** Attempt 2 found
the implementation already present, so it could not observe the test-first sequence as it happened. It did
not inherit attempt 1's unverifiable ledger. Instead it proved the two properties RED actually buys:

1. **The RED precondition is reproducible.** Moving `src/modules/launch/` aside and rerunning gives
   `exit 1 — Cannot find module '../../src/modules/launch/service'`, `Test Files 1 failed`, `Tests no tests`.
   The suite genuinely depends on the implementation; it is not vacuous. Module restored immediately.
2. **The assertions bite.** Six mutation probes (below) confirm the suite fails when the implementation is
   wrong — which is the guarantee RED exists to provide.

This is weaker than observed test-first ordering and is recorded as such rather than asserted as fact.
`sdd-verify` should treat task 3.1's RED column as *reproduced, not witnessed*.

## PR2 TDD cycle evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| 3.1 | `tests/database/launch-module.test.ts` | Integration | ✅ 100/100 observed at attempt 2 start | ⚠️ **Reproduced, not witnessed** — module-absent run gives exit 1, suite fails to load | ✅ exit 0, 11/11 observed directly | ✅ 11 tests; 6 mutation probes prove they bite | ➖ Test-only task |
| 3.2 | same | Integration | ✅ 100/100 baseline | ⚠️ Inherited limitation (above) | ✅ exit 0, 11/11 observed directly | ✅ Probe E exposed a real gap; assertion added and reprobed | ➖ Covered by 3.3 |
| 3.3 | same | Integration | ✅ 11/11 before edit | ⚠️ Inherited limitation (above) | ✅ exit 0, 11/11 after the added assertion | ✅ Parent/child association now pinned | ✅ 390 lines, inside the 400 budget; scope unchanged |

### Mutation probes (attempt 2 — executed and observed)

Every probe was applied to the real source, executed, and reverted immediately. Working tree verified byte-clean
after the sweep.

| # | Probe | Observed result | Verdict |
|---|---|---|---|
| A | `listLaunches` without `.order("created_at")` | 2 failed — board order wrong + order contract | ✅ Bites |
| B | `listLaunches` without the `.order("id")` tiebreak | 1 failed — **only** the structural contract test | ⚠️ Behaviorally unobservable — see discovery |
| C | `listTemplateItems` ordered by `id` instead of `position` | 1 failed — only the structural contract test | ⚠️ Random uuids happened to satisfy the behavioral assertion |
| D | `listTemplateItems` ordered `position` **descending** | 2 failed — `['Third','Second','First']` vs `['First','Second','Third']` | ✅ Bites deterministically |
| E | `withItems` ignores the parent key (attaches all children to every parent) | **11/11 still passed** | ❌ **Real gap — fixed, see below** |
| F | `board` never attaches a snapshot | 2 failed | ✅ Bites |
| G | `listEvents` without `.order("seq")` | 1 failed — only the structural contract test | ⚠️ Same class as B |

**Gap found and closed (probe E).** `withItems` is the module's only pure function, and its core job — giving
each parent *its own* children — was completely untested. Every existing scenario had at most one parent with
children in scope, so the filter was a no-op and could be deleted without any test noticing. Attempt 1's probes
covered ordering only and missed this.

Fix: the default-template scenario already holds three templates where exactly one (`Standard`) has items, so
it can observe the association for free. Three assertions were added there pinning per-template item counts.
Re-running probe E now fails with `expected [ 2, 2 ] to deeply equal [ +0, +0 ]` — the gap is closed and proven
closed. Cost: **+6 authored lines** (384 → 390), inside the remaining budget.

**Discovery (probes B, C, G)**: a missing ordering tiebreak is *unobservable* through data here. The planner
answers tied `created_at` rows, and unordered `seq` rows, from an index that already yields the desired order,
so behavioral tests pass for the wrong reason. PostgreSQL guarantees nothing about tied or unordered rows, so a
plan change would silently reorder results. The test file therefore pins the order clauses with an explicit
source contract — "gives every ordered list an id tiebreak the planner cannot be trusted to supply" — which
states plainly why it is a source assertion rather than a behavioral one. Probes B, C and G each landed on that
contract, confirming it is the real safety net.

### PR2 command ledger (attempt 2 — every row directly observed)

| # | Command | Result |
|---|---|---|
| 1 | `npx vitest run tests/database/launch-module.test.ts` | exit 0 — 1 file, 11/11 (989ms) |
| 2 | Module moved aside, same command (RED reproduction) | exit 1 — `Cannot find module '../../src/modules/launch/service'`; `Tests no tests`; restored |
| 3 | Mutation probes A–G, each run and reverted | A/D/F bite; B/C/G caught by the order contract; **E did not bite** |
| 4 | Assertion added for the probe-E gap; same command | exit 0 — 11/11 |
| 5 | Probe E re-run | exit 1 — `expected [ 2, 2 ] to deeply equal [ +0, +0 ]` → gap closed; reverted |
| 6 | `pnpm test -- tests/database/launch-module.test.ts` (focused, contracted) | exit 0 — 10 files, 100/100 (58.13s) |
| 7 | `pnpm db:setup` | exit 0 — stack up; four migrations applied to a recreated database |
| 8 | `pnpm test -- tests/database/launch-module.test.ts` (runtime harness) | exit 0 — 10 files, 100/100 (58.17s) |

Commands 7–8 are the contracted runtime harness. `pnpm test -- <file>` does **not** narrow Vitest's file list,
so it ran the whole serial suite against the freshly rebuilt database: stronger evidence than intended, and it
proves the module works against a database built only from migrations, with no regression.

### PR2 test summary

- **Tests written**: 11 (8 behavioral against the live database, 3 structural contracts)
- **Total passing**: 100/100 across 10 files after a clean rebuild; PR1 baseline was 89/89 across 9
- **Layers used**: Integration (11). Unit and E2E are disabled in `openspec/config.yaml`.
- **Mocks used**: 0 — verified by source scan; every assertion runs against real Supabase with real JWTs
- **Execution mode**: serial (`fileParallelism: false`), one shared local database
- **Pure functions created**: 1 (`withItems` in `service.ts`) — association now pinned by probe E
- **Pre-existing failures**: none; no prior test regressed

## PR2 work unit evidence

| Evidence | Value |
|---|---|
| Focused test command | `pnpm test -- tests/database/launch-module.test.ts` → **exit 0, 10 files, 100/100 passed** (58.13s). The narrowest true-isolation form, `npx vitest run tests/database/launch-module.test.ts`, gives **exit 0, 1 file, 11/11** (989ms). |
| Runtime harness | `pnpm db:setup && pnpm test -- tests/database/launch-module.test.ts` → **exit 0**; four migrations reapplied to a recreated database, then **10 files, 100/100 passed** (58.17s). Real local Supabase, serial, zero mocks. |
| Rollback boundary | Delete `tests/database/launch-module.test.ts` and `src/modules/launch/` (three files). Nothing else changes: no migration, no generated type, no PR1 test or doc was touched, so the database contract and PR1 evidence survive the revert intact. Verified by `git status`: the working tree contains exactly these four added files. |
| Review budget | **390 authored additions + 0 deletions = 390 changed lines**, inside the 400 budget with no exception |
| Cleanup | No orphaned processes (`pgrep -af vitest` → none). All seven mutation probes and the RED reproduction reverted; `git diff --numstat` matches the four intended files exactly. Shared Supabase dev stack intentionally left running. |

## PR2 deviations from design

None. `design.md` asks for `src/modules/launch/{types,repository,service}.ts` with the repository as the
sole door; that is what shipped. The migration and the generated types were left immutable.

## PR2 issues found

1. **The `ok(...)` error helper is duplicated** between `src/modules/identity/repository.ts` and
   `src/modules/launch/repository.ts` (seven identical lines). Extracting it to a shared module would edit
   the identity module, which is outside this work unit's declared paths, so it was left alone. It is a
   clean follow-up once a third module needs it — two copies is not yet a pattern.
2. **`set_default_checklist_template` has no nullable argument type.** The RPC accepts a null template to
   clear the default, but the generated `Args` type declares `p_template_id: string`. The repository
   asserts the null at the call site and documents why; the alternative — hand-editing the generated file
   the migrations own — would be worse. If more RPCs grow nullable arguments, the generator's behavior
   deserves a design decision.
3. **Review budget was tighter than forecast.** The forecast allowed 220–320 lines; the slice landed at
   390. The overage is test code: mutation probing exposed weak assertions that needed real fixes. Still
   inside budget, but PR3 has less headroom than the forecast implies.
4. **A passing suite is not a biting suite.** The `withItems` association gap (probe E) survived attempt 1
   precisely because every test passed. It was found only by deliberately breaking the implementation.
   Mutation probing should cover *every* behavior a work unit claims, not just the ones that look risky —
   attempt 1 probed ordering and missed the module's only pure function.
5. **Strict TDD evidence does not survive a lost response.** Attempt 1's RED ordering is unrecoverable
   because the artifact outlived the transport that would have attested it. Recorded as a limitation rather
   than reconstructed. Where evidence cannot be honestly recovered, the property RED buys — that assertions
   bite — was proven directly instead.

## PR2 workload / PR boundary

- **Mode**: stacked PR slice, no exception required
- **Current work unit**: Unit 2 — launch module (`launch-workspace-core-pr2-module`)
- **Boundary**: starts from merged `main@be84b9f`; ends with `src/modules/launch/` independently green against a database rebuilt from migrations alone
- **Review budget**: **390 authored changed lines** across four files — no generated file is included; 10 lines of headroom remain
- **Chain strategy**: `stacked-to-main` — PR1 is merged, so PR2 targets `main` directly
- **Next**: PR3 is downstream delivery evidence (verify and archive artifacts only, no product files)
