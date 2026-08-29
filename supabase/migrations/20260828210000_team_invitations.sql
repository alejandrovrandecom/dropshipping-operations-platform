-- Team invitations: hashed, expiring, single-use, team-bound, addressed to one verified
-- recipient. The plaintext token exists only in the issuing response and the delivered
-- message; the database stores its SHA-256 hash, so a leaked table cannot be replayed.

create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  -- Normalized intended recipient, compared at acceptance against the caller's verified JWT
  -- identity, so a stolen link is worthless to anybody else.
  email text not null,
  token_hash text not null unique,
  invited_by uuid not null default auth.uid() references public.profiles (user_id) on delete restrict,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles (user_id) on delete restrict,
  created_at timestamptz not null default now()
);

create index team_invitations_team_id_idx on public.team_invitations (team_id);

-- The single auditable place where a token becomes a stored value. Invoker rights on purpose:
-- it carries no authority of its own and is never granted to a client.
create function public.hash_invitation_token(token text)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(token, 'UTF8')), 'hex');
$$;

-- Issuing is owner-only and server-side: the token comes from the database's strong random
-- source, so a client can neither choose nor predict it, and it is returned exactly once.
create function public.create_invitation(target_team_id uuid, invitee_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  recipient text := pg_catalog.lower(pg_catalog.btrim(invitee_email));
  raw_token text := pg_catalog.translate(
    pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text, '-', '');
begin
  if not public.is_team_owner(target_team_id) then
    raise exception 'invitation: only the team owner may invite' using errcode = '42501';
  end if;
  if recipient !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'invitation: a valid recipient address is required' using errcode = '22023';
  end if;
  insert into public.team_invitations (team_id, email, token_hash)
  values (target_team_id, recipient, public.hash_invitation_token(raw_token));
  return raw_token;
end;
$$;

-- Acceptance is one atomic claim: a single conditional update makes an invitation single-use,
-- unexpired and recipient-bound at once, so two concurrent callers cannot both win. Every
-- rejection raises the same message, so probing never reveals whether an address, an account
-- or an invitation exists.
create function public.accept_invitation(token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  claimed_team uuid;
begin
  update public.team_invitations i
     set accepted_at = pg_catalog.now(), accepted_by = (select auth.uid())
   where i.token_hash = public.hash_invitation_token(token)
     and i.accepted_at is null
     and i.expires_at > pg_catalog.now()
     and i.email = (select pg_catalog.lower(p.email) from public.profiles p where p.user_id = (select auth.uid()))
  returning i.team_id into claimed_team;
  if claimed_team is null then
    raise exception 'invitation: not valid for this account' using errcode = '22023';
  end if;
  insert into public.memberships (team_id, user_id) values (claimed_team, (select auth.uid()))
  on conflict do nothing;
  return claimed_team;
end;
$$;

-- Row level security first, privileges second.
alter table public.team_invitations enable row level security;
alter table public.team_invitations force row level security;

-- Owners issue and revoke; nobody else may even learn an invitation exists. There is deliberately
-- no insert or update policy: with RLS on and no permissive policy the table is closed to direct
-- writes by default, so the functions above stay the only write paths.
create policy team_invitations_select_owner on public.team_invitations
  for select to authenticated using (public.is_team_owner(team_id));
create policy team_invitations_delete_owner on public.team_invitations
  for delete to authenticated using (public.is_team_owner(team_id));

revoke all on public.team_invitations from public, anon, authenticated;
grant select, delete on public.team_invitations to authenticated;
revoke execute on function public.hash_invitation_token(text), public.create_invitation(uuid, text),
  public.accept_invitation(text) from public, anon, authenticated;
grant execute on function public.create_invitation(uuid, text), public.accept_invitation(text) to authenticated;
