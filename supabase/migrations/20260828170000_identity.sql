-- Identity foundation: profiles mirror auth.users, teams are global, and
-- memberships are team-owned. Row level security is enabled AND forced on every
-- table before any privilege is granted, and every privilege is revoked before
-- the explicit least-privilege grants are issued.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  -- Bound to the verified JWT subject; the client is never granted this column.
  owner_user_id uuid not null default auth.uid() references public.profiles (user_id) on delete restrict,
  name text not null check (btrim(name) <> '' and length(name) <= 80),
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid not null default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id),
  -- Composite parent key: team-owned children reference (team_id, id), so a
  -- child row can never point at another tenant's membership.
  unique (team_id, id)
);

create index memberships_user_id_idx on public.memberships (user_id);

-- Policy helpers. SECURITY DEFINER breaks the recursive dependency between the
-- memberships policy and the memberships table; the pinned empty search_path
-- stops a caller-controlled schema from shadowing any referenced object.
create function public.is_team_member(target_team_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.team_id = target_team_id and m.user_id = (select auth.uid())
  );
$$;

create function public.is_team_owner(target_team_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.teams t
    where t.id = target_team_id and t.owner_user_id = (select auth.uid())
  );
$$;

-- Mirror every new auth user into profiles so tenant tables reference a stable
-- identity row rather than auth.users directly.
create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email) values (new.id, new.email)
  on conflict (user_id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users for each row execute function public.handle_new_user();

-- The creator is always a member, so a team can never be orphaned by its owner.
create function public.ensure_owner_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.memberships (team_id, user_id) values (new.id, new.owner_user_id)
  on conflict do nothing;
  return new;
end;
$$;

create trigger teams_ensure_owner_membership
after insert on public.teams for each row execute function public.ensure_owner_membership();

-- Row level security first, privileges second.
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.teams enable row level security;
alter table public.teams force row level security;
alter table public.memberships enable row level security;
alter table public.memberships force row level security;

create policy profiles_select_self on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- The owner clause is not redundant: `insert ... returning` evaluates the select
-- policy before the after-insert trigger has written the owner's membership.
create policy teams_select_member on public.teams
  for select to authenticated
  using (public.is_team_member(id) or owner_user_id = (select auth.uid()));
create policy teams_insert_self_owned on public.teams
  for insert to authenticated with check (owner_user_id = (select auth.uid()));
create policy teams_update_owner on public.teams
  for update to authenticated
  using (public.is_team_owner(id)) with check (public.is_team_owner(id));
create policy teams_delete_owner on public.teams
  for delete to authenticated using (public.is_team_owner(id));

create policy memberships_select_member on public.memberships
  for select to authenticated using (public.is_team_member(team_id));
create policy memberships_insert_owner on public.memberships
  for insert to authenticated with check (public.is_team_owner(team_id));
-- Owners remove other members; nobody may remove the owner's own membership.
create policy memberships_delete_owner on public.memberships
  for delete to authenticated
  using (public.is_team_owner(team_id) and user_id <> (select auth.uid()));

-- Defense in depth: revoke everything first so these tables stay closed even if
-- default privileges change, then grant only what the client genuinely needs --
-- down to the column, where a column is enough.
revoke all on public.profiles, public.teams, public.memberships from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
grant select, delete on public.teams to authenticated;
grant insert (name), update (name) on public.teams to authenticated;
grant select, delete on public.memberships to authenticated;
grant insert (team_id, user_id) on public.memberships to authenticated;

revoke execute on function public.is_team_member(uuid), public.is_team_owner(uuid),
  public.handle_new_user(), public.ensure_owner_membership() from public, anon, authenticated;
grant execute on function public.is_team_member(uuid), public.is_team_owner(uuid) to authenticated;
