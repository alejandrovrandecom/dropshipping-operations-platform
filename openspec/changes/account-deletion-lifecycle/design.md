# Design: Account Deletion Lifecycle

## Technical Approach

Deletion is a database contract, not a service. Probed on the stack: `auth.users` carries `postgres=ar*wdDxtm` in its ACL and `postgres` holds `BYPASSRLS`, so a definer function owned by `postgres` deletes the auth identity in ordinary SQL — no Admin API, no `pg_cron`. Also probed: while a team is owned, deletion fails `23503` on `teams_owner_user_id_fkey`; after team deletion plus FK relaxation it succeeds and `username_reservations` survives.

## Architecture Decisions

| Decision | Choice, over the rejected alternative | Rationale |
|---|---|---|
| Privileged principal and reader | `service_role` execute-only, not an admin role | It holds zero data privileges, and any authenticated reader would be an existence oracle. |
| Auth deletion | In-SQL `delete from auth.users`, not the Admin API | Privilege verified above; one transaction. |
| Durable `in_progress` | `claim` commits it, `finalize` works | A single RPC cannot expose an intermediate state. |
| Retry granularity | Per-step `begin/exception` blocks | Savepoints: a step-`k` failure keeps `1..k-1` applied and records `failed`. |
| Selected teams | Recorded at request, deleted at finalization | Spec orders team before owner identity; selections cascade off `teams`, so retry is a no-op. |
| Receipt | `account_deletion_requests`, **no** FK | Any referential action destroys a record that must outlive the account. |
| Username gate | `*_require_username` trigger per new table, same slice, not in-RPC checks | Baseline contract; definer RPCs bypass RLS, so only a trigger reaches every path. Inventory 10 → 12. |
| Re-offering a transfer | A new request deletes the standing unaccepted row | The partial index predicate cannot call `now()`, so an expired row would block re-offers forever. |
| Acceptance | Re-checks current membership | A member removed after the offer must not receive ownership. |
| Pending transfer | Blocks the request even for a team selected for deletion | Spec calls it unresolved. |
| Typed API | Only `authenticated` RPCs reach `src/` | Wrapping the finalizer would pull `service_role` into `src/`. |

## Data Flow

    gate: no live owned team, no pending transfer
       ↓
    request  ──→ requests(pending) + selections
    claim    ──→ in_progress
    finalize ──→ teams → invitations → auth.users
                 set null: 8 FKs; survives: reservations

## File Changes

Under `supabase/migrations/`, create in this exact order:

- `20260902100000_account_deletion_fk_relaxation.sql` — **created** in `322f7e4`: 8 FKs nullable + `set null`, `teams.owner_user_id` still `restrict`.
- `20260902110000_account_deletion_transfers.sql` — `team_ownership_transfers` (7-day expiry, partial unique pending index), both RPCs, `team_ownership_transfers_require_username`.
- `20260902120000_account_deletion_requests.sql` — enum, `account_deletion_requests`, `account_deletion_team_selections`, `request_account_deletion`, `account_deletion_requests_require_username`.
- `20260902130000_account_deletion_finalization.sql` — claim, finalize, status; `service_role` grants; lazy purge.

Modify `src/modules/identity/{types,repository,service}.ts` (three wrappers, 3-file shape kept) and regenerate `src/lib/database.types.ts`. Create `tests/{identity/account-deletion,isolation/account-deletion-rls,database/account-deletion-finalization}.test.ts`; extend `tests/database/{reproducibility,launch-history}.test.ts`; update `docs/database/{architecture,operations}.md` and `docs/security/database-security.md`. Each schema slice carries its own forced RLS, gate trigger, inventory update and types.

## Interfaces / Contracts

```sql
-- authenticated
request_team_ownership_transfer(p_team_id uuid, p_to_user_id uuid) returns uuid
accept_team_ownership_transfer(p_transfer_id uuid) returns uuid
request_account_deletion(p_delete_team_ids uuid[]) returns account_deletion_state
-- service_role only
claim_account_deletion(p_user_id uuid)    returns account_deletion_state
finalize_account_deletion(p_user_id uuid) returns account_deletion_state
account_deletion_status(p_user_id uuid)   returns account_deletion_state
```

Revocation: `delete` where `accepted_at is null and (invited_by = target or email = <profile email>)`, before the profile goes.

## Testing Strategy

Serial Vitest against the local stack; privileged RPCs driven through `sql()`.

- **Integration** — expiry, supersede, membership recheck, gating, retry, idempotency, both revocation scopes, re-signup.
- **Isolation** — unprivileged finalize/status, cross-tenant and unintended recipient, usernameless denial, null actor; uniform `42501` asserted by code **and** message.
- **Reproducibility** — inventories, per-slice trigger count (11 then 12), forward-revoke rollback.

Fixtures claim usernames, so gate tests MUST pass `signIn(email, false)`.

## Threat Matrix

Doc-like paths, git selection, commit state, push state and PR commands are each **N/A**: this change adds no file-classification, shell, subprocess or VCS boundary.

| Boundary | Applicability | Design response | Planned RED test |
|---|---|---|---|
| Privileged process integration (finalizer entry point) | **Applicable** — `service_role` is the only caller | Safe: it finalizes and reads status. Failure: every other role is refused identically, disclosing nothing. | `account-deletion-rls.test.ts` — `authenticated`, non-owner, outsider, `anon` denied on all three |

## Migration / Rollout

Forward-only, four migrations in filename order, delivered as five `stacked-to-main` slices, each independently green.

- **PR1** ✅ `322f7e4`, 394 lines — FK relaxation and history.
- **PR2a** ~190–260 — transfers migration, both RPCs, gate trigger, expiry/tenant tests.
- **PR2b** ~190–270 — requests migration, resolution gating, gate trigger; needs PR2a.
- **PR3** ≤400 — finalization, reserving gate and inventory lines.
- **PR4** ≤400 — typed API, docs, ledger.

Rollback revokes grants and `execute`; it MUST NOT drop `account_deletion_requests` or re-tighten a relaxed FK once a row holds a null actor.

## Open Questions

- [ ] (non-blocking) Operator reset for a stuck `in_progress` request — the deferred scheduler's concern.
- [ ] (non-blocking) Receipt expiry constant; the purge is best-effort, so any value works.
