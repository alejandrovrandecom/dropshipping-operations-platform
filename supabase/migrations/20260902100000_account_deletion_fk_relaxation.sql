-- Deletion-time reference relaxation. Final account deletion must destroy an identity without
-- destroying what the team already lived through, so every reference that merely *records who acted*
-- becomes nullable and clears itself, while every reference holding a live structure together is
-- left exactly as it was.
--
-- Relaxed, eight in total: the six launch authoring references and both invitation participants.
-- Each is a historical fact about a person, so `set null` keeps the row and loses only the name.
-- Dropping `not null` is half the change, not a side effect: `set null` on a required column would
-- turn the referential action into a fresh violation and refuse the deletion all over again.
--
-- Deliberately untouched. `teams.owner_user_id` stays `restrict`, because a live team without an
-- owner is not a fact worth keeping: the team is resolved first, or the deletion is refused.
-- `memberships.user_id` stays `cascade`, because a membership is a live relationship, not history.
--
-- Rollback is asymmetric and forward-only. Once one row holds a null author this migration cannot be
-- undone: re-tightening the column fails outright, and re-adding `restrict` would only refuse future
-- deletions while the existing nulls stand. A rollback closes new deletion paths; it never restores
-- an author. `tests/database/reproducibility.test.ts` proves that asymmetry rather than asserting it.

-- The six launch authoring references.
alter table public.launches alter column created_by drop not null;
alter table public.launches drop constraint launches_created_by_fkey;
alter table public.launches add constraint launches_created_by_fkey
  foreign key (created_by) references public.profiles (user_id) on delete set null;
alter table public.launch_checklist_templates alter column created_by drop not null;
alter table public.launch_checklist_templates drop constraint launch_checklist_templates_created_by_fkey;
alter table public.launch_checklist_templates add constraint launch_checklist_templates_created_by_fkey
  foreign key (created_by) references public.profiles (user_id) on delete set null;
alter table public.launch_checklist_template_items alter column created_by drop not null;
alter table public.launch_checklist_template_items drop constraint launch_checklist_template_items_created_by_fkey;
alter table public.launch_checklist_template_items add constraint launch_checklist_template_items_created_by_fkey
  foreign key (created_by) references public.profiles (user_id) on delete set null;
alter table public.launch_checklists alter column created_by drop not null;
alter table public.launch_checklists drop constraint launch_checklists_created_by_fkey;
alter table public.launch_checklists add constraint launch_checklists_created_by_fkey
  foreign key (created_by) references public.profiles (user_id) on delete set null;
alter table public.launch_checklist_items alter column created_by drop not null;
alter table public.launch_checklist_items drop constraint launch_checklist_items_created_by_fkey;
alter table public.launch_checklist_items add constraint launch_checklist_items_created_by_fkey
  foreign key (created_by) references public.profiles (user_id) on delete set null;
alter table public.launch_events alter column actor_user_id drop not null;
alter table public.launch_events drop constraint launch_events_actor_fkey;
alter table public.launch_events add constraint launch_events_actor_fkey
  foreign key (actor_user_id) references public.profiles (user_id) on delete set null;

-- Both invitation participants.
alter table public.team_invitations alter column invited_by drop not null;
alter table public.team_invitations drop constraint team_invitations_invited_by_fkey;
alter table public.team_invitations add constraint team_invitations_invited_by_fkey
  foreign key (invited_by) references public.profiles (user_id) on delete set null;

-- Already nullable: an unaccepted invitation has no acceptor, so only the action changes here.
alter table public.team_invitations drop constraint team_invitations_accepted_by_fkey;
alter table public.team_invitations add constraint team_invitations_accepted_by_fkey
  foreign key (accepted_by) references public.profiles (user_id) on delete set null;

-- A null author is nobody, not everybody. `create_launch` answers a retry only for the launch's
-- original creator, and it decided that with `existing_creator <> caller` -- which is NULL, not
-- false, once the creator has been deleted, so the guard fell through and answered any member of
-- the team. The null is spelled out rather than folded into `is distinct from`, because the
-- definer-body audit in `reproducibility.test.ts` reads `from <name>` as a relation reference.
-- Nothing else in the body changes.
create or replace function public.create_launch(p_launch_id uuid, p_team_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  new_launch uuid;
  caller uuid;
  existing_team uuid;
  existing_creator uuid;
begin
  if not public.is_team_member(p_team_id) then
    raise exception 'launch: not permitted' using errcode = '42501';
  end if;
  if p_launch_id is null then
    raise exception 'launch: a launch id is required' using errcode = '22023';
  end if;
  -- `coalesce` is SQL syntax rather than a catalog function, so it is deliberately unqualified.
  if pg_catalog.btrim(coalesce(p_name, '')) = '' or pg_catalog.length(p_name) > 120 then
    raise exception 'launch: a name is required' using errcode = '22023';
  end if;

  -- A retry naming an already committed launch loses the primary key race, writes no row, and so
  -- appends no second event: the state change and its event stay one atomic pair either way.
  insert into public.launches (id, team_id, name) values (p_launch_id, p_team_id, p_name)
  on conflict (id) do nothing returning id into new_launch;
  if new_launch is not null then
    insert into public.launch_events (team_id, launch_id, kind, to_status)
    values (p_team_id, new_launch, 'created', 'preparing');
    return new_launch;
  end if;

  -- Only the original creator's own retry may be answered with the existing launch. An id held by
  -- another tenant, by another member, or by a deleted account, is refused with the same opaque
  -- code as any other miss, so a guessed id still cannot be used as an existence oracle.
  caller := auth.uid();
  select l.team_id, l.created_by into existing_team, existing_creator
    from public.launches l where l.id = p_launch_id;
  if existing_team is null or existing_team <> p_team_id
    or caller is null or existing_creator is null or existing_creator <> caller then
    raise exception 'launch: not permitted' using errcode = '42501';
  end if;
  return p_launch_id;
end;
$$;
