-- Username gate: a confirmed account without a claim may claim one, and nothing else. The registry
-- and the claim RPC arrived in `20260901120000_username_reservation.sql`; this migration is the
-- rule that gives them force, plus the team-scoped resolution that reads a name back.
--
-- The gate is carried by statement-level triggers, not by policies. Every protected write in this
-- schema already travels through a `security definer` RPC owned by `postgres`, and `postgres` holds
-- BYPASSRLS, so a policy simply never runs on those paths. Replacing seven RPC bodies would reach
-- them, at the cost of roughly two hundred review lines and a fresh bypass every time an RPC is
-- added; widening `is_team_member` would break reads and resolution alike. A trigger on the table
-- sits below all of it: no caller, present or future, reaches the rows without passing it.
--
-- Statement level rather than row level on purpose. The gate asks one question about the caller,
-- never about a row, so per-row evaluation would only multiply the cost -- and a statement that
-- matches nothing is still refused, which is what "denied without side effects" has to mean.
--
-- Rollback is symmetric and complete: drop the ten triggers, revoke the resolver, and the schema is
-- exactly what it was before. The registry MUST NOT be dropped -- reservations are permanent.

-- The predicate. Deliberately ungranted: it is the gate's own question, and handing it to clients
-- would create a reservation-status oracle that the closed registry exists to prevent.
create function public.has_username()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.username_reservations r where r.user_id = (select auth.uid())
  );
$$;

create function public.enforce_username_claim()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- No verified subject, no gate. `postgres` and `service_role` bypass row level security anyway,
  -- `anon` holds no privilege to reach these tables, and an unconditional raise here would break
  -- `handle_new_user`, which mirrors a brand new account before any claim could possibly exist.
  if (select auth.uid()) is not null and not public.has_username() then
    raise exception 'username: claim a username before writing' using errcode = '42501';
  end if;
  -- A statement-level trigger's result is discarded; the raise above is the only outcome that acts.
  return null;
end;
$$;

-- Every protected write in the schema, one trigger per table. `profiles` is narrowed to
-- `display_name` so the confirmed-email mirror keeps working untouched, and no table is given a
-- `delete` gate it has no `delete` path for. `teams` insert and delete end up gated twice over,
-- because the owner-membership trigger and the delete cascade each perform a `memberships` write
-- that is gated in its own right. That redundancy is kept: it is the cheapest form of depth here.
create trigger profiles_require_username before update of display_name on public.profiles
for each statement execute function public.enforce_username_claim();
create trigger teams_require_username before insert or update or delete on public.teams
for each statement execute function public.enforce_username_claim();
create trigger memberships_require_username before insert or delete on public.memberships
for each statement execute function public.enforce_username_claim();
create trigger team_invitations_require_username before insert or update or delete on public.team_invitations
for each statement execute function public.enforce_username_claim();
create trigger launches_require_username before insert or update on public.launches
for each statement execute function public.enforce_username_claim();
create trigger launch_checklist_templates_require_username before insert or update on public.launch_checklist_templates
for each statement execute function public.enforce_username_claim();
create trigger launch_checklist_template_items_require_username before insert or update on public.launch_checklist_template_items
for each statement execute function public.enforce_username_claim();
create trigger launch_checklists_require_username before insert or update on public.launch_checklists
for each statement execute function public.enforce_username_claim();
create trigger launch_checklist_items_require_username before insert or update on public.launch_checklist_items
for each statement execute function public.enforce_username_claim();
create trigger launch_events_require_username before insert or update on public.launch_events
for each statement execute function public.enforce_username_claim();

-- Resolution is scoped by the caller's own membership, checked inside the query rather than before
-- it: a caller outside the team gets an empty set, exactly like a team that holds no claims and a
-- team that does not exist. No refusal, no error, no difference -- so this cannot be worked into an
-- existence oracle for a team, a membership or a reservation. It reports claims, not the roster:
-- a member who has not claimed simply has no row here, and the registry stays unreadable directly.
create function public.resolve_team_usernames(p_team_id uuid)
returns table (user_id uuid, username text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, r.username
    from public.memberships m
    join public.username_reservations r on r.user_id = m.user_id
   where m.team_id = p_team_id and public.is_team_member(p_team_id)
   order by r.username;
$$;

-- Revoke everything first, then grant only the resolver: the predicate answers a protected question
-- and the enforcer is reachable as a trigger alone, so neither is ever called by a client.
revoke execute on function public.has_username(), public.enforce_username_claim(),
  public.resolve_team_usernames(uuid) from public, anon, authenticated;
grant execute on function public.resolve_team_usernames(uuid) to authenticated;
