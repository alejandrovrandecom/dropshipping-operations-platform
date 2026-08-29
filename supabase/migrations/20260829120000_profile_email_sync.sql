-- Confirmed account email changes must follow the account, or an invitation addressed to the new
-- address would never match its recipient. GoTrue parks a merely requested address in
-- `auth.users.email_change` and promotes it to `auth.users.email` only inside ConfirmEmailChange,
-- so triggering on the persisted `email` column *is* the confirmed-only contract. An
-- `email_confirmed_at` predicate would add nothing but a stale-forever mode.

-- `security definer` is required here, not stylistic: triggers on `auth.users` run as
-- `supabase_auth_admin`, which holds no privilege on `public.profiles` and could not pass its forced
-- row level security in any case. Owned by `postgres`, this is the same controlled write path as
-- `handle_new_user`, with an empty search_path so no caller-controlled schema can shadow a reference.
--
-- The address is stored verbatim. `accept_invitation` already lowercases both sides at comparison
-- time, so normalizing here would only diverge from how `handle_new_user` writes the same column.
-- Keep prose out of the body itself: `reproducibility.test.ts` scans every definer body for
-- unqualified relation names, and English like "from the" reads as one.
create function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Account-local by predicate: it can neither create a profile nor reach another account's row.
  update public.profiles set email = new.email where user_id = new.id;
  return new;
end;
$$;

-- The `when` clause keeps every unrelated `auth.users` write -- sign-in timestamps, token rotation,
-- confirmation columns -- free of this trigger's cost.
create trigger on_auth_user_email_changed
after update of email on auth.users for each row
when (new.email is distinct from old.email)
execute function public.handle_user_email_change();

-- Trigger only: no client role ever calls this directly.
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;
