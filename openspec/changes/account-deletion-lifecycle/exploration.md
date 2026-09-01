## Exploration: account-deletion-lifecycle

### Current State

No account-deletion capability exists anywhere in the repository — no migration, module, test, or doc references it. PRODUCT.md does not mention it. This is a genuinely new surface, not an extension of an existing one.

**Identity/team foundation** (`supabase/migrations/20260828170000_identity.sql`, `20260828210000_team_invitations.sql`, `20260829120000_profile_email_sync.sql`):
- `profiles.user_id` → `auth.users.id` **on delete cascade**: deleting an `auth.users` row *would* cascade-delete `profiles`, but only if nothing else blocks it first.
- Every other identity/launch FK that points at `profiles.user_id` is **`on delete restrict`, not null**: `teams.owner_user_id`, `team_invitations.invited_by`, `team_invitations.accepted_by`, `launches.created_by`, `launch_checklist_templates.created_by`, `launch_checklist_template_items.created_by`, `launch_checklists.created_by`, `launch_checklist_items.created_by`, `launch_events.actor_user_id`.
- **Consequence (verified, not assumed)**: today, deleting any account that owns a team, was ever invited/accepted an invitation, or created/actor'd any launch record is impossible — the restrict FK aborts the whole transaction. Since `ensure_owner_membership` makes every team creator an owner immediately, and `launch_events.actor_user_id` is written on every lifecycle action, almost any active account already has at least one blocking reference.
- No team-ownership-transfer function exists. `teams.owner_user_id` is set once at insert (`default auth.uid()`) and is never updated by any RPC or grant — `update (name)` is the only client-writable column on `teams`.
- Whole-team deletion today is a direct client `.delete()` on `teams`, gated by `teams_delete_owner` RLS (`is_team_owner(id)`), cascading through every `on delete cascade` FK down to launch data. It removes the **team**, not the **owner's account** — the owner's profile is untouched.
- Invitation "revocation" today is a direct client `.delete()` on `team_invitations`, owner-only via RLS (`team_invitations_delete_owner`). There is no RPC for it and no system/non-owner-actor path.
- `handle_new_user()` inserts a profile keyed by the new `auth.users.id` (a fresh UUID per signup), not by email, and does `on conflict (user_id) do update`. Re-registering with a previously used email — once the old `auth.users` row is truly gone — naturally produces a brand-new, unrelated `profiles` row. This part of "same-email re-registration as a new identity" already falls out of the schema *if* the old account can actually be deleted.
- No `security definer` function in this repo is invoked by anything other than an authenticated RPC call or an `auth.users`/`teams` row-level trigger. Nothing runs on a schedule. `supabase/config.toml` has no `pg_cron`, `pg_net`, or Vault configuration — a scheduled finalization job would be the first of its kind here.
- `supabase/functions/send-invitation/` is the one existing Edge Function precedent, but it forwards the *caller's* JWT so the database still authorizes via the caller's session — it is not a service-authenticated, JWT-less pattern. A cron-triggered finalization function needs a different authority model (no live user session to check `is_team_owner` against).
- Retention conventions in this repo (`launch-lifecycle`, `launch-history` specs) are strictly "no individual purge, only whole-tenant cascade." A time-boxed 90-day purge of technical deletion records would be the first true time-based purge mechanism in the schema.
- `docs/database/architecture.md` and `docs/security/database-security.md` are updated in the same PR as any migration — that discipline must carry into this change.

### Affected Areas

- `supabase/migrations/` — new forward migration(s): account-deletion request table (state, scheduling, retry/failure tracking), team-ownership-transfer request table (7-day expiry, mirroring `team_invitations`), FK relaxation from `restrict` to a design that survives account deletion (nullable + `set null`, and/or a deleted-account alias table), invitation-revocation path usable by a system actor, and a scheduled-finalization mechanism.
- `supabase/config.toml` — would need `pg_cron`/`pg_net`/Vault (or equivalent) enabled if the previously-considered cron+net+Vault+Edge-Function approach is chosen; this is currently absent.
- `supabase/functions/` (new, conditional) — a service-authenticated finalization Edge Function, if that approach is chosen; no precedent for service-role-only (non-JWT-forwarding) functions exists yet.
- `src/modules/identity/` — likely home for account-deletion and ownership-transfer use cases (request, cancel, accept-transfer), mirroring the existing thin `types.ts`/`repository.ts`/`service.ts` shape.
- `docs/database/architecture.md`, `docs/security/database-security.md` — new ERD entries, table/function/grant rows, and new threat-boundary rows (deletion of an account mid-transfer, expired transfer, retry-after-partial-failure, revoked invitation reuse).
- `tests/database/`, `tests/isolation/` — new integration/RLS suites for deletion scheduling, transfer expiry, retry/failure blocking, and historical-attribution behavior after deletion.
- `openspec/specs/` — a new domain directory (naming TBD, e.g. `account-deletion-lifecycle`) since no baseline spec covers this yet; `identity-session-contracts` spec may also need a `MODIFIED` delta if profile/session behavior changes.

