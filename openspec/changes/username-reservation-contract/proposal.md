# Proposal: Username Reservation Contract

## Intent

Establish a username contract before `account-deletion-lifecycle`. Usernames survive profile and Auth deletion without email or full-profile data. Confirmed usernameless accounts cannot use protected writes.

## Scope

### In Scope
- Permanent, cascade-independent username registry; globally unique, immutable lowercase `[a-z0-9_]` names of 3–30 characters.
- Atomic one-time username claim with controlled rejection semantics, complete protected-write gating, and team-scoped member username resolution.
- Implementation remains within the 400-line review budget; local/test accounts may be recreated, with no legacy migration UX.

### Out of Scope
- Any frontend or user-visible onboarding screen; a future UI SDD change must run Impeccable `shape`.
- Account deletion implementation, global username directory, broad registry reads, and retention of email or profile data.

## Capabilities

### New Capabilities
- `username-reservation-contract`: Durable reservation, atomic claim, onboarding gate, and team-scoped username resolution.

### Modified Capabilities
- `identity-session-contracts`: Confirmed accounts without a username are restricted to claiming one; invitation, team, and membership writes require a claim.
- `launch-lifecycle`: Launch writes require a claimed username.
- `launch-history`: Launch-history-affecting writes require a claimed username.
- `launch-checklist-templates`: Template and snapshot writes require a claimed username.

## Approach

Add a forward Supabase migration with a constrained permanent registry and `SECURITY DEFINER` atomic claim RPC. Add a reusable claim predicate to every protected write, including `accept_invitation`; expose usernames only through a membership-scoped resolution RPC/view. Extend identity module RPC wrappers, database/security tests, and migration/security documentation.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `supabase/migrations/` | Modified | Registry, RPCs, grants, and protected-write gates |
| `src/modules/identity/` | Modified | Claim and team-scoped resolution use cases |
| `tests/{database,isolation,identity}/` | Modified | Atomicity, gating, and disclosure boundaries |
| `docs/{database,security}/` | Modified | Architecture, grants, and migration ledger |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Missed write-path bypass | Medium | Inventory and test every existing protected write |
| Global username disclosure | Medium | No registry `SELECT`; membership-scoped RPC/view only |
| Concurrent duplicate claim | Low | Constraint plus single atomic statement |

## Rollback Plan

Use a forward migration to revoke execution and remove gates. Do not drop the registry after claims: that destroys permanent reservations. Existing reservations remain durable.

## Dependencies

- Prerequisite for paused `account-deletion-lifecycle`.
- Existing `identity-session-contracts` database authorization foundation.
- Future UI/onboarding SDD change depends on this API contract.

## Success Criteria

- [ ] Valid confirmed accounts claim exactly one permanent username; invalid, duplicate, and repeat claims reject predictably.
- [ ] Every protected write denies usernameless accounts, including invitation, team, membership, and launch paths.
- [ ] Username resolution is available only to shared-team members and cannot enumerate the registry.
