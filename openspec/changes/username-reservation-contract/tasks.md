# Tasks: Username Reservation Contract

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | PR1 300–380; PR2 320–390; PR3 180–300 authored additions + deletions |
| 400-line budget risk | Medium — measure the split/refactor of the failed 412-line slice |
| Chained PRs recommended | Yes |
| Suggested split | PR1 registry/claim → PR2 gates/resolver → PR3 API/docs/evidence; no size exception |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

Generated `src/lib/database.types.ts` is excluded from authored counts but included in each schema PR snapshot identity. All checkboxes reset: the on-disk 412-line combined slice is superseded evidence, not completed work.

### Suggested Work Units

| Unit | Scope / clean-main dependency | Tests | Runtime / count | Rollback |
|---|---|---|---|---|
| 1 | Registry/claim; clean `main`. | `pnpm exec vitest run tests/identity/username-reservation.test.ts`; `pnpm test` | `pnpm db:smoke --require-runtime`; exact `git diff --numstat` ≤400 | Revoke claim execute; never drop registry. |
| 2 | Gates/resolver; PR1 merged. | `pnpm exec vitest run tests/isolation/username-gate.test.ts`; `pnpm test` | `pnpm db:smoke --require-runtime`; exact `git diff --numstat` ≤400 | Drop triggers, revoke resolver; restores PR1. |
| 3 | API/docs; PR2 merged. | `pnpm exec vitest run tests/database/identity-module.test.ts`; `pnpm test` | `pnpm db:smoke --require-runtime`; exact `git diff --numstat` ≤400 | Revert module/docs/tests. |

## Phase 1: PR1 Registry and Atomic Claim

- [x] 1.1 Split superseded `20260901120000_username_reservation.sql` and 269-line suite: registry/claim stays PR1; gates/resolver move PR2; minimize `tests/support/local-stack.ts`.
- [x] 1.2 RED PR1 boundary in `tests/identity/username-reservation.test.ts`: usernameless valid/normalized claim, invalid, deletion/no PII, concurrency, uniform refusal, enumeration, recreation, no UI (9). Reuse prior evidence only unchanged, then rerun.
- [x] 1.3 RED `tests/database/reproducibility.test.ts`: registry RLS/grants/constraint/index, definer 13→14, types, claim forward-revoke.
- [x] 1.4 GREEN migration 1: forced-RLS no-FK registry and `claim_username`; regenerate types; close PR1 inventories and refactor fixtures.
- [x] 1.5 Record Unit-1 tests, smoke, numstat, clean-main base, and durable-registry rollback.

## Phase 2: PR2 Gate and Scoped Resolution

- [x] 2.1 RED `tests/isolation/username-gate.test.ts`: remaining 16—other-write denial; shared/non-shared resolver; identity/invitation/membership (4); lifecycle/history/templates (9)—with `42501`/unchanged state.
- [x] 2.2 RED catalog: `has_username`, enforcer/resolver, definer 14→17, and trigger inventory—profile display-name U; teams I/U/D; memberships I/D; invitations I/U/D; launches, templates, template-items, checklists, checklist-items, events I/U.
- [x] 2.3 GREEN `supabase/migrations/20260901130000_username_gate.sql`: predicate, statement triggers, scoped resolver, grants/revokes, null-`auth.uid()` no-op; regenerate types and inventories.
- [x] 2.4 REFACTOR after GREEN; record Unit-2 tests, smoke, numstat, PR1-on-main base, symmetric trigger rollback.

## Phase 3: PR3 Typed API, Docs, Evidence

- [x] 3.1 RED typed `claimUsername`/`resolveTeamUsernames` module-boundary and cross-slice tests; retain three identity files.
- [x] 3.2 GREEN `src/modules/identity/{types,repository,service}.ts`; no direct service database access.
- [x] 3.3 Update `docs/{database/architecture,security/database-security,database/operations}.md`: two migrations, gates/resolver, rollout/rollback; account deletion depends on PR1, preserves rows, adds no FK.
- [x] 3.4 Record Unit-3 tests, smoke, numstat, PR2-on-main base, rollback, and cross-slice snapshot evidence.