### Prior Decisions — Validated Against Current Code

| Prior decision | Status | Evidence |
|---|---|---|
| Transfer requests expire after 7 days | **Consistent, but net-new mechanism** | Matches the existing `team_invitations.expires_at` default (`now() + interval '7 days'`) exactly — a reasonable precedent to reuse — but no transfer table, RPC, or acceptance flow exists at all today. |
| Finalized account-deletion technical records retained 90 days | **Consistent in spirit, but net-new mechanism** | No table to retain and no purge mechanism of any kind exists in this schema. All current retention is "forever, no individual purge." A 90-day purge would be the first deviation from that pattern and needs its own justification and trigger (cron, or lazy-purge-on-next-run). |
| Nullable creator/actor FKs plus immutable deleted-account aliases | **Directly contradicted by current schema — real gap, not a style choice** | Every creator/actor FK is `not null ... on delete restrict` today. Making account deletion possible requires actively loosening at least 7 FKs (`team_invitations.invited_by/accepted_by`, `launches.created_by`, `launch_checklist_templates.created_by`, `launch_checklist_template_items.created_by`, `launch_checklists.created_by`, `launch_checklist_items.created_by`, `launch_events.actor_user_id`) — `teams.owner_user_id` most likely stays `restrict` since a live team must always have a live owner, which is exactly why ownership transfer/resolution has to happen *before* scheduling. |
| Supabase-native pg_cron + pg_net + Vault + service-authenticated Edge Function | **Plausible but unconfigured** | No extension, secret, or function of this shape exists yet. `send-invitation` is the closest precedent but forwards the caller's JWT rather than acting as a service principal — the authorization model for a cron-triggered finalizer is genuinely new territory here. |
| Profile-deletion-time alias freezing for atomicity | **Plausible, matches repo's transactional style** | Every existing multi-step write here (e.g., `transition_launch`, `apply_checklist_template`) commits its state change and its event atomically in one function. Freezing an alias in the same transaction as nulling FKs and deleting the profile fits that established pattern well. |

### Approaches

