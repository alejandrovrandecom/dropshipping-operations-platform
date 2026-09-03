# Tasks: Account Deletion Lifecycle

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 1,300–1,600; types excluded |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Five independently green stacked-to-main PRs, ≤400 each |
| Delivery strategy | ask-on-risk, resolved |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Types excluded; snapshots include them. No `size:exception`.

### Suggested Work Units

Each unit independently passes focused tests, `pnpm test`, and `pnpm db:smoke --require-runtime` on its prior base.

| Unit | Goal/base/size | Focused test | Exact rollback boundary |
|---|---|---|---|
| 1 | PR1 FK/history; 394 ✅ | `pnpm exec vitest run tests/database/{account-deletion-finalization,launch-history,reproducibility}.test.ts` | `20260902100000_account_deletion_fk_relaxation.sql`, tests/types |
| 2 | PR2a transfers; PR1; 190–260 | `pnpm exec vitest run tests/identity/account-deletion.test.ts tests/database/reproducibility.test.ts` | `20260902110000_account_deletion_transfers.sql`, inventory/types/tests |
| 3 | PR2b requests; PR2a; 190–270 | `pnpm exec vitest run tests/identity/account-deletion.test.ts tests/database/reproducibility.test.ts` | `20260902120000_account_deletion_requests.sql`, inventory/types/tests |
| 4 | PR3 finalization; PR2b; ≤400 | `pnpm exec vitest run tests/{database/account-deletion-finalization,isolation/account-deletion-rls,reproducibility}.test.ts` | `20260902130000_account_deletion_finalization.sql`, inventory/types/tests |
| 5 | PR4 API/docs; PR3; ≤400 | `pnpm exec vitest run tests/{identity/account-deletion,database/identity-module,reproducibility}.test.ts` | `src/modules/identity/{types,repository,service}.ts`, docs/tests |

## Phase 1: PR1 FK Foundation (complete)

- [x] 1.1 **RED:** Add `tests/database/account-deletion-finalization.test.ts` and extend `tests/database/launch-history.test.ts` for restrictive ownership, null actor/order, and outsider isolation.
- [x] 1.2 **GREEN:** Create `supabase/migrations/20260902100000_account_deletion_fk_relaxation.sql`; relax eight FKs; retain owner restriction/membership cascade.
- [x] 1.3 **REFACTOR/evidence:** Update `tests/database/reproducibility.test.ts` and `src/lib/database.types.ts`; `322f7e4` and `e709bd7` prove PR1.

> The 455-line combined attempt was carved: PR2a is below and green; PR2b is reconstructed from
> `design.md` and the combined evidence in `apply-progress.md`.

## Phase 2: PR2a Transfers

- [x] 2.1 **RED:** In `tests/identity/account-deletion.test.ts`, add `signIn(email, false)` cases for usernameless/cross-tenant denial, expiry, intended recipient, membership recheck, no-ownerless, and superseded offers.
- [x] 2.2 **GREEN:** Create `supabase/migrations/20260902110000_account_deletion_transfers.sql` with forced-RLS transfer table/index, offer/accept RPCs, 7-day expiry, re-offer supersede, membership recheck, and `team_ownership_transfers_require_username`.
- [x] 2.3 **REFACTOR/evidence:** Update transfer inventory (10→11) in `tests/database/reproducibility.test.ts`; regenerate `src/lib/database.types.ts`.

## Phase 3: PR2b Requests

- [ ] 3.1 **RED:** In `tests/identity/account-deletion.test.ts`, add `signIn(email, false)` cases for complete resolution, pending transfer, selected team, hidden self-only request, and usernameless denial.
- [ ] 3.2 **GREEN:** Create `supabase/migrations/20260902120000_account_deletion_requests.sql` with enum, forced-RLS requests/selections, request RPC, and `account_deletion_requests_require_username`.
- [ ] 3.3 **REFACTOR/evidence:** Update request inventory/trigger count (11→12) in `tests/database/reproducibility.test.ts`; regenerate `src/lib/database.types.ts`.

## Phase 4: PR3 Finalization

- [ ] 4.1 **RED:** Create `tests/isolation/account-deletion-rls.test.ts`: authenticated/non-owner/outsider/anon are denied on all 3 privileged RPCs; `has_function_privilege('authenticated', ...)` is false; failure discloses no deletion/tenant state.
- [ ] 4.2 **RED:** Extend `tests/database/account-deletion-finalization.test.ts` for states, team-before-identity, retry/idempotency, both revocations, PII removal, username survival, deleted session, re-signup, lazy non-PII receipt, and no scheduler.
- [ ] 4.3 **GREEN:** Create `supabase/migrations/20260902130000_account_deletion_finalization.sql` with service_role-only claim/finalize/status, retry, revocation, auth deletion, and lazy purge.
- [ ] 4.4 **REFACTOR/evidence:** Update finalizer inventories/grants/forward-revoke in `tests/database/reproducibility.test.ts` and types.

## Phase 5: PR4 Typed API and Ledger

- [ ] 5.1 **RED:** Extend `tests/database/identity-module.test.ts` and `tests/identity/account-deletion.test.ts` for typed authenticated wrappers and no `service_role` in `src/`.
- [ ] 5.2 **GREEN:** Extend only `src/modules/identity/{types,repository,service}.ts` with request/transfer APIs; preserve service → repository → DB and three files.
- [ ] 5.3 **REFACTOR/evidence:** Update `docs/database/{architecture,operations}.md`, `docs/security/database-security.md`, and cross-slice commands.

Word count: 528.
