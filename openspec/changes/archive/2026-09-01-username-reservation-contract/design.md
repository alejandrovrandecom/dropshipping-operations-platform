# Design: Username Reservation Contract

## Technical Approach

Two forward migrations, three stacked-to-main PRs, each independently green. Migration 1 adds the cascade-free registry and atomic `claim_username`; migration 2 adds `has_username()`, `BEFORE ... FOR EACH STATEMENT` gate triggers, and the team-scoped resolver. Splitting the schema lets each PR close its own catalog inventory. Triggers, not policies, carry the gate: `postgres` holds `BYPASSRLS`, so RLS cannot reach existing `SECURITY DEFINER` RPC writes. Backend only, no UI; specs and behavior unchanged.

## Architecture Decisions

| Decision | Choice and rationale |
|---|---|
| Delivery shape | Two migrations, three PRs. One migration measured 412 authored lines with 6 reproducibility failures; `size:exception` was rejected, and deferring inventories breaks independent-green policy. |
| Types cadence | Regenerate `src/lib/database.types.ts` in PR1 and PR2, not PR3. `reproducibility.test.ts:156` byte-compares committed types against generated output, so a schema PR without regeneration is red by construction. PR3 owns only the hand-authored API. Generated types stay outside the authored count, inside snapshot identity. |
| Registry linkage | `user_id uuid not null unique`, no FK. `restrict` blocks deletion, `set null` destroys attribution, a `profiles` column cascades away. Claim validity comes from `auth.uid()`. |
| Gate mechanism | Statement-level `BEFORE` triggers. Replacing 7 RPC bodies costs ~200 review lines and leaks a bypass per new RPC; widening `is_team_member` breaks reads and resolution. |
| Non-JWT callers | Gate no-ops when `auth.uid()` is null. `postgres` and `service_role` bypass RLS anyway, `anon` holds no privilege, and an unconditional raise breaks `handle_new_user`. |
| Immutability | No `update` or `delete` policy or grant; the RPC only inserts. Matches the repo's closed-by-default pattern. |
| Rejection contract | One message for taken or already-claimed, a distinct one only for format. Availability and account state are protected facts; format is caller-computable. |
| Resolver | `resolve_team_usernames(team_id)`, empty set for non-members. No registry `select` grant means no enumeration, and an empty set is no existence oracle. |

## Delivery Slices

**PR1** — `20260901120000_username_reservation.sql` with `tests/identity/username-reservation.test.ts`.
Objects: `username_reservations` (forced RLS, no policy, no grant) and `claim_username`.
Proofs: format, normalization, one-per-account, concurrency winner, deletion survival, enumeration denial.
Catalog: table, RLS, grant, constraint and index rows; definer bodies 13→14.
Rollback: revoke `execute`; never drop the table.

**PR2** — `20260901130000_username_gate.sql` with `tests/isolation/username-gate.test.ts`.
Objects: `has_username`, `enforce_username_claim`, 10 triggers, `resolve_team_usernames`.
Proofs: per-surface denial, no side effects, concurrency, resolver scope, anon.
Catalog: definer bodies 14→17, plus a new trigger inventory.
Rollback: drop the triggers and revoke `execute`, restoring pre-gate behavior exactly. Symmetric.

**PR3** — no migration. Identity typed API in `src/modules/identity/{types,repository,service}.ts` (no new file; the module test pins a 3-file list), documentation, cross-slice evidence. Rollback: revert module and docs.

Each PR targets `main` after its predecessor merges and forecasts ≤400 authored lines. The existing 269-line suite splits on the repo's own axis, behavior in `tests/identity/` and boundary in `tests/isolation/`; `local-stack.ts` (+19/-3) lands in PR1. `tests/database/reproducibility.test.ts` is edited by PR1 and PR2, each closing its own inventories. Docs updated in PR3: `docs/database/architecture.md`, `docs/security/database-security.md`, `docs/database/operations.md`, including two ledger rows.

## Gate Inventory (PR2, every existing protected write)

`profiles` update of `display_name` (email sync untouched); `teams` insert, update, delete; `memberships` insert, delete; `team_invitations` insert, update, delete; `launches` insert, update; `launch_checklist_templates` and `_template_items` insert, update; `launch_checklists`, `launch_checklist_items` and `launch_events` insert, update.

## Interfaces

```sql
create table public.username_reservations (
  username text primary key check (username ~ '^[a-z0-9_]{3,30}$'),
  user_id uuid not null unique,          -- deliberately no foreign key
  claimed_at timestamptz not null default now());
claim_username(p_username text) returns text  -- lower(btrim()), one insert ... on conflict do nothing
resolve_team_usernames(p_team_id uuid) returns table (user_id uuid, username text)  -- PR2
```

Codes: `42501` gate denial; `22023` invalid format or refused claim.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Denial paths appear above per `rules.design`.

## Migration / Rollout

Both migrations order after `20260829170000_launch_workspace_core`. Preproduction adoption is `pnpm db:reset` plus recreated accounts; no backfill. Rollback asymmetry is isolated to PR1: PR2 is fully reversible, and the registry MUST NOT be dropped once claimed.

## Handoff

`account-deletion-lifecycle` depends on PR1 alone, the registry being the durable attribution. It MUST NOT add an FK to `user_id` and MUST NOT delete reservation rows.

## Open Questions

- [ ] None blocking.
