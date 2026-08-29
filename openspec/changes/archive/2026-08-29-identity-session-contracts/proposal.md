# Proposal: Identity Session Contracts

## Intent

Synchronize invitation identity matching after a confirmed Supabase email change and formalize session validity. A removed member loses only that team's data access on the next request.

## Scope

### In Scope
- Add a forward migration synchronizing `profiles.email` after Supabase confirms and updates `auth.users.email`; never edit applied migrations.
- Specify and prove live-RLS session validity: anonymous, expired, and signature-tampered JWTs are denied; removal immediately denies only that team's data.
- Prove invitation matching after synchronization and update database/security documentation.

### Out of Scope
- Forced session revocation, custom session tables, Auth Admin/service-role flows, or new identity APIs.
- Frontend recovery pages/emails, device/current/all-device sign-out, and remembered-login UX. **Follow-up:** define these flows and revocation policy before implementation.
- A combined “who am I / my teams and roles” read contract. **Follow-up:** define its response and authorization when a frontend consumer exists.
- Additional login rate limiting or lockout beyond Supabase defaults; production email-provider setup.

## Capabilities

### New Capabilities
- `identity-session-contracts`: Profile-email synchronization and database-enforced session-validity requirements.

### Modified Capabilities
None — `openspec/specs/` has no baseline capability specs.

## Approach

Add an `auth.users` email-update trigger in a new migration. Preserve RLS, grants, and live membership checks; use serial local-Supabase tests, not session-management code.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `supabase/migrations/` | New | Forward email-sync trigger migration. |
| `tests/isolation/rls.test.ts` | Modified | Session and removal proofs. |
| `tests/identity/invitations.test.ts` | Modified | Email-sync invitation proof. |
| `docs/database/architecture.md` | Modified | Migration and trigger inventory. |
| `docs/security/database-security.md` | Modified | Session-validity boundary. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Email sync runs before confirmation | Low | Trigger on persisted `auth.users.email`; test it. |
| Session scope expands into revocation UX | Medium | Keep revocation and frontend requirements explicitly deferred. |
| Authorization regression | Low | Preserve and test live RLS isolation. |

## Rollback Plan

Ship a forward rollback migration removing only the email-sync trigger/function. Profile values and RLS remain intact; no session state exists to unwind.

## Dependencies

- Local Supabase Auth and the serial Vitest integration harness.

## Delivery Decision

`delivery_strategy` is resolved to chained PRs with `chain_strategy: stacked-to-main`. No `size:exception` is approved; each PR has a 400-line maximum.

| Order | Logical slice | Exact changed lines |
|---:|---|---:|
| 1 | OpenSpec bootstrap + exploration + proposal | 308 |
| 2 | Durable baseline spec + archived delta spec, design, and tasks | 313 |
| 3 | Implementation + completed task-checkbox delta | 222 |
| 4 | Apply, verification, and archive evidence | 314 |

All four PRs target `main` and merge in order: PR 1 → PR 2 → PR 3 → PR 4.

## Success Criteria

- [ ] Confirmed email changes synchronize `profiles.email` and permit matching invitations.
- [ ] Invalid sessions are denied; removal blocks only the removed team without global sign-out.
- [ ] RLS isolation remains proven within the 400-line review budget.
