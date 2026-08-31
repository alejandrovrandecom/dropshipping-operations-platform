-- Launch workspace core: team-owned launches, private checklist templates, one editable
-- template-derived snapshot per launch, and append-only launch history.
--
-- Two roots cascade from `teams` -- `launches` and `launch_checklist_templates`. Every other table
-- reaches its tenant through a composite `(team_id, parent_id)` key referencing the parent's
-- `(team_id, id)`, so a row can never point at another tenant's parent: cross-tenant nesting is
-- unrepresentable rather than merely forbidden.
--
-- Row level security is enabled AND forced on every table before any privilege exists, and every
-- privilege is revoked before the explicit least-privilege grants. State, history, snapshots and
-- the team default move only through the `security definer` RPCs at the bottom of this file.
--
-- There is deliberately no delete policy and no delete grant anywhere here. An individual launch
-- has no purge path; owner-only whole-team deletion is the sole destructive exception and arrives
-- through `public.teams`, cascading down these composite keys.

create type public.launch_status as enum ('preparing', 'active', 'archived', 'discarded', 'trash');
create type public.launch_event_kind as enum ('created', 'transitioned', 'checklist_applied');

create table public.launches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null
    constraint launches_team_fkey references public.teams (id) on delete cascade,
  -- Bound to the verified JWT subject; the client is never granted this column.
  created_by uuid not null default auth.uid()
    constraint launches_created_by_fkey references public.profiles (user_id) on delete restrict,
  name text not null
    constraint launches_name_check check (btrim(name) <> '' and length(name) <= 120),
  url text,
  notes text,
  status public.launch_status not null default 'preparing',
  prior_status public.launch_status,
  created_at timestamptz not null default now(),
  -- `trash` is a status, never a deletion. The pre-trash state is retained so restoration is
  -- exact, and a trashed launch cannot be trashed again and overwrite that record.
  constraint launches_trash_prior_status_check
    check ((status = 'trash') = (prior_status is not null) and prior_status <> 'trash'),
  -- Composite parent key: team-owned children reference (team_id, id).
  constraint launches_team_id_id_key unique (team_id, id)
);

create table public.launch_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null
    constraint launch_checklist_templates_team_fkey references public.teams (id) on delete cascade,
  created_by uuid not null default auth.uid()
    constraint launch_checklist_templates_created_by_fkey references public.profiles (user_id) on delete restrict,
  name text not null
    constraint launch_checklist_templates_name_check check (btrim(name) <> '' and length(name) <= 120),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  constraint launch_checklist_templates_team_id_id_key unique (team_id, id)
);

-- A team may have no default and at most one. The partial unique index *is* that rule, so two
-- concurrent setters cannot both win; the client is never granted the `is_default` column.
create unique index launch_checklist_templates_default_idx
  on public.launch_checklist_templates (team_id) where is_default;

create table public.launch_checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  template_id uuid not null,
  created_by uuid not null default auth.uid()
    constraint launch_checklist_template_items_created_by_fkey references public.profiles (user_id) on delete restrict,
  label text not null
    constraint launch_checklist_template_items_label_check check (btrim(label) <> '' and length(label) <= 120),
  is_required boolean not null default false,
  position int not null default 0
    constraint launch_checklist_template_items_position_check check (position >= 0),
  created_at timestamptz not null default now(),
  constraint launch_checklist_template_items_template_fkey foreign key (team_id, template_id)
    references public.launch_checklist_templates (team_id, id) on delete cascade
);

create index launch_checklist_template_items_team_id_template_id_idx
  on public.launch_checklist_template_items (team_id, template_id);

