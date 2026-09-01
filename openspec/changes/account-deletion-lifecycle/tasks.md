# Tasks: Account Deletion Lifecycle

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 1,050–1,350 authored; types excluded |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Four slices independently green on prior merged base, each ≤400 authored lines |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Types excluded; snapshot identity includes them. Maintainer selected four ordered `main` PRs; no `size:exception`.

### Suggested Work Units

| Unit | Goal / likely PR | Tests | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| 1 | FK/history proof; 260–340 lines | `pnpm exec vitest run tests/database/{account-deletion-finalization,launch-history,reproducibility}.test.ts`; `pnpm test` | `pnpm db:smoke --require-runtime` | `20260902100000_account_deletion_fk_relaxation.sql`, inventories, null-actor tests |
| 2 | Request/transfer state; 300–380 lines | `pnpm exec vitest run tests/identity/account-deletion.test.ts tests/database/reproducibility.test.ts`; `pnpm test` | `pnpm db:smoke --require-runtime` | `20260902110000_account_deletion_state.sql`, inventories, request/transfer tests |
| 3 | Finalization/revocation/purge; 350–400 lines | `pnpm exec vitest run tests/{database/account-deletion-finalization,isolation/account-deletion-rls,reproducibility}.test.ts`; `pnpm test` | `pnpm db:smoke --require-runtime` | `20260902120000_account_deletion_finalization.sql`, grants/inventories, finalizer tests |
| 4 | Typed API/docs/proof; 180–260 lines | `pnpm exec vitest run tests/{identity/account-deletion,database/identity-module,reproducibility}.test.ts`; `pnpm test` | `pnpm db:smoke --require-runtime` | `src/modules/identity/{types,repository,service}.ts`, docs, API tests |

## Phase 1: FK Foundation

- [ ] 1.1 **RED:** Add `tests/database/account-deletion-finalization.test.ts` and extend `tests/database/launch-history.test.ts` for restrictive ownership, null actors, retained facts/order, and outsider isolation.
- [ ] 1.2 **GREEN:** Create `supabase/migrations/20260902100000_account_deletion_fk_relaxation.sql` to relax the eight history/invitation FKs; keep `teams.owner_user_id` restrictive and `memberships.user_id` cascading.
- [ ] 1.3 **REFACTOR/evidence:** Update FK inventories and forward-revoke proof in `tests/database/reproducibility.test.ts`; regenerate `src/lib/database.types.ts`; verify Unit 1.

## Phase 2: Resolution State

- [ ] 2.1 **RED:** Create `tests/identity/account-deletion.test.ts` for self-only hidden requests, live/pending/selected resolution, pending/no grace/cancel/recovery, intended-member acceptance, seven-day expiry, and no ownerless interval.
- [ ] 2.2 **GREEN:** Create `supabase/migrations/20260902110000_account_deletion_state.sql` with forced-RLS state/selection/transfer tables and authenticated request/transfer/acceptance RPCs.
- [ ] 2.3 **REFACTOR/evidence:** Inventory state objects, policies, grants, functions, enum, index, and generated type in `tests/database/reproducibility.test.ts` and `src/lib/database.types.ts`; verify Unit 2.

## Phase 3: Privileged Finalization

- [ ] 3.1 **RED:** Create `tests/isolation/account-deletion-rls.test.ts`: authenticated/non-owner/outsider/anon are denied on all 3 privileged RPCs; `has_function_privilege('authenticated', ...)` is false; failure discloses no deletion/tenant state.
- [ ] 3.2 **RED:** Extend `tests/database/account-deletion-finalization.test.ts` for claim/status states, selected-team-before-identity, partial-failure retry, done idempotency, both invitation revocations, PII removal, username survival, deleted-session denial, fresh same-email UUID, non-PII lazy receipt purge, and no scheduler.
- [ ] 3.3 **GREEN:** Create `supabase/migrations/20260902120000_account_deletion_finalization.sql` with service_role-only claim/finalize/status, per-step retry, revocations, auth deletion, and later-run lazy purge.
- [ ] 3.4 **REFACTOR/evidence:** Update finalizer inventories, grants, forward-revoke proof, and generated snapshot in `tests/database/reproducibility.test.ts` and `src/lib/database.types.ts`; verify Unit 3.

## Phase 4: Typed API and Ledger

- [ ] 4.1 **RED:** Extend `tests/database/identity-module.test.ts` and `tests/identity/account-deletion.test.ts` to require typed authenticated request/transfer wrappers and forbid `service_role` in `src/`.
- [ ] 4.2 **GREEN:** Extend only `src/modules/identity/{types,repository,service}.ts` with typed request/transfer APIs, preserving service → repository → DB and the three-file module.
- [ ] 4.3 **REFACTOR/evidence:** Update `docs/database/{architecture,operations}.md` and `docs/security/database-security.md` with lifecycle, rollback asymmetry, threat ledger, no scheduler, and cross-slice commands; verify Unit 4.

Word count: 527.
