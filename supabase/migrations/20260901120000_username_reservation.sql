-- Username reservation: one permanent, globally unique name per account, claimed atomically.
--
-- This migration is the registry and the claim. The onboarding gate that requires a claim before
-- any other protected write, and the team-scoped resolution that reads names back, arrive in the
-- next migration; nothing here depends on them, and the contract below stands on its own.
--
-- The registry deliberately carries NO foreign key. A reservation has to outlive the account that
-- made it -- that is the whole point of a permanent name -- and every referential action destroys
-- exactly that: `restrict` blocks the deletion, `set null` erases the attribution, `cascade`
-- removes the row. Claim-time validity comes instead from the verified JWT subject inside the
-- definer RPC, so the link is proven once and then stands on its own.

create table public.username_reservations (
  username text primary key
    constraint username_reservations_username_check check (username ~ '^[a-z0-9_]{3,30}$'),
  -- No foreign key, on purpose; see the header. Uniqueness is what makes a claim one-time.
  user_id uuid not null constraint username_reservations_user_id_key unique,
  claimed_at timestamptz not null default now()
);

-- One atomic statement is the whole claim. A bare `on conflict do nothing` covers both unique
-- constraints at once -- the name already taken, and the caller who already holds one -- so two
-- concurrent claimants cannot both win, and no branch here can observe, or leak, which case it hit.
-- Definer rights because no client holds a single privilege on the registry.
create function public.claim_username(p_username text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  candidate text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_username, '')));
  claimed text;
begin
  -- The format rule is the one distinguishable rejection: a caller can compute it without asking,
  -- so saying so discloses nothing.
  if candidate !~ '^[a-z0-9_]{3,30}$' then
    raise exception 'username: 3 to 30 characters of a-z, 0-9 or _ are required' using errcode = '22023';
  end if;
  insert into public.username_reservations (username, user_id)
  values (candidate, (select auth.uid()))
  on conflict do nothing
  returning username into claimed;
  -- Availability and account state are both protected facts, so both refusals read identically.
  if claimed is null then
    raise exception 'username: claim not permitted' using errcode = '22023';
  end if;
  return claimed;
end;
$$;

-- Row level security first, privileges second. The registry deliberately has no policy and no grant
-- of any kind: with security forced and nothing permitted, a direct read, write or enumeration is
-- refused at the privilege layer, leaving the claim function as the only door. Immutability follows
-- from the same absence -- no update or delete path exists to write one.
alter table public.username_reservations enable row level security;
alter table public.username_reservations force row level security;

revoke all on public.username_reservations from public, anon, authenticated;
revoke execute on function public.claim_username(text) from public, anon, authenticated;
grant execute on function public.claim_username(text) to authenticated;