create table public.launch_checklists (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  -- One snapshot per launch: this uniqueness is what makes a second application fail with 23505
  -- instead of silently replacing the member's edited copy.
  launch_id uuid not null constraint launch_checklists_launch_id_key unique,
  origin_template_id uuid,
  created_by uuid not null default auth.uid()
    constraint launch_checklists_created_by_fkey references public.profiles (user_id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint launch_checklists_launch_fkey foreign key (team_id, launch_id)
    references public.launches (team_id, id) on delete cascade,
  -- PostgreSQL 17 column-list `set null`: deleting the source template clears only the origin
  -- pointer. A bare `set null` would also try to null `team_id`, which is `not null` by design.
  constraint launch_checklists_origin_template_fkey foreign key (team_id, origin_template_id)
    references public.launch_checklist_templates (team_id, id) on delete set null (origin_template_id),
  constraint launch_checklists_team_id_id_key unique (team_id, id)
);

create index launch_checklists_team_id_origin_template_id_idx
  on public.launch_checklists (team_id, origin_template_id);

create table public.launch_checklist_items (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  checklist_id uuid not null,
  created_by uuid not null default auth.uid()
    constraint launch_checklist_items_created_by_fkey references public.profiles (user_id) on delete restrict,
  label text not null
    constraint launch_checklist_items_label_check check (btrim(label) <> '' and length(label) <= 120),
  is_required boolean not null default false,
  is_complete boolean not null default false,
  position int not null default 0
    constraint launch_checklist_items_position_check check (position >= 0),
  created_at timestamptz not null default now(),
  constraint launch_checklist_items_checklist_fkey foreign key (team_id, checklist_id)
    references public.launch_checklists (team_id, id) on delete cascade
);

create index launch_checklist_items_team_id_checklist_id_idx
  on public.launch_checklist_items (team_id, checklist_id);

create table public.launch_events (
  -- An identity primary key gives a monotonic, tie-free append order, so history stays
  -- deterministic even when several events share a `created_at` instant.
  seq bigint generated always as identity primary key,
  team_id uuid not null,
  launch_id uuid not null,
  kind public.launch_event_kind not null,
  from_status public.launch_status,
  to_status public.launch_status,
  actor_user_id uuid not null default auth.uid()
    constraint launch_events_actor_fkey references public.profiles (user_id) on delete restrict,
  created_at timestamptz not null default now(),
  -- Each kind carries exactly the states it can justify, so a stored event can never claim a
  -- transition that did not happen, or a transition between identical states.
  constraint launch_events_kind_status_check check (
    (kind = 'created' and from_status is null and to_status = 'preparing')
    or (kind = 'transitioned' and from_status is not null and to_status is not null
        and from_status <> to_status)
    or (kind = 'checklist_applied' and from_status is null and to_status is null)),
  constraint launch_events_launch_fkey foreign key (team_id, launch_id)
    references public.launches (team_id, id) on delete cascade
);

create index launch_events_team_id_launch_id_idx on public.launch_events (team_id, launch_id, seq);
create index launch_events_team_id_seq_idx on public.launch_events (team_id, seq);

-- Row level security first, privileges second.
alter table public.launches enable row level security;
alter table public.launches force row level security;
alter table public.launch_checklist_templates enable row level security;
alter table public.launch_checklist_templates force row level security;
alter table public.launch_checklist_template_items enable row level security;
alter table public.launch_checklist_template_items force row level security;
alter table public.launch_checklists enable row level security;
alter table public.launch_checklists force row level security;
alter table public.launch_checklist_items enable row level security;
alter table public.launch_checklist_items force row level security;
alter table public.launch_events enable row level security;
alter table public.launch_events force row level security;

-- Membership is the only predicate on this whole surface. Where a table has no insert or update
-- policy the omission is deliberate: with RLS forced and no permissive policy, a direct client
-- write is denied by default rather than by a rule somebody could later widen.
create policy launches_select_member on public.launches
  for select to authenticated using (public.is_team_member(team_id));
create policy launches_update_member on public.launches
  for update to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));

create policy launch_checklist_templates_select_member on public.launch_checklist_templates
  for select to authenticated using (public.is_team_member(team_id));
create policy launch_checklist_templates_insert_member on public.launch_checklist_templates
  for insert to authenticated with check (public.is_team_member(team_id));
create policy launch_checklist_templates_update_member on public.launch_checklist_templates
  for update to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));

create policy launch_checklist_template_items_select_member on public.launch_checklist_template_items
  for select to authenticated using (public.is_team_member(team_id));
create policy launch_checklist_template_items_insert_member on public.launch_checklist_template_items
  for insert to authenticated with check (public.is_team_member(team_id));
create policy launch_checklist_template_items_update_member on public.launch_checklist_template_items
  for update to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));

create policy launch_checklists_select_member on public.launch_checklists
  for select to authenticated using (public.is_team_member(team_id));

create policy launch_checklist_items_select_member on public.launch_checklist_items
  for select to authenticated using (public.is_team_member(team_id));
create policy launch_checklist_items_update_member on public.launch_checklist_items
  for update to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));

create policy launch_events_select_member on public.launch_events
  for select to authenticated using (public.is_team_member(team_id));

