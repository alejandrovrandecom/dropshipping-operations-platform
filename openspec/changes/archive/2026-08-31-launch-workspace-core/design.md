# Design: Launch Workspace Core

## Technical Approach

One forward-only migration, `20260829170000_launch_workspace_core.sql`, adds two enums, six team-owned tables and five RPCs, mirroring `20260828170000_identity.sql`: force RLS, `revoke all`, column grants, `security definer` RPCs (`search_path=''`). Sole door: `src/modules/launch/repository.ts`. PostgreSQL 17.

## Architecture Decisions

|Choice|Rejected|Rationale|
|---|---|---|
|Roots `launches`/`templates` cascade from `teams`; descendants via `(team_id,parent_id)→parent(team_id,id)`|all-tables-from-`teams`; single-column FKs|One tenant-bound deletion path; no cross-tenant parent|
|State/history/snapshot/default mutate only via locked RPCs and a partial unique index|event triggers|Triggers scatter rules and race; RPCs serialize atomically|
|`trash` is a status with `prior_status`; separate `restore_launch`|delete-and-recreate|Prior state recoverable; purge has no path|
|One complete migration in PR1 under a maintainer-approved `size:exception`|staged partial migrations|Any split merges incomplete database behavior (revoked tables, fail-closed transitions); the exception buys review size, never test order or gates|

## Delivery Units

Three stacked-to-main PRs, each independently green, RED→GREEN→REFACTOR. The applied migration is never edited.

|PR|Scope|Budget|
|---|---|---|
|1|Strict RED for all 49 current scenarios plus reproducibility/isolation; then the one complete migration; regenerate and commit `src/lib/database.types.ts`; GREEN DB/isolation/reproducibility tests, runtime smoke, and `docs/database/{architecture,operations}.md`, `docs/security/database-security.md`|`size:exception`, maintainer-approved|
|2|RED module tests, then `src/modules/launch/{types,repository,service}.ts` GREEN/REFACTOR|≤400|
|3|Final delivery: repeat full serial suite, smoke and rollback evidence; reconcile OpenSpec evidence and create the final SDD evidence artifacts|≤400|

## Data Flow

    grants → launches(name,url,notes), items(label,is_required,position,is_complete)
    RPCs → status/prior_status, launch_checklists+items, launch_events append

## File Changes

|File|Action|PR|
|---|---|---|
|`supabase/migrations/20260829170000_launch_workspace_core.sql`, `src/lib/database.types.ts`|Create|1|
|`tests/database/launch-{lifecycle,templates,history,retention}.test.ts`, `tests/isolation/launch-rls.test.ts`|Create|1|
|`tests/database/reproducibility.test.ts`|Modify|1|
|`src/modules/launch/{types,repository,service}.ts`, `tests/database/launch-module.test.ts`|Create|2|
|`docs/database/{architecture,operations}.md`, `docs/security/database-security.md`|Modify|1|

## Interfaces / Contracts

Five tables use `id uuid primary key default gen_random_uuid()`: `launches`,`launch_checklist_templates`,`launch_checklist_template_items`,`launch_checklists`,`launch_checklist_items`. `launch_events` uses `seq bigint generated always as identity primary key`, monotonic and tie-free.

```
all six   created_at timestamptz not null default now(); team_id uuid not null
five ids  created_by uuid not null default auth.uid()→profiles(user_id) restrict;
  unique(team_id,id) on launches,templates,launch_checklists
nonblank = text not null check (btrim(c)<>'' and length(c)<=120)
flag = boolean not null default false; position = int not null default 0 check (position>=0)
launches  name nonblank; url,notes text null; team_id→teams(id) cascade;
  status launch_status not null default 'preparing'; prior_status launch_status null;
  ck (status='trash')=(prior_status is not null) and prior_status<>'trash'
templates  name nonblank; is_default flag; team_id→teams(id) cascade;
  unique(team_id) where is_default
template_items  label nonblank; is_required flag; position;
  template_id uuid not null; (team_id,template_id)→templates(team_id,id) cascade
launch_checklists  launch_id uuid not null unique; origin_template_id uuid null;
  (team_id,launch_id)→launches(team_id,id) cascade;
  (team_id,origin_template_id)→templates(team_id,id)
    on delete set null (origin_template_id) [PG17]
checklist_items  label nonblank; is_required,is_complete flag; position;
  checklist_id uuid not null; (team_id,checklist_id)→launch_checklists(team_id,id) cascade
launch_events  seq bigint identity pk; launch_id uuid not null;
  kind launch_event_kind not null; from_status,to_status launch_status null;
  actor_user_id uuid not null default auth.uid()→profiles(user_id) restrict;
  (team_id,launch_id)→launches(team_id,id) cascade;
  ck created(null,'preparing'); transitioned(both,distinct); applied(null,null)
```