1. **In-database scheduled finalization (pg_cron + pg_net + Vault + service Edge Function)**
   - Description: A `security definer` RPC records a deletion request (after teams are resolved) and a transfer-request table with 7-day expiry; `pg_cron` periodically calls a service-authenticated Edge Function (via `pg_net` + a Vault-stored service key) that finalizes due requests: freezes aliases, nulls actor/creator FKs, deletes the `auth.users` row via the Admin API, revokes lingering invitations, and records retry/failure state.
   - Pros: Matches the previously-considered design; keeps finalization server-side and auditable; reuses Supabase-native primitives instead of an external scheduler; the local stack can run it too (testable end-to-end).
   - Cons: First use of `pg_cron`/`pg_net`/Vault in this repo — new extensions, new config, new secret-handling surface, and a new class of test (asserting a cron-driven side effect deterministically in a serial integration suite is harder than asserting an RPC's direct return value). Requires solving "who authorizes a cron-fired call" from scratch.
   - Effort: High.

2. **RPC-scheduled, manually-triggered finalization (no cron; a privileged finalize RPC callable by a trusted job runner or admin action)**
   - Description: Same request/transfer tables and FK loosening as Approach 1, but finalization is a `security definer` function invoked on-demand (e.g., by an external scheduler outside Postgres, or a manually-run maintenance command) rather than `pg_cron`. Retry/failure state is still tracked in the table so a re-run is idempotent.
   - Pros: Avoids introducing `pg_cron`/`pg_net`/Vault into this repo at all; finalization logic and its tests stay fully inside the existing "call an RPC, assert the result" pattern already proven for `create_launch`/`transition_launch`; smaller, more reviewable migration surface.
   - Cons: Punts "who/what actually triggers finalization on schedule" to infrastructure outside this repo (a hosted cron, GitHub Action, etc.) that does not yet exist and is not this change's concern to build — could leave a real product gap if not explicitly named as a dependency.
   - Effort: Medium.

3. **Immediate finalization (no scheduling/grace period at all)**
   - Description: Deletion is finalized synchronously in the same request once teams are resolved and invitations revoked — no request table, no 7-day transfer window, no retry/failure state.
   - Pros: Simplest possible schema; no new scheduling infrastructure of any kind.
   - Cons: **Contradicts explicit product context** ("scheduled finalization, retry/failure blocking" and "transfer requests expire after 7 days" are both prior-decided). Not a real option given the stated requirements — included only to show it was considered and rejected.
   - Effort: Low, but out of scope per confirmed product context.

### Recommendation

Approach 2 (RPC-scheduled finalization, cron left as an explicit external dependency) as the default unless the user confirms `pg_cron`/`pg_net`/Vault should be adopted now. Reasoning: this change already carries substantial, genuinely new schema risk (loosening 7 restrict FKs across two prior migrations' worth of tables, designing the alias-freezing shape, and the transfer-request flow) — bundling a first-ever cron/Vault/service-Edge-Function stack into the same change conflates two large risk classes the same way `launch-workspace-core`'s exploration flagged for UI-vs-schema. If the user explicitly wants in-database scheduling now, Approach 1 is technically sound and reuses Supabase-native primitives correctly — it should simply be a deliberate, named decision, not a default.

### Risks

- **FK-loosening blast radius**: 7 FKs across the identity and launch-workspace-core migrations must be altered (`restrict` → `set null` and nullable, or repointed to an alias). This touches tables introduced by an *already-archived* change; the new migration must ALTER, not edit, those files.
- **Alias/PII exposure**: freezing `email`/`display_name` into an alias at deletion time means that data outlives the deleted account. Needs an explicit decision on what is frozen (display name only vs. email too) and whether the alias itself is ever purged — privacy-sensitive and currently undecided.
- **Ownership-resolution correctness**: "resolution/transfer of all owned teams before scheduling" implies deletion scheduling must be blocked while any owned team lacks a resolved successor or pending cascade-delete — the exact blocking predicate (all teams transferred? all teams either transferred or deleted? partial resolution allowed?) is not yet specified and directly gates whether scheduling can start.
- **Cron/Vault authority model (if Approach 1)**: no existing precedent in this repo for a privileged action authorized by anything other than a live caller JWT or an `auth.users`/`teams` trigger. Getting this wrong risks either an unauthenticated finalize path or an untestable one.
- **Retry/failure blocking semantics undefined**: "retry/failure blocking" needs a concrete state machine (how many retries, backoff, what "blocking" prevents — re-scheduling? re-login? new transfer requests?) before migration authoring.
- **Interaction with existing whole-team deletion**: today, deleting a team does not touch the owner's profile at all. Account deletion must decide whether "resolve owned teams" means transfer-only, delete-or-transfer, and how that composes with the *existing*, already-shipped `teams_delete_owner` cascade path without duplicating logic.
- **Retention purge is a first**: no purge-after-N-days mechanism exists anywhere in this schema; needs its own trigger (cron, lazy-check-on-next-finalize-run, etc.) decided alongside Approach 1 vs. 2.

**Rollback boundary**: consistent with this repo's forward-only convention (`docs/database/operations.md`) — closing this surface later means a new migration that revokes the new grants/execute privileges, not editing or dropping tables. Because this change also *loosens* existing restrict FKs on already-shipped tables, rollback of the FK change itself (re-tightening to `restrict`) would need its own forward migration and could fail if any row already has a null actor/creator by then — this is a stronger rollback constraint than any prior change in this repo has had to consider.

**Dependencies**: `launch-workspace-core` (archived; provides the launch/template/checklist/history tables whose FKs this change must alter) and the existing `identity-session-contracts` foundation (`profiles`, `teams`, `memberships`, `team_invitations`). No other in-flight change conflicts.

### Ready for Proposal

No. This needs an interactive product-question round before `sdd-propose` runs, specifically on: (1) the exact team-resolution predicate that gates scheduling, (2) what alias data is frozen and whether it is ever purged, (3) retry/failure state machine shape, (4) whether Approach 1 (cron/pg_net/Vault) is adopted now or deferred with an explicit follow-up name, and (5) whether "invitation revocation" means invitations *issued by* the deleting account, invitations *addressed to* the deleting account's email, or both.
