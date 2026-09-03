# Tasks: Account Deletion Lifecycle

## Review Workload Forecast

Delivery: `ask-on-risk`; PR3b feature-branch-chain maintainer-chosen. Tracker `pr3b-finalizer` at `9a17fb1` alone targets `main`, post-children.

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

PR3a 415-line exception stands. Historical: the rejected 575-line candidate and its 480-line exception are source, not evidence. 3b-2/3b-3 lines are forecasts.

### Suggested Work Units

| Unit | Base | Child branch | PR target; lines | Focused; runtime `pnpm db:smoke --require-runtime`; evidence | Rollback boundary |
|---|---|---|---|---|---|
| 3b-1 spine | `pr3b-finalizer` at `9a17fb1` | `pr3b-1-spine` | `pr3b-finalizer`; 397 validated | `pnpm exec vitest run tests/{database/account-deletion-finalization,isolation/account-deletion-rls,database/reproducibility}.test.ts`; `pnpm test` | Revoke `execute` on and drop `finalize_account_deletion(uuid)`; revert named migration/test/type hunks. |
| 3b-2 revocation/halt | `pr3b-1-spine` tip | `pr3b-2-revocation-halt` | `pr3b-1-spine`; ~239 | `pnpm exec vitest run tests/{database/account-deletion-finalization,database/reproducibility}.test.ts`; `pnpm test` | Forward-replace 3b-1 body; revert `20260902145000_account_deletion_invitation_revocation.sql` hunks. |
| 3b-3 retention | `pr3b-2-revocation-halt` tip | `pr3b-3-retention` | `pr3b-2-revocation-halt`; ~185 | `pnpm exec vitest run tests/{database/account-deletion-finalization,database/reproducibility}.test.ts`; `pnpm test` | Drop retention trigger, then function; revert hunks. |

## Phase 1: PR1
- [x] 1.1 **RED:** `tests/database/{account-deletion-finalization,launch-history}.test.ts`: ownership, null actor/order, outsider denial.
- [x] 1.2 **GREEN:** `supabase/migrations/20260902100000_account_deletion_fk_relaxation.sql`: eight FKs; owner restriction.
- [x] 1.3 **REFACTOR/evidence:** `tests/database/reproducibility.test.ts`; `src/lib/database.types.ts`.

## Phase 2: PR2a Transfers
- [x] 2.1 **RED:** `tests/identity/account-deletion.test.ts`: `signIn(email, false)`, transfer boundaries, expiry, supersede.
- [x] 2.2 **GREEN:** `supabase/migrations/20260902110000_account_deletion_transfers.sql`: RPCs, RLS, expiry, username trigger.
- [x] 2.3 **REFACTOR/evidence:** Transfer inventory 10→11; types.

## Phase 3: PR2b Requests
- [x] 3.1 **RED:** `tests/identity/account-deletion.test.ts`: resolution, pending-transfer, selections, self-only, usernameless.
- [x] 3.2 **GREEN:** `supabase/migrations/20260902120000_account_deletion_requests.sql`: state, request/selections, RPC, username trigger.
- [x] 3.3 **REFACTOR/evidence:** Request inventory/trigger 11→12; types.

## Phase 4: PR3a Claims
- [x] 4.1 **RED:** Finalization/isolation: three claims, fourth refusal, four-caller status/claim denial.
- [x] 4.2 **GREEN:** `supabase/migrations/20260902130000_account_deletion_claim_ledger.sql`: attempts, status, bounded claim, grants.
- [x] 4.3 **REFACTOR/evidence:** Reproducibility inventories, forward revoke, types.

## Phase 5: PR3b-1 Spine
- [x] 5.1 **RED:** Finalization/isolation/reproducibility: service-role, guard/done, teams→identity, retry, session/name/re-signup, no scheduler; exclude invitations/retention.
- [x] 5.2 **GREEN:** `supabase/migrations/20260902140000_account_deletion_finalization.sql`: spine, grant, outcome, `src/lib/database.types.ts` hunk.
- [x] 5.3 **REFACTOR/evidence:** Focused/full/runtime results, mutation, inventory/forward-revoke, `...140000...` rollback.

## Phase 6: PR3b-2 Revocation/Halt
- [ ] 6.1 **RED:** In `tests/database/account-deletion-finalization.test.ts`, inject revocation failure: teams stand, profile/address/invitation remain, identity halts, then claim-and-retry completes both scopes.
- [ ] 6.2 **GREEN:** Create `supabase/migrations/20260902145000_account_deletion_invitation_revocation.sql` replacing the finalizer: revoke unaccepted issued/addressed invitations before identity; guard later steps with `if not step_failed`.
- [ ] 6.3 **REFACTOR/evidence:** Finalization/reproducibility hunks, focused/full/runtime results, mutation, forward-replace rollback.

## Phase 7: PR3b-3 Retention
- [ ] 7.1 **RED:** In finalization/reproducibility tests, preserve the threat case: “Cleanup aborting a MUST | 3b-3 trigger | swallowed in its block | injected fault; run `done`”; also prove no scheduler.
- [ ] 7.2 **GREEN:** Create `supabase/migrations/20260902150000_account_deletion_receipt_retention.sql` with `after update` done/failed trigger, revoked execute, swallowed sweep exception.
- [ ] 7.3 **REFACTOR/evidence:** Trigger/body inventories; cleanup cannot abort finalization; focused/full/runtime results, mutation, rollback.

## Phase 8: PR4 API/Docs (post-tracker; outside children)
- [ ] 8.1 **RED:** Extend `tests/database/identity-module.test.ts` and `tests/identity/account-deletion.test.ts` for authenticated wrappers, no `service_role` in `src/`.
- [ ] 8.2 **GREEN:** Extend only `src/modules/identity/{types,repository,service}.ts` with request/transfer APIs.
- [ ] 8.3 **REFACTOR/evidence:** Update `docs/database/{architecture,operations}.md`, `docs/security/database-security.md`.