### RPCs

Lock order: `teams→launches→templates→launch_checklists`, each taking a prefix, so no cycle. Each `security definer` body checks `is_team_member(team_id)`, commits atomically; any raise writes nothing. Codes: `42501` absent row or non-member (identical text), `22023` invalid input/state, `23505` uniqueness/concurrency, `23514` eligibility.

|RPC → returns|Lock|Effect · Event|Raises|
|---|---|---|---|
|`create_launch(p_launch_id uuid,p_team_id uuid,p_name text)→uuid`|—|insert `preparing`,`prior_status null` · `created`; `on conflict (id) do nothing` makes a retry of the caller's id return it with no second row and no second event|`42501` non-member, or an id held by another team/creator; `22023` null id or blank/oversize name|
|`transition_launch(p_launch_id uuid,p_next launch_status)→launch_status`|`launches` `for update`|set `status`, storing `prior_status` only for `trash` · `transitioned`|`42501`; `22023` unlisted pair/`archived→preparing`/already-trashed; `23514` no snapshot or incomplete required items|
|`restore_launch(p_launch_id uuid)→launch_status`|`launches` `for update`|`status:=prior_status`,`prior_status:=null` · `transitioned` from `trash`|`42501`; `22023` not trashed|
|`apply_checklist_template(p_launch_id uuid,p_template_id uuid)→uuid`|`launches` then `templates` `for update`|one `launch_checklists` + items copied by `(position,id)` · `checklist_applied`|`42501` either row; `22023` cross-team; `23505` second snapshot|
|`set_default_checklist_template(p_team_id uuid,p_template_id uuid)→uuid`|`teams` `for update`|`null` clears; else demote peers, promote one; launches untouched · none|`42501`; `22023` foreign template; `23505` concurrent setter|

Accepted: `preparing→active|discarded`, `active→archived|discarded`, `discarded→preparing`, non-trash`→trash`; `active` also needs a snapshot with no incomplete required items. Other pairs leave state and history untouched.

### RLS and grants

Every predicate is `is_team_member(team_id)`: `using` for select/update, `with check` for insert/update. Members select all six tables; no delete policy or grant exists.

|Table|insert|update|
|---|---|---|
|launches|RPC|name,url,notes|
|launch_events|RPC|—|
|templates|team_id,name|name|
|template_items|team_id,template_id,label,is_required,position|label,is_required,position|
|launch_checklists|RPC|—|
|checklist_items|RPC|label,is_required,position,is_complete|

`is_default` is never granted (atomic setter); execute is revoked from `public,anon,authenticated`, then granted to `authenticated` per RPC.

## Testing Strategy

Files: `lifecycle|templates|history|retention` = `tests/database/launch-*.test.ts`, `rls` = `tests/isolation/launch-rls.test.ts`. The original 47 scenarios plus reproducibility/isolation went RED in PR1 before any SQL existed; R4-001 later added two lifecycle scenarios, bringing the current total to 49. `INVENTORY` is complete.

|Requirement heading|#|File|
|---|---|---|
|lifecycle: Preparing launches|5|lifecycle,rls|
|lifecycle: Closed lifecycle|4|lifecycle|
|lifecycle: Explicit activation|4|lifecycle|
|lifecycle: Retention and team deletion|5|retention|
|templates: Private team templates|2|templates,rls|
|templates: Optional default|3|templates|
|templates: Single template-derived snapshot|4|templates|
|templates: Editable snapshot items|4|templates|
|templates: Checklist retention and team deletion|3|retention|
|history: Exact append-only event scope|6|history|
|history: Events expose minimum behavioral facts|2|history|
|history: Team-isolated queries preserve continuity|4|history,rls|
|history: History retention and team-deletion boundary|3|retention|

Totals 18/16/15 = **49**. `Complete query` returns all retained team events, trashed included, in `seq` order. `reproducibility.test.ts` proves schema, smoke and forward-revoke rollback, not scenarios.

## Threat Matrix

N/A: no routing/shell/subprocess/VCS-PR-automation/executable-classification/process-integration boundary.

## Migration / Rollout

Strict TDD holds inside PR1: no implementation precedes RED evidence. Repo policy keeps migration docs with the migration in PR1; PR3 defers nothing and only re-verifies the exact complete INVENTORY it inherits. Tables start empty: no backfill. `tasks.md` is stale (wrong filename and unit split); regenerate it against this three-PR plan. Rollback stays forward-only: a later migration revokes grants and execute.

## Open Questions

None.
