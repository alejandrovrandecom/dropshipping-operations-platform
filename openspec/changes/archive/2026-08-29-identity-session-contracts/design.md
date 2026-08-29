# Design: Identity Session Contracts

## Technical Approach

One new forward migration adds an `AFTER UPDATE OF email ON auth.users` trigger mirroring the persisted confirmed address into `profiles.email`, plus tests and docs proving the session-validity and team-local-cutoff requirements already enforced by live RLS. No application code, no new runtime surface, no privileged key.

Verified upstream (GoTrue `internal/api/user.go`, `verify.go`): a requested address goes to `auth.users.email_change`; `auth.users.email` is written only by `ConfirmEmailChange` after verification. Triggering on the persisted `email` column therefore *is* the confirmed-only contract.

## Architecture Decisions

| Decision | Choice | Alternatives rejected | Rationale |
|---|---|---|---|
| Sync mechanism | `after update of email on auth.users ... when (new.email is distinct from old.email)` | Extend `handle_new_user`; poll; sync inside `accept_invitation` | Migrations are immutable; `when` clause makes no-op writes free; keeps one writer |
| Privilege posture | `public.handle_user_email_change()`: `security definer`, `set search_path = ''`, refs schema-qualified, `revoke execute ... from public, anon, authenticated`, no grant | `security invoker` | `auth.users` triggers run as `supabase_auth_admin`, which holds no privilege on `public.profiles` (forced RLS). Definer + `postgres` `BYPASSRLS` is the only working path, and mirrors `handle_new_user` |
| Write shape | `update public.profiles set email = new.email where user_id = new.id` | `insert ... on conflict do update` | Account-local by predicate; cannot create or touch another account's row; a missing profile no-ops instead of resurrecting |
| Normalization | store `new.email` verbatim | `lower()` in the trigger | `accept_invitation` already compares `lower(p.email)`; normalizing here diverges from the insert path for no gain |
| Confirmed vs pending | no `email_confirmed_at` predicate | gate on `email_confirmed_at is not null` | Pending addresses never reach `auth.users.email`; the gate adds a stale-forever mode |

## Data Flow

    GoTrue verify ──→ auth.users.email (confirmed)
                            │ AFTER UPDATE OF email
                            ▼
            handle_user_email_change()  [definer, search_path='']
                            │ update ... where user_id = new.id
                            ▼
                    public.profiles.email ──→ accept_invitation() match

Pending change: GoTrue writes `email_change` only — no trigger, no profile write.

## File Changes

| File | Action | Description |
|---|---|---|
| `supabase/migrations/20260829120000_profile_email_sync.sql` | Create | Trigger function, trigger, revoke |
| `tests/support/local-stack.ts` | Modify | `tamperedToken(userId)` helper; factor JWT minting |
| `tests/isolation/rls.test.ts` | Modify | Tampered-signature denial; expired-JWT mutation/RPC denial; two-team removal cutoff |
| `tests/identity/invitations.test.ts` | Modify | Sync-then-match, previous-email denial, pending-change inertness |
| `tests/database/reproducibility.test.ts` | Modify | Function inventory row; body count 7 → 8 |
| `docs/database/architecture.md` | Modify | Functions/triggers row, migration ledger row, ERD label |
| `docs/security/database-security.md` | Modify | Session-validity boundary rows and enforced denials |

`src/lib/database.types.ts` is unchanged: trigger functions are absent from generated types (confirmed — neither `handle_new_user` nor `ensure_owner_membership` appears).

## Interfaces / Contracts

```sql
create function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where user_id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
after update of email on auth.users for each row
when (new.email is distinct from old.email)
execute function public.handle_user_email_change();
```

Reproducibility expectation added in alphabetical position:
`handle_user_email_change: secdef=true config=search_path="" acl=postgres=X/postgres`.

## Testing Strategy

`strict_tdd: true` — scenarios that add new behavior run RED first, while the two-team removal scenario is an approval/characterization test that pins pre-existing live-RLS behavior and is expected to pass when first added. Command: `pnpm test`; supplemental `pnpm db:smoke --require-runtime`.

| Scenario | Proof |
|---|---|
| Confirmed change updates profile | `sql()` sets `auth.users.email`; assert `profiles.email` |
| Unconfirmed request inactive | Set `email_change` only; `profiles.email` unchanged |
| Account-local | Second account's profile unchanged after the first syncs |
| Invitation matches new email | Sync, issue to new address, `accept_invitation` returns team |
| Previous email denied | Old-address invitation raises the uniform error; no membership |
| Anonymous denied | Existing `rls.test.ts:31-37` — no new test |
| Expired JWT denied | Extend existing case with a mutation and an RPC call |
| Tampered signature denied | New `tamperedToken` (valid `exp`, wrong HMAC): read and mutate denied |
| Removal cutoff | Same session, next request: read *and* mutate denied |
| Unrelated team survives | Dedicated two-team actors — `rls.test.ts:93-99` consumes the existing `member` |

Rejected: driving real GoTrue `verifyOtp`. Secure email change needs both tokens plus hash extraction and mail-capture coupling, and proves GoTrue, not our trigger.

## Threat Matrix

`references/threat-matrix.md` — **N/A**: no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary changes. Per `rules.design`, the denial paths are the Testing Strategy table above, all enforced at the database boundary.

Preserved invariants: `profiles` grants stay `select` + `update (display_name)`, so `profiles.email` stays unwritable by any client; `anon`/`PUBLIC` gain nothing; no policy, table, or column changes; no `service_role` or secret surface.

## Migration / Rollout

No data migration; already-stale rows self-heal on the next confirmed change. Rollback is a forward migration dropping only the trigger and function — profile values, RLS, and grants untouched, no session state to unwind.

**Forecast**: Pre-implementation estimate: ~120 changed lines; actual approved PR3 implementation + completion-delta slice: 207 changed lines, within the 400-line budget.

## Open Questions

- [ ] None blocking.
