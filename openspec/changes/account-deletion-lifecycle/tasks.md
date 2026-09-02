# Tasks: Account Deletion Lifecycle

## Review Workload Forecast

Estimated authored changed lines: ~1,530; generated types excluded.
Suggested split: six stacked-to-main slices: PR1 → PR2a → PR2b → PR3a → PR3b → PR4.
Delivery strategy: ask-on-risk, resolved.

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Types excluded; snapshots include them. No `size:exception` is planned.
Combined PR3 evidence (399-line green; `sha256:c3cf34b070a4ad783f46b0cc1e910337d8e35f8a9a185607e08e508441db7e1b`) remains historical/failed: no retry bound. It will be re-carved across pending Phase 4 (PR3a) and Phase 5 (PR3b).

### Suggested Work Units

Each pending unit independently runs its listed focus, full `pnpm test`, and runtime `pnpm db:smoke --require-runtime` on its base.

| Unit | Goal/base/estimate | Focused test | Rollback boundary |
|---|---|---|---|
| PR3a | claim ledger; PR2b `6c7befa`; ~250 | `pnpm exec vitest run tests/{database/account-deletion-finalization,isolation/account-deletion-rls,reproducibility}.test.ts` | `20260902130000_account_deletion_claim_ledger.sql`, its hunks/types |
| PR3b | finalizer; PR3a; ~240 | same as PR3a | `20260902140000_account_deletion_finalization.sql`, its hunks/types |
| PR4 | typed API/docs; PR3b; ≤400 | `pnpm exec vitest run tests/{identity/account-deletion,database/identity-module,reproducibility}.test.ts` | identity module, docs, and their tests |

## Phase 1: PR1 FK Foundation

- [x] 1.1 **RED:** Add `tests/database/account-deletion-finalization.test.ts` and extend `tests/database/launch-history.test.ts` for restrictive ownership, null actor/order, and outsider isolation.
- [x] 1.2 **GREEN:** Create `supabase/migrations/20260902100000_account_deletion_fk_relaxation.sql`; relax eight FKs; retain owner restriction/membership cascade.
- [x] 1.3 **REFACTOR/evidence:** Update `tests/database/reproducibility.test.ts` and `src/lib/database.types.ts`; `322f7e4` and `e709bd7` prove PR1.

## Phase 2: PR2a Transfers

- [x] 2.1 **RED:** In `tests/identity/account-deletion.test.ts`, add `signIn(email, false)` cases for usernameless/cross-tenant denial, expiry, intended recipient, membership recheck, no-ownerless, and superseded offers.
- [x] 2.2 **GREEN:** Create `supabase/migrations/20260902110000_account_deletion_transfers.sql` with forced-RLS transfer table/index, offer/accept RPCs, 7-day expiry, re-offer supersede, membership recheck, and `team_ownership_transfers_require_username`.
- [x] 2.3 **REFACTOR/evidence:** Update transfer inventory (10→11) in `tests/database/reproducibility.test.ts`; regenerate `src/lib/database.types.ts`.

## Phase 3: PR2b Requests

- [x] 3.1 **RED:** In `tests/identity/account-deletion.test.ts`, add `signIn(email, false)` cases for complete resolution, pending transfer, selected team, hidden self-only request, and usernameless denial.
- [x] 3.2 **GREEN:** Create `supabase/migrations/20260902120000_account_deletion_requests.sql` with enum, forced-RLS requests/selections, request RPC, and `account_deletion_requests_require_username`.
- [x] 3.3 **REFACTOR/evidence:** Update request inventory/trigger count (11→12) in `tests/database/reproducibility.test.ts`; regenerate `src/lib/database.types.ts`.

## Phase 4: PR3a Claim Ledger

- [ ] 4.1 **RED:** Extend `tests/database/account-deletion-finalization.test.ts` for `pending`/`failed` claims: exactly three executions (initial + two retries), fourth refused, and no finalize surface in this slice; add `tests/isolation/account-deletion-rls.test.ts` denial for status/claim to anon, authenticated, non-owner, and outsider.
- [ ] 4.2 **GREEN:** Create `supabase/migrations/20260902130000_account_deletion_claim_ledger.sql` with `attempts`, `account_deletion_status`, bounded `claim_account_deletion`, and service_role-only grants.
- [ ] 4.3 **REFACTOR/evidence:** Update claim/status inventories, grant and forward-revoke checks in `tests/database/reproducibility.test.ts`; regenerate `src/lib/database.types.ts`.

## Phase 5: PR3b Finalizer

- [ ] 5.1 **RED:** Extend finalization/isolation tests for service_role-only finalizer; team-before-identity, both invitation scopes, PII removal, username survival/session invalidation, same-email new identity, idempotent retry continuation, non-PII receipt/lazy purge/no scheduler, and uniform denial.
- [ ] 5.2 **GREEN:** Create `supabase/migrations/20260902140000_account_deletion_finalization.sql` with service_role-only `finalize_account_deletion`, ordered deletion, scoped revocation, and lazy purge.
- [ ] 5.3 **REFACTOR/evidence:** Update finalizer inventory, grant/forward-revoke and isolation evidence in `tests/database/reproducibility.test.ts`; regenerate `src/lib/database.types.ts`.

## Phase 6: PR4 Typed API and Ledger

- [ ] 6.1 **RED:** Extend `tests/database/identity-module.test.ts` and `tests/identity/account-deletion.test.ts` for typed authenticated wrappers and no `service_role` in `src/`.
- [ ] 6.2 **GREEN:** Extend only `src/modules/identity/{types,repository,service}.ts` with request/transfer APIs; preserve service → repository → DB and three files.
- [ ] 6.3 **REFACTOR/evidence:** Update `docs/database/{architecture,operations}.md`, `docs/security/database-security.md`, and cross-slice commands.
