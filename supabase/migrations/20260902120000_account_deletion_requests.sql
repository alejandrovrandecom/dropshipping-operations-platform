-- Account deletion request: the receipt that schedules a definitive deletion, and the teams its
-- owner condemned along with it. This is the second half of resolving an account's owned teams --
-- `20260902110000_account_deletion_transfers.sql` supplies the other resolution, and the RPC below
-- reads that table to refuse a request whose team somebody else may still accept. The privileged
-- claim, the finalization and the status read are the next migration, which is why no `service_role`
-- grant appears anywhere below: a request records intent, it does not act on it.

create type public.account_deletion_state as enum ('pending', 'in_progress', 'done', 'failed');

-- The receipt deliberately holds no foreign key to the account it describes. It has to outlive that
-- account, and every referential action -- cascade and set null alike -- destroys or blanks exactly
-- the record finalization must be able to report afterwards. It carries no email and no display
-- name either: a receipt that survives deletion must hold no PII, so the account is a bare UUID.
create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  state public.account_deletion_state not null default 'pending',
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A selection is live intent rather than history, so it cascades off its receipt and off its team: a
-- team the finalizer deletes takes its own selection with it, which is what makes a retry a no-op.
create table public.account_deletion_team_selections (
  request_id uuid not null references public.account_deletion_requests (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  primary key (request_id, team_id)
);

-- Self-only by construction rather than by check: the call carries no target parameter, so the
-- caller is always the subject and no account can name another. Scheduling requires every owned team
-- resolved -- handed to a member or condemned here -- and a team carrying a live offer counts as
-- unresolved even when condemned, because its recipient could still accept a team already promised
-- to deletion. Live teams therefore keep their owner, and every refusal writes nothing at all.
create function public.request_account_deletion(p_delete_team_ids uuid[])
returns public.account_deletion_state language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  named uuid[] := coalesce(p_delete_team_ids, '{}'::uuid[]);
  standing public.account_deletion_state;
  receipt uuid;
begin
  if caller is null then
    raise exception 'deletion: request not permitted' using errcode = '42501';
  end if;
  -- Asking twice reports the standing receipt rather than replacing it: deletion is definitive, so a
  -- second call must never reopen a claimed one or quietly condemn a different set of teams.
  select r.state into standing from public.account_deletion_requests r where r.user_id = caller;
  if standing is not null then
    return standing;
  end if;

  -- A team the caller does not own and a team that does not exist are one refusal. Letting the
  -- foreign key catch the second would answer it with a distinguishable error and turn the pair
  -- into a cross-tenant existence oracle.
  if exists (
    select 1 from pg_catalog.unnest(named) as candidate (team_id)
     where not exists (select 1 from public.teams t
                        where t.id = candidate.team_id and t.owner_user_id = caller)
  ) then
    raise exception 'deletion: request not permitted' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.teams t
     where t.owner_user_id = caller
       and (not (t.id = any (named)) or exists (select 1 from public.team_ownership_transfers x
             where x.team_id = t.id and x.accepted_at is null and x.expires_at > pg_catalog.now()))
  ) then
    raise exception 'deletion: owned teams are unresolved' using errcode = '42501';
  end if;

  insert into public.account_deletion_requests (user_id) values (caller) returning id into receipt;
  -- Written out of the owned set, which the two checks above have just proven equal to the named
  -- one. Writing the caller's array itself would reintroduce the refusal above as a constraint
  -- violation, which is the distinguishable error the first check exists to avoid.
  insert into public.account_deletion_team_selections (request_id, team_id)
  select receipt, t.id from public.teams t where t.owner_user_id = caller;
  return 'pending'::public.account_deletion_state;
end;
$$;

-- The username gate is a table-level baseline (`20260901130000_username_gate.sql`) placed on the
-- write target precisely so a newly added entry point cannot forget it. The receipt is this slice's
-- new write target, taking the count to twelve. Selections need no second trigger: their only write
-- shares a transaction with the gated receipt insert, and no grant reaches them by another route.
create trigger account_deletion_requests_require_username
before insert on public.account_deletion_requests
for each statement execute function public.enforce_username_claim();

-- Closed exactly as the transfer table and the username registry are: security forced, no policy of
-- any kind and no grant of any kind, so a direct read, write, count or enumeration is refused at the
-- privilege layer. The RPC above is the only door, and the finalizer's grants are the next slice's.
alter table public.account_deletion_requests enable row level security;
alter table public.account_deletion_requests force row level security;
alter table public.account_deletion_team_selections enable row level security;
alter table public.account_deletion_team_selections force row level security;

revoke all on public.account_deletion_requests, public.account_deletion_team_selections
  from public, anon, authenticated;
revoke execute on function public.request_account_deletion(uuid[]) from public, anon, authenticated;
grant execute on function public.request_account_deletion(uuid[]) to authenticated;
