# Proposal: Launch Workspace Core

## Intent

Deliver team-isolated, durable launches that members can prepare, activate, retain, and recover.

## Scope

### In Scope
- Team members create non-empty named launches in `preparing`, with database-enforced isolation.
- Closed lifecycle: eligible `preparing`→`active`, `preparing`→`discarded`, `active`→`archived`/`discarded`, `discarded`→`preparing`, non-trash→`trash`, and trash→exact prior state; archived launches cannot reopen.
- Explicit activation after snapshot eligibility; private templates, optional default, one editable template-derived snapshot, and selective append-only history.
- Recoverable trash; no individual permanent purge. Existing owner-only whole-team deletion is the sole destructive exception, cascading all team-owned launch, template, snapshot, and history data.
- Forward-only migrations, forced RLS, least privilege, and strict TDD/quality gates. Complete database-contract PR: explicit maintainer-approved `size:exception`; subsequent stacked-to-main PRs remain <=400 changed lines.

### Out of Scope
- `launch-workspace-ui` and any Next.js work.
- Account/profile deletion and its lifecycle concerns. Planned follow-up: `account-deletion-lifecycle`, after launch core exists.
- Soft-deleted teams, recovery windows, goals, galleries, Dropi ingestion, and analytics.

## Capabilities

### New Capabilities
- `launch-lifecycle`: Team-isolated launch lifecycle, recovery, and destructive boundaries.
- `launch-checklist-templates`: Private templates, optional default, and one editable launch snapshot.
- `launch-history`: Selective append-only, team-scoped launch history.

### Modified Capabilities
None.

## Approach

Add forward-only Supabase migrations for team-owned launch, template, snapshot, and event records. Use tenant keys, forced RLS, revoke-then-grant permissions, and narrow `SECURITY DEFINER` operations. Add a `src/modules/launch/` port and local-stack integration, isolation, and reproducibility evidence.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `supabase/migrations/<timestamp>_launch_workspace_core.sql` | New | Launch, template, snapshot, and history schema. |
| `src/modules/launch/` | New | Launch repository/service port. |
| `tests/database/`, `tests/isolation/`, database/security docs | Modified | Behavioral and security evidence. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Unauthorized cross-team access | Med | Forced RLS, tenant-bound foreign keys, least-privilege grants, and isolation tests. |
| Invalid lifecycle or snapshot mutation | Med | Closed transition checks, single-application constraints, and integration tests. |
| Oversized review slice | Med | Complete database-contract PR: explicit maintainer-approved `size:exception`; strict TDD/quality gates are not waived. Subsequent stacked-to-main PRs remain <=400 changed lines. |

## Rollback Plan

Disable new launch writes and ship forward-only corrections; never alter applied migrations. Preserve retained records; use controlled recovery only for a failed team-wide cascade.

## Dependencies

- Existing `profiles`, `teams`, and `memberships` foundations; local Supabase test stack.
- `account-deletion-lifecycle` depends on this launch core but is not part of this change.

## Success Criteria

- [ ] Tests prove allowed/denied transitions, activation eligibility, trash restoration, and archived-reopen denial.
- [ ] Tests prove template isolation, optional defaults, one editable snapshot, and selective immutable history.
- [ ] Tests prove team isolation, recoverability, no individual purge, and owner-only whole-team cascade deletion.
