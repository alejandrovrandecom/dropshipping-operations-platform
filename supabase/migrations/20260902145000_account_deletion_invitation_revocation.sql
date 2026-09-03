-- Account deletion invitation revocation, and the ordered halt that makes it retryable. This is a
-- forward `create or replace` of the spine shipped by `…140000_…finalization.sql`: every behaviour
-- that migration established is preserved verbatim -- the `22023` guard for anything but
-- `in_progress`, the idempotent `done` answer, condemned teams before the identity, the outcome
-- write, and the `service_role`-only boundary. Replacing rather than dropping is deliberate: a
-- `drop` would reset the function's ACL to the default `execute` for PUBLIC, and the reproducibility
-- function inventory would fail on it. This migration therefore issues no grant of its own.
--
-- Two things are added. First, the revocation the spine deliberately left out: an account's open
-- invitations, in both directions -- those it issued, and those addressed to the address its
-- profile holds. Only unaccepted rows go; an accepted invitation is history and keeps its facts.
--
-- Second, and inseparable from it, each later step now runs only while no earlier step has failed.
-- That is a safety property, not tidiness. Revocation matches the addressed scope through the
-- profile's address, and the identity step takes that profile with it. Letting the identity step run
-- past a failed revocation would destroy the only handle a later run has on the invitations still
-- owed, leaving a `failed` receipt that no retry could ever complete. Steps halt where they break,
-- the receipt records `failed`, and the next claim-then-finalize pair resumes with the work intact.
--
-- The claim remains the only admission point and the only writer of `attempts`; nothing here counts
-- an execution. Retention and any sweep stay out: they belong to the next child. Rollback is another
-- forward `create or replace` restoring the spine body, never a drop.

create or replace function public.finalize_account_deletion(p_user_id uuid)
returns public.account_deletion_state language plpgsql security definer set search_path = '' as $$
declare
  standing public.account_deletion_state;
  subject_email text;
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

  -- Both invitation scopes, and only the ones still open. The address is read here rather than
  -- passed in, because the profile is the record of it and the next step is what removes that record.
  if not step_failed then begin
    select pg_catalog.lower(p.email) into subject_email
    from public.profiles p where p.user_id = p_user_id;
    delete from public.team_invitations i
    where i.accepted_at is null and (i.invited_by = p_user_id or i.email = subject_email);
  exception when others then step_failed := true;
  end; end if;

  -- The identity. `postgres` owns this function and holds the privilege, so no Admin API is needed.
  if not step_failed then begin
    delete from auth.users u where u.id = p_user_id;
  exception when others then step_failed := true;
  end; end if;

  outcome := (case when step_failed then 'failed' else 'done' end)::public.account_deletion_state;
  update public.account_deletion_requests r
  set state = outcome, updated_at = pg_catalog.now()
  where r.user_id = p_user_id;
  return outcome;
end;
$$;