-- Defense in depth: revoke everything first, then grant only what the client genuinely needs --
-- down to the column, where a column is enough. No table below is granted `delete`, and neither
-- `launches.status` nor `launch_checklist_templates.is_default` is ever granted, so a forged
-- lifecycle or default write fails at the privilege layer before RLS is even consulted.
revoke all on public.launches, public.launch_checklist_templates, public.launch_checklist_template_items,
  public.launch_checklists, public.launch_checklist_items, public.launch_events
  from public, anon, authenticated;

grant select on public.launches to authenticated;
grant update (name, url, notes) on public.launches to authenticated;
grant select on public.launch_checklist_templates to authenticated;
grant insert (team_id, name), update (name) on public.launch_checklist_templates to authenticated;
grant select on public.launch_checklist_template_items to authenticated;
grant insert (team_id, template_id, label, is_required, position),
  update (label, is_required, position) on public.launch_checklist_template_items to authenticated;
grant select on public.launch_checklists to authenticated;
grant select on public.launch_checklist_items to authenticated;
grant update (label, is_required, position, is_complete) on public.launch_checklist_items to authenticated;
grant select on public.launch_events to authenticated;

-- The write doors. Every body is `security definer` with a pinned empty `search_path`, checks
-- `is_team_member` before touching a row, and commits its state change together with its event, so
-- history can never disagree with state: any raise writes nothing at all.
--
-- Rejections are deliberately uniform. An absent row and a row belonging to another tenant raise
-- the identical `42501` message, so no RPC can be used as an existence oracle. `22023` marks an
-- invalid input or an unlisted transition, `23514` an unmet activation precondition, and `23505`
-- a uniqueness or concurrency loss.
--
-- Locks are always taken in the order teams -> launches -> templates -> launch_checklists, each
-- function taking a prefix of it, so two concurrent callers can never deadlock.

-- The launch id is chosen by the caller, so creation is idempotent on resource identity. Without
-- it, a client whose response was lost after the write committed has no safe move: retrying opens
-- a second launch with a second `created` event, and not retrying loses the launch.
create function public.create_launch(p_launch_id uuid, p_team_id uuid, p_name text)
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
  -- another tenant, or by another member, is refused with the same opaque code as any other miss,
  -- so a guessed id still cannot be used as an existence oracle.
  caller := auth.uid();
  select l.team_id, l.created_by into existing_team, existing_creator
    from public.launches l where l.id = p_launch_id;
  if existing_team is null or existing_team <> p_team_id
    or caller is null or existing_creator <> caller then
    raise exception 'launch: not permitted' using errcode = '42501';
  end if;
  return p_launch_id;
end;
$$;

create function public.transition_launch(p_launch_id uuid, p_next public.launch_status)
returns public.launch_status language plpgsql security definer set search_path = '' as $$
declare
  current_team uuid;
  current_status public.launch_status;
begin
  select l.team_id, l.status into current_team, current_status
    from public.launches l where l.id = p_launch_id for update;
  if current_team is null or not public.is_team_member(current_team) then
    raise exception 'launch: not permitted' using errcode = '42501';
  end if;

  -- The accepted set is closed and listed here in full. `archived` is terminal except for the
  -- trash move: an archived launch never reopens.
  if p_next = 'trash' then
    if current_status = 'trash' then
      raise exception 'launch: already in trash' using errcode = '22023';
    end if;
  elsif not (
       (current_status = 'preparing' and p_next in ('active', 'discarded'))
    or (current_status = 'active' and p_next in ('archived', 'discarded'))
    or (current_status = 'discarded' and p_next = 'preparing')
  ) then
    raise exception 'launch: transition not allowed' using errcode = '22023';
  end if;

  -- Completing required items only establishes eligibility; activation is always explicit.
  if p_next = 'active' then
    if not exists (
      select 1 from public.launch_checklists c where c.launch_id = p_launch_id
    ) then
      raise exception 'launch: activation requires a checklist snapshot' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.launch_checklist_items i
      join public.launch_checklists c on c.team_id = i.team_id and c.id = i.checklist_id
      where c.launch_id = p_launch_id and i.is_required and not i.is_complete
    ) then
      raise exception 'launch: activation requires every required item complete' using errcode = '23514';
    end if;
  end if;

  update public.launches
     set status = p_next,
         prior_status = case when p_next = 'trash' then current_status else null end
   where id = p_launch_id;
  insert into public.launch_events (team_id, launch_id, kind, from_status, to_status)
  values (current_team, p_launch_id, 'transitioned', current_status, p_next);
  return p_next;
end;
$$;

