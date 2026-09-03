-- Account deletion finalization, the spine: the run itself. The previous migration admits a run and
-- makes it observable; this one performs it and writes the outcome a later claim reads back. Granted
-- to `service_role` alone, exactly as the claim and the status read are, so the subject may ask for
-- its own deletion and may never perform it.
--
-- The order of the two deletions is forced by the schema rather than chosen. `teams_owner_user_id_fkey`
-- stays restrictive, so a condemned team has to go before its owner's identity or the identity step
-- is refused outright. Deleting the auth row takes the profile, the memberships and every session
-- with it. What survives is the username reservation, which carries no foreign key and is therefore
-- untouched, and the receipt, which carries none either and so outlives the account it names.
--
-- Each step is its own block, so a step that fails leaves the steps before it standing and the
-- receipt records `failed` rather than losing the work. Continuation is then the same pair of calls
-- as the first run -- claim, then finalize -- because the claim is the only admission point and the
-- only place attempts are counted; nothing here may widen that bound.
--
-- Deliberately absent, and each the next child's: revoking the invitations this account issued or
-- was addressed, and any retention sweep of the receipt. Nothing is scheduled either -- this runs
-- when `service_role` calls it, and the follow-up `account-deletion-finalization-scheduler` change
-- owns pg_cron, pg_net and Vault. Rollback is a forward revoke of the one grant below and then the
-- function: it MUST NOT drop `account_deletion_requests`.

create function public.finalize_account_deletion(p_user_id uuid)
returns public.account_deletion_state language plpgsql security definer set search_path = '' as $$
declare
  standing public.account_deletion_state;
  step_failed boolean := false;
  outcome public.account_deletion_state;
begin
  select r.state into standing from public.account_deletion_requests r where r.user_id = p_user_id;
  -- A completed request is answered, never re-run: repeating the call reports completion and
  -- restores nothing. Every other state is refused, so the durable `in_progress` cannot be skipped,
  -- an unclaimed request cannot be finalized behind the ledger's back, and a receipt that has spent
  -- its three admissions stays frozen until an operator intervenes.
  if standing = 'done' then
    return standing;
  end if;
  if standing is null or standing <> 'in_progress' then
    raise exception 'deletion: finalization not permitted' using errcode = '22023';
  end if;

  -- The teams condemned at request time. A selection cascades off its team, so a team already
  -- deleted by an earlier attempt leaves nothing behind and this step becomes a no-op.
  begin
    delete from public.teams t where t.id in (
      select s.team_id from public.account_deletion_team_selections s
      join public.account_deletion_requests r on r.id = s.request_id
      where r.user_id = p_user_id);
  exception when others then step_failed := true;
  end;

  -- The identity. `postgres` owns this function and holds the privilege, so no Admin API is needed.
  begin
    delete from auth.users u where u.id = p_user_id;
  exception when others then step_failed := true;
  end;

  outcome := (case when step_failed then 'failed' else 'done' end)::public.account_deletion_state;
  update public.account_deletion_requests r
  set state = outcome, updated_at = pg_catalog.now()
  where r.user_id = p_user_id;
  return outcome;
end;
$$;

-- Revoke first, then grant to the one principal: the default `execute` to PUBLIC is the hole this
-- closes, and this is the most privileged function in the schema.
revoke execute on function public.finalize_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.finalize_account_deletion(uuid) to service_role;
