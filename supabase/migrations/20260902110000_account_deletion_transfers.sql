-- Team ownership transfer: a standing offer from a team's current owner to one current member, and
-- the acceptance that moves ownership. This is the first half of resolving an account's owned teams
-- before deletion -- the request state that consumes it is the next migration, which is why no
-- deletion enum, no receipt table and no `service_role` grant appear anywhere below.
--
-- An offer is live working state rather than history, so it leaves with its team and with either
-- participant. Every refusal is uniform per entry point and the table is unreadable directly, so
-- probing an id reveals neither the offer, nor the team, nor the intended recipient.

create table public.team_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  from_user_id uuid not null references public.profiles (user_id) on delete cascade,
  to_user_id uuid not null references public.profiles (user_id) on delete cascade,
  constraint team_ownership_transfers_recipient_check check (to_user_id <> from_user_id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz
);

-- At most one live offer per team, held by the index rather than by a check inside the RPC. The
-- predicate cannot call `now()`, so an expired row would block re-offering forever; the RPC below
-- therefore removes the standing one instead of relying on expiry to clear it.
create unique index team_ownership_transfers_pending_idx
  on public.team_ownership_transfers (team_id) where accepted_at is null;

-- Owner to member, and to nobody else. One uniform refusal covers a caller who is not the owner, a
-- recipient outside the team and a recipient who is the owner: none may learn which it was.
create function public.request_team_ownership_transfer(p_team_id uuid, p_to_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  offered uuid;
begin
  if caller is null or p_to_user_id is null or p_to_user_id = caller or not public.is_team_owner(p_team_id)
    or not exists (select 1 from public.memberships m where m.team_id = p_team_id and m.user_id = p_to_user_id)
  then
    raise exception 'transfer: offer not permitted' using errcode = '42501';
  end if;
  -- A fresh offer supersedes the standing one; the partial unique index admits no second live row.
  delete from public.team_ownership_transfers x where x.team_id = p_team_id and x.accepted_at is null;
  insert into public.team_ownership_transfers (team_id, from_user_id, to_user_id)
  values (p_team_id, caller, p_to_user_id) returning id into offered;
  return offered;
end;
$$;

-- Acceptance is one atomic claim, exactly as invitation acceptance is: a single conditional update
-- makes an offer single-use, unexpired, recipient-bound and still-a-member at once, so two callers
-- cannot both win. The membership re-check is not redundant -- an owner may remove the recipient
-- between offer and acceptance, and handing the team to a non-member would break the invariant
-- `ensure_owner_membership` establishes. The move shares this transaction and `teams.owner_user_id`
-- is `not null`, so an ownerless team is unrepresentable. Every rejection reads the same.
create function public.accept_team_ownership_transfer(p_transfer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  successor uuid := (select auth.uid());
  claimed_team uuid;
begin
  update public.team_ownership_transfers x
     set accepted_at = pg_catalog.now()
   where x.id = p_transfer_id and x.accepted_at is null and x.expires_at > pg_catalog.now()
     and x.to_user_id = successor
     and exists (select 1 from public.memberships m where m.team_id = x.team_id and m.user_id = successor)
  returning x.team_id into claimed_team;
  if claimed_team is null then
    raise exception 'transfer: not valid for this account' using errcode = '22023';
  end if;
  update public.teams t set owner_user_id = successor where t.id = claimed_team;
  return claimed_team;
end;
$$;

-- The username gate is a baseline contract, and `20260901130000_username_gate.sql` carries it on
-- tables rather than inside RPCs precisely so a new entry point cannot forget it. This is the new
-- write target, taking the count to eleven. Acceptance needs no second trigger: moving ownership
-- writes `teams`, which is gated already, so a usernameless recipient is refused there.
create trigger team_ownership_transfers_require_username
before insert or update or delete on public.team_ownership_transfers
for each statement execute function public.enforce_username_claim();

-- Row level security first, privileges second. The table is closed the way the username registry
-- is: security forced, no policy of any kind and no grant of any kind, so a direct read, write,
-- count or enumeration is refused at the privilege layer and the two RPCs are the only doors.
alter table public.team_ownership_transfers enable row level security;
alter table public.team_ownership_transfers force row level security;

revoke all on public.team_ownership_transfers from public, anon, authenticated;
revoke execute on function public.request_team_ownership_transfer(uuid, uuid),
  public.accept_team_ownership_transfer(uuid) from public, anon, authenticated;
grant execute on function public.request_team_ownership_transfer(uuid, uuid),
  public.accept_team_ownership_transfer(uuid) to authenticated;