-- Restoration is its own door, not a transition: only it may read `prior_status`, and it always
-- returns the launch to the exact state it held before trash.
create function public.restore_launch(p_launch_id uuid)
returns public.launch_status language plpgsql security definer set search_path = '' as $$
declare
  current_team uuid;
  current_status public.launch_status;
  restored public.launch_status;
begin
  select l.team_id, l.status, l.prior_status into current_team, current_status, restored
    from public.launches l where l.id = p_launch_id for update;
  if current_team is null or not public.is_team_member(current_team) then
    raise exception 'launch: not permitted' using errcode = '42501';
  end if;
  if current_status <> 'trash' then
    raise exception 'launch: not in trash' using errcode = '22023';
  end if;

  update public.launches set status = restored, prior_status = null where id = p_launch_id;
  insert into public.launch_events (team_id, launch_id, kind, from_status, to_status)
  values (current_team, p_launch_id, 'transitioned', 'trash', restored);
  return restored;
end;
$$;

-- A snapshot is a copy, not a link: items are duplicated so later template edits cannot rewrite a
-- launch's checklist, and snapshot edits cannot leak back into the template.
create function public.apply_checklist_template(p_launch_id uuid, p_template_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  launch_team uuid;
  template_team uuid;
  new_checklist uuid;
begin
  select l.team_id into launch_team from public.launches l where l.id = p_launch_id for update;
  if launch_team is null or not public.is_team_member(launch_team) then
    raise exception 'launch: not permitted' using errcode = '42501';
  end if;
  select t.team_id into template_team
    from public.launch_checklist_templates t where t.id = p_template_id for update;
  if template_team is null or not public.is_team_member(template_team) then
    raise exception 'launch: not permitted' using errcode = '42501';
  end if;
  -- Reached only when the caller may see both rows, so this is a tenant-boundary rejection rather
  -- than an authorization one, and it may safely say so.
  if template_team <> launch_team then
    raise exception 'launch: template belongs to another team' using errcode = '22023';
  end if;

  -- A second application loses the unique `launch_id` race and raises 23505: no silent replacement.
  insert into public.launch_checklists (team_id, launch_id, origin_template_id)
  values (launch_team, p_launch_id, p_template_id) returning id into new_checklist;

  insert into public.launch_checklist_items (team_id, checklist_id, label, is_required, position)
  select launch_team, new_checklist, i.label, i.is_required, i.position
    from public.launch_checklist_template_items i
   where i.team_id = template_team and i.template_id = p_template_id
   order by i.position, i.id;

  insert into public.launch_events (team_id, launch_id, kind)
  values (launch_team, p_launch_id, 'checklist_applied');
  return new_checklist;
end;
$$;

-- Changing the default changes a designation and nothing else: no launch and no snapshot is read
-- or written here, and no event is appended.
create function public.set_default_checklist_template(p_team_id uuid, p_template_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  locked_team uuid;
  template_team uuid;
begin
  select t.id into locked_team from public.teams t where t.id = p_team_id for update;
  if locked_team is null or not public.is_team_member(p_team_id) then
    raise exception 'launch: not permitted' using errcode = '42501';
  end if;

  if p_template_id is null then
    update public.launch_checklist_templates set is_default = false
     where team_id = p_team_id and is_default;
    return null;
  end if;

  select c.team_id into template_team
    from public.launch_checklist_templates c where c.id = p_template_id;
  -- Spelled out rather than `is distinct from`, because the repository's definer-body audit reads
  -- `from <name>` as an unqualified relation reference. `p_team_id` is already known to be non-null.
  if template_team is null or template_team <> p_team_id then
    raise exception 'launch: template belongs to another team' using errcode = '22023';
  end if;

  -- Demote then promote under the team lock, so the partial unique index is never transiently
  -- violated and two concurrent setters cannot both succeed.
  update public.launch_checklist_templates set is_default = false
   where team_id = p_team_id and is_default and id <> p_template_id;
  update public.launch_checklist_templates set is_default = true where id = p_template_id;
  return p_template_id;
end;
$$;

revoke execute on function public.create_launch(uuid, uuid, text),
  public.transition_launch(uuid, public.launch_status), public.restore_launch(uuid),
  public.apply_checklist_template(uuid, uuid), public.set_default_checklist_template(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_launch(uuid, uuid, text),
  public.transition_launch(uuid, public.launch_status), public.restore_launch(uuid),
  public.apply_checklist_template(uuid, uuid), public.set_default_checklist_template(uuid, uuid)
  to authenticated;
