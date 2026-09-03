-- Account deletion claim ledger: the admission point for a privileged deletion run, and the bound on
-- how many times one may be admitted. The previous migration records intent; this one makes that
-- intent observable and claimable. Two entry points, execute-only and granted to `service_role`
-- alone -- a role holding no privilege on the receipt or on any tenant table -- so every client role
-- is shut out, the subject included: it may ask for its own deletion and may never perform it.
--
-- The run itself is the next migration, and nothing is scheduled here either: a request nobody
-- claims stays pending with no timing guarantee, and the follow-up
-- `account-deletion-finalization-scheduler` change owns pg_cron, pg_net and Vault, so this migration
-- installs no extension and creates no job. Rollback is a forward revoke of the two grants and
-- nothing else: it MUST NOT drop `account_deletion_requests`, whose whole purpose is to outlive the
-- account it describes.

-- The ledger lives on the receipt rather than beside it, and an integer is the whole of it: a record
-- that must survive deletion gains a counter and no trace of a person. `not null default 0` is what
-- makes the alter safe on a table that may already hold receipts -- every standing request starts at
-- a countable zero, and the request RPC that predates this column keeps writing rows that do too.
alter table public.account_deletion_requests add column attempts integer not null default 0;

-- The observable state, and the reason the claim below can be a separate call. Definer because no
-- client holds a privilege on the receipt; `null` for an account that never asked, a distinction
-- only `service_role` is ever in a position to draw.
create function public.account_deletion_status(p_user_id uuid)
returns public.account_deletion_state language sql stable security definer set search_path = '' as $$
  select r.state from public.account_deletion_requests r where r.user_id = p_user_id;
$$;

-- Claiming is split out of finalization precisely so `in_progress` is durable: it commits before any
-- deletion begins, so an administrator observes a run in flight rather than only its outcome. One
-- conditional statement makes it atomic, so two callers cannot both take the same receipt.
--
-- It is also the only admission point, which is what lets the bound live in one place. `pending` and
-- `failed` are the two states a run may begin at, and each admission spends one of three: the
-- initial run plus two retries. The fourth is refused by the same predicate that admitted the first,
-- so the refusal has no branch, no error and no message of its own -- the caller is handed the
-- standing state, which is exactly what a status read would have handed it. A completed request is
-- answered the same way and never reopened, and an exhausted one waits for an operator, not a timer.
create function public.claim_account_deletion(p_user_id uuid)
returns public.account_deletion_state language plpgsql security definer set search_path = '' as $$
declare
  admissions constant integer := 3;
  claimed public.account_deletion_state;
begin
  update public.account_deletion_requests r
     set state = 'in_progress'::public.account_deletion_state,
         attempts = r.attempts + 1, updated_at = pg_catalog.now()
   where r.user_id = p_user_id and r.state in ('pending', 'failed') and r.attempts < admissions
  returning r.state into claimed;
  return coalesce(claimed, public.account_deletion_status(p_user_id));
end;
$$;

-- Revoke first, then grant to the one principal: the default `execute` to PUBLIC is the hole this
-- closes, and these two are the most privileged functions in the schema.
revoke execute on function public.account_deletion_status(uuid),
  public.claim_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_status(uuid),
  public.claim_account_deletion(uuid) to service_role;
