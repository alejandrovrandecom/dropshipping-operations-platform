# Design: Account Deletion Lifecycle

## Technical Approach

Deletion is a database contract, not a service. Probed on the running stack: `auth.users` carries `postgres=ar*wdDxtm` in its ACL and `postgres` holds `BYPASSRLS`, so a `security definer` function owned by `postgres` deletes the auth identity in ordinary SQL — no Admin API, no `pg_cron`. The probe also fixed the blocking edge: deletion fails `23503` on `teams_owner_user_id_fkey` while a team is owned; after team deletion plus FK relaxation it succeeds, `profiles` cascades away, and `username_reservations` survives.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Privileged principal | `service_role` execute-only | New admin role | Zero data privileges already, key server-side-only, `reproducibility.test.ts` forbids it in `src/`. An admin role is a product decision this change does not own. |
| Observability | Same principal, reader RPC | Owner-readable status | Denial must hide deletion *and* tenant state; any authenticated reader is an existence oracle. |
| Auth deletion | In-SQL `delete from auth.users` | Admin API call | Privilege verified above; keeps the contract in one transaction. |
| Durable `in_progress` | Two RPCs — `claim` commits it, `finalize` works | One RPC | One transaction cannot expose an intermediate state, and plpgsql has no autonomous commit. |
| Retry granularity | Each destructive step in its own `begin/exception` block | One outer handler | Those blocks are savepoints: a step-`k` failure keeps `1..k-1` applied and records `failed`. |
| Selected teams | Recorded at request, deleted at finalization | Deleted at request | Spec orders the team before its owner identity; selections cascade off `teams`, so retry is a no-op. |
| Receipt | `account_deletion_requests`, **no** foreign key | FK to `profiles` | The registry's reasoning: any referential action destroys a record that must outlive the account. UUID, state and timestamps only. |
| Typed API | Only the `authenticated` RPCs reach `src/` | Wrapping the finalizer | A wrapper would pull `service_role` into the client tree. |

## Data Flow

    request ──→ requests(pending) + selections
       ▲ gate: no live owned team, no pending transfer
    claim ──→ in_progress ──→ finalize: teams → invitations → auth.users
                                   │  set null: 8 historical FKs
                                   └──survives: username_reservations

## File Changes

| File | Action | Description |
|---|---|---|
| `supabase/migrations/20260902100000_account_deletion_fk_relaxation.sql` | Create | 8 FKs (6 launch `created_by`/`actor_user_id`, `team_invitations.invited_by`/`.accepted_by`) made nullable + `set null`. `teams.owner_user_id` stays `restrict`, `memberships.user_id` `cascade`. |
| `supabase/migrations/20260902110000_account_deletion_state.sql` | Create | State enum; `account_deletion_requests`, `account_deletion_team_selections`, `team_ownership_transfers` (7-day expiry, partial unique pending index); forced RLS, no policy, no grant; request/transfer RPCs. |
| `supabase/migrations/20260902120000_account_deletion_finalization.sql` | Create | Claim, finalize, status; `service_role` grants; lazy purge. |
| `src/modules/identity/{types,repository,service}.ts`, `src/lib/database.types.ts` | Modify | Three typed wrappers; 3-file shape and inward direction preserved; regenerated types. |
| `tests/identity/account-deletion.test.ts`, `tests/isolation/account-deletion-rls.test.ts`, `tests/database/account-deletion-finalization.test.ts` | Create | Gating and transfers; denial and tenant hiding; retry, idempotency, privacy, re-signup. |
| `tests/database/{reproducibility,launch-history}.test.ts` | Modify | Inventories and rollback proof; null-actor attribution. |
| `docs/database/{architecture,operations}.md`, `docs/security/database-security.md` | Modify | Ledger, rollback asymmetry, threat rows. |

## Interfaces / Contracts

```sql
-- authenticated
request_account_deletion(p_delete_team_ids uuid[]) returns public.account_deletion_state
request_team_ownership_transfer(p_team_id uuid, p_to_user_id uuid) returns uuid
accept_team_ownership_transfer(p_transfer_id uuid) returns uuid
-- service_role only
claim_account_deletion(p_user_id uuid)    returns public.account_deletion_state
finalize_account_deletion(p_user_id uuid) returns public.account_deletion_state
account_deletion_status(p_user_id uuid)   returns public.account_deletion_state
```

Revocation: `delete` where `accepted_at is null and (invited_by = target or email = <target profile email>)`, before profile deletion.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Integration | Gating, transfer expiry, retry after partial failure, done-idempotency, both revocation scopes, re-signup, receipt purge | Serial Vitest on the local stack; privileged RPCs driven through `sql()` |
| Isolation | Unprivileged finalize/status denial, cross-tenant transfer, null-actor history | Uniform `42501`, asserted by code **and** message |
| Reproducibility | Inventories, forward-revoke rollback | Extend `INVENTORY`; abort-block proof |

Triangulation: acceptance asserts the *named* successor, not a changed owner.

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED test |
|---|---|---|---|
| Documentation-like paths; git repository selection; commit state; push state; PR commands | N/A — no file-classification, shell, subprocess or VCS/PR automation boundary | — | — |
| Privileged process integration (finalizer entry point) | **Applicable** — `service_role` is the only caller | Safe: it finalizes and reads status. Failure: every other role is refused identically, disclosing nothing. | `account-deletion-rls.test.ts` — `authenticated`, non-owner, outsider and `anon` denied on all three RPCs; `has_function_privilege('authenticated', ...)` false |

## Migration / Rollout

Forward-only, three migrations in filename order. Rollback revokes grants and `execute`; it MUST NOT drop `account_deletion_requests` or re-tighten a relaxed FK once a row holds a null actor.

## Open Questions

- [ ] (non-blocking) Whether a stuck `in_progress` request needs an operator reset RPC — the deferred scheduler's concern.
- [ ] (non-blocking) Receipt expiry constant; the purge is best-effort, so any value works.
