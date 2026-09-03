-- Account deletion receipt retention. The receipt outlives the account it names -- it carries no
-- foreign key precisely so nothing can take it early -- but it is not meant to outlive it forever.
-- This adds the only cleanup in the contract, and cleanup is the one MAY here: the spec promises a
-- privacy-safe receipt and permits a later purge without any fixed retention or purge-time
-- guarantee. Everything else in this change is a MUST, so this must never be able to cost one.
--
-- It is a trigger, not a sweep inside the finalizer and not a scheduled job. No extension is
-- installed and none is needed: the trigger fires on the one statement that writes a terminal
-- state, which is the finalizer's outcome write. `claim` writes only `in_progress` and the
-- idempotent `done` path returns before updating anything, so neither fires it -- the WHEN clause
-- below is what makes that a property of the schema rather than a convention.
--
-- Two bounds keep it honest. It takes only terminal receipts past the retention window, so a live
-- request and a fresh receipt are equally safe; and it takes at most `cap` of them per firing, so a
-- long-neglected table can never turn an unbounded delete loose inside a finalizing transaction.
-- Draining is therefore gradual and best-effort, which is exactly what the spec allows.
--
-- The delete sits in its own block whose handler discards everything. A cleanup that fails leaves
-- the receipt standing and the run untouched: the outcome is already written when this fires, and
-- swallowing here is what stops a MAY from ever aborting a MUST.
--
-- `execute` is revoked from every client role and from `service_role` too. Nothing calls this
-- directly; it is reachable only as a trigger. Rollback is forward-only: drop the trigger, then
-- this function. Never drop `account_deletion_requests`.

create function public.sweep_expired_deletion_receipts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  retention constant interval := interval '30 days';
  cap constant integer := 100;
begin
  begin
    delete from public.account_deletion_requests r
    where r.user_id in (
      select x.user_id from public.account_deletion_requests x
      where x.state in ('done', 'failed')
        and x.updated_at < pg_catalog.now() - retention
      limit cap);
  exception when others then null;
  end;
  return null;
end;
$$;

create trigger account_deletion_requests_sweep_expired
after update on public.account_deletion_requests
for each row when (new.state in ('done', 'failed'))
execute function public.sweep_expired_deletion_receipts();

revoke execute on function public.sweep_expired_deletion_receipts()
  from public, anon, authenticated, service_role;
