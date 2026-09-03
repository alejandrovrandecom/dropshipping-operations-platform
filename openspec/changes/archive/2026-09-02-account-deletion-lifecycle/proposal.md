# Proposal: Account Deletion Lifecycle

## Intent

Enable definitive, privacy-preserving deletion without orphaning team or launch data. No recovery exists; a same-email signup is a new identity with no restored data.

## Scope

### In Scope
- Gate requests until every owned team is transferred or pending deletion; transfers expire after seven days.
- Add an idempotent privileged finalizer with observable `pending`/`in-progress`/`done`/`failed` state, both invitation revocations, and auth/profile deletion.
- Keep only the permanent username reservation; delete email and `display_name`; retain a non-PII technical receipt, lazily purged past retention by later finalization runs (best-effort, not a fixed-window audit guarantee).
- Forward-migrate creator/actor FKs; keep live-team ownership restrictive.
- Add database-boundary tests and architecture/security documentation.

### Out of Scope
- Grace periods, recovery, or restoration of account/team/history data.
- UI for deletion or ownership transfer.
- Automatic scheduling infrastructure: follow-up `account-deletion-finalization-scheduler` will introduce pg_cron/pg_net/Vault and a service finalizer.

## Capabilities

### New Capabilities
- `account-deletion-lifecycle`: definitive requests, team resolution and transfers, idempotent finalization, invitation revocation, and non-PII retention.

### Modified Capabilities
- `identity-session-contracts`: definitive deletion and safe invitation/identity references through finalization.
- `launch-history`: retained events may have a null former-account initiator while preserving facts and order.

## Approach

Add request/transfer tables, authorization-safe SECURITY DEFINER RPCs, and historical FK `SET NULL` changes. On-demand finalization completes only unfinished steps, deletes PII/auth, and leaves the no-FK username reservation unavailable forever; same-email registration receives a fresh UUID identity.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `supabase/migrations/` | New | State tables, RPCs, revocation, and FK alters. |
| `src/modules/identity/` | Modified | Typed deletion and transfer interfaces. |
| `tests/database/`, `tests/isolation/` | New | State, retry, RLS, and attribution coverage. |
| `docs/database/`, `docs/security/database-security.md` | Modified | Schema and threat boundaries. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Archived identity/launch FK changes | High | New ALTER migration; restrictive team owner; path tests. |
| Partial failure or PII retention | Med | Idempotent state machine; assert only username survives. |
| Exceeds 400 changed lines | High | Chained schema, RPC/module, and docs/test PRs. |

## Rollback Plan

Use forward migrations to revoke grants or close paths; never edit archived migrations. Re-tightening FKs may fail after historical actors are null.

## Dependencies

- `username-reservation-contract`, `identity-session-contracts`, and archived `launch-workspace-core`.
- Future `account-deletion-finalization-scheduler` for automatic execution and expiry cleanup.

## Success Criteria

- [ ] Scheduling is denied until every owned team is resolved.
- [ ] Retried finalization safely deletes PII/auth and revokes both invitation scopes.
- [ ] History remains queryable without the former actor; username stays reserved.
