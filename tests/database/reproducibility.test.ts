// Reproducibility and security proof. The suite resets the database first, so every assertion
// describes an environment rebuilt from `supabase/migrations/` alone: schema, policy, grant,
// function or type drift fails here, not in production. Every CLI call uses fixed arguments.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import { sql } from "../support/local-stack";

const cli = (...args: string[]): { out: string; log: string } => {
  const run = spawnSync("npx", ["--yes", "supabase", ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`supabase ${args.join(" ")} exited ${run.status}: ${run.stderr}`);
  return { out: run.stdout, log: run.stderr };
};
const facts = async (query: string): Promise<string[]> =>
  (await sql<{ fact: string }>(query)).map((row) => row.fact);
const PUBLIC_TABLES = `from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'`;
beforeAll(() => void cli("db", "reset"), 180_000);

// The documented structure of a database rebuilt from migrations alone. Every new table,
// column, policy, grant or function must be added here in the same PR, or this suite fails.
const INVENTORY: Array<[string, string, string[]]> = [
  ["table and column inventory", `select c.relname || ': ' || string_agg(a.attname || ' ' || format_type(a.atttypid,
    a.atttypmod), ', ' order by a.attname) as fact from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r' group by c.relname order by 1`, [
    "launch_checklist_items: checklist_id uuid, created_at timestamp with time zone, created_by uuid, id uuid, is_complete boolean, is_required boolean, label text, position integer, team_id uuid",
    "launch_checklist_template_items: created_at timestamp with time zone, created_by uuid, id uuid, is_required boolean, label text, position integer, team_id uuid, template_id uuid",
    "launch_checklist_templates: created_at timestamp with time zone, created_by uuid, id uuid, is_default boolean, name text, team_id uuid",
    "launch_checklists: created_at timestamp with time zone, created_by uuid, id uuid, launch_id uuid, origin_template_id uuid, team_id uuid",
    "launch_events: actor_user_id uuid, created_at timestamp with time zone, from_status launch_status, kind launch_event_kind, launch_id uuid, seq bigint, team_id uuid, to_status launch_status",
    "launches: created_at timestamp with time zone, created_by uuid, id uuid, name text, notes text, prior_status launch_status, status launch_status, team_id uuid, url text",
    "memberships: created_at timestamp with time zone, id uuid, team_id uuid, user_id uuid",
    "profiles: created_at timestamp with time zone, display_name text, email text, user_id uuid",
    "team_invitations: accepted_at timestamp with time zone, accepted_by uuid, created_at timestamp with time zone, email text, expires_at timestamp with time zone, id uuid, invited_by uuid, team_id uuid, token_hash text",
    "team_ownership_transfers: accepted_at timestamp with time zone, created_at timestamp with time zone, expires_at timestamp with time zone, from_user_id uuid, id uuid, team_id uuid, to_user_id uuid",
    "teams: created_at timestamp with time zone, id uuid, name text, owner_user_id uuid",
    "username_reservations: claimed_at timestamp with time zone, user_id uuid, username text"]],
  ["row level security, enabled and forced", `select relname || ': rls=' || relrowsecurity || ' forced='
    || relforcerowsecurity as fact ${PUBLIC_TABLES} order by 1`, [
    "launch_checklist_items: rls=true forced=true", "launch_checklist_template_items: rls=true forced=true",
    "launch_checklist_templates: rls=true forced=true", "launch_checklists: rls=true forced=true",
    "launch_events: rls=true forced=true", "launches: rls=true forced=true", "memberships: rls=true forced=true",
    "profiles: rls=true forced=true", "team_invitations: rls=true forced=true",
    "team_ownership_transfers: rls=true forced=true", "teams: rls=true forced=true",
    "username_reservations: rls=true forced=true"]],
  // `team_ownership_transfers` is absent on purpose, and its absence is the assertion: with security
  // forced and no permissive policy, adding one would appear here and fail this list.
  ["policy inventory", `select tablename || ': ' || string_agg(policyname || '/' || cmd || '/' ||
    array_to_string(roles, '+'), ', ' order by policyname) as fact from pg_policies
    where schemaname = 'public' group by tablename order by 1`, [
    "launch_checklist_items: launch_checklist_items_select_member/SELECT/authenticated, launch_checklist_items_update_member/UPDATE/authenticated",
    "launch_checklist_template_items: launch_checklist_template_items_insert_member/INSERT/authenticated, launch_checklist_template_items_select_member/SELECT/authenticated, launch_checklist_template_items_update_member/UPDATE/authenticated",
    "launch_checklist_templates: launch_checklist_templates_insert_member/INSERT/authenticated, launch_checklist_templates_select_member/SELECT/authenticated, launch_checklist_templates_update_member/UPDATE/authenticated",
    "launch_checklists: launch_checklists_select_member/SELECT/authenticated",
    "launch_events: launch_events_select_member/SELECT/authenticated",
    "launches: launches_select_member/SELECT/authenticated, launches_update_member/UPDATE/authenticated",
    "memberships: memberships_delete_owner/DELETE/authenticated, memberships_insert_owner/INSERT/authenticated, memberships_select_member/SELECT/authenticated",
    "profiles: profiles_select_self/SELECT/authenticated, profiles_update_self/UPDATE/authenticated",
    "team_invitations: team_invitations_delete_owner/DELETE/authenticated, team_invitations_select_owner/SELECT/authenticated",
    "teams: teams_delete_owner/DELETE/authenticated, teams_insert_self_owned/INSERT/authenticated, teams_select_member/SELECT/authenticated, teams_update_owner/UPDATE/authenticated"]],
  ["table grants", `select relname || ': ' || coalesce(array_to_string(relacl, ', '), 'DEFAULT') as fact
    ${PUBLIC_TABLES} order by 1`, [
    "launch_checklist_items: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=r/postgres",
    "launch_checklist_template_items: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=r/postgres",
    "launch_checklist_templates: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=r/postgres",
    "launch_checklists: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=r/postgres",
    "launch_events: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=r/postgres",
    "launches: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=r/postgres",
    "memberships: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=rd/postgres",
    "profiles: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=r/postgres",
    "team_invitations: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=rd/postgres",
    // Joins the registry in holding no client privilege at all: the two RPCs are the only doors.
    "team_ownership_transfers: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres",
    "teams: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=rd/postgres",
    // The registry is the one table with no client privilege at all: no `select`, so no read and no
    // enumeration; no write, so the claim RPC is the only door and the reservation is immutable.
    "username_reservations: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres"]],
  ["column grants", `select c.relname || '.' || a.attname || ': ' || array_to_string(a.attacl, ', ') as fact
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and a.attacl is not null order by 1`, [
    "launch_checklist_items.is_complete: authenticated=w/postgres", "launch_checklist_items.is_required: authenticated=w/postgres",
    "launch_checklist_items.label: authenticated=w/postgres", "launch_checklist_items.position: authenticated=w/postgres",
    "launch_checklist_template_items.is_required: authenticated=aw/postgres", "launch_checklist_template_items.label: authenticated=aw/postgres",
    "launch_checklist_template_items.position: authenticated=aw/postgres", "launch_checklist_template_items.team_id: authenticated=a/postgres",
    "launch_checklist_template_items.template_id: authenticated=a/postgres",
    "launch_checklist_templates.name: authenticated=aw/postgres", "launch_checklist_templates.team_id: authenticated=a/postgres",
    "launches.name: authenticated=w/postgres", "launches.notes: authenticated=w/postgres", "launches.url: authenticated=w/postgres",
    "memberships.team_id: authenticated=a/postgres", "memberships.user_id: authenticated=a/postgres", "profiles.display_name: authenticated=w/postgres", "teams.name: authenticated=aw/postgres"]],
  ["function definer, search_path and execute inventory", `select p.proname || ': secdef=' || p.prosecdef || ' config='
    || coalesce(array_to_string(p.proconfig, ','), 'NONE') || ' acl=' || coalesce(array_to_string(p.proacl, ', '), 'DEFAULT')
    as fact from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`, [
    'accept_invitation: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'accept_team_ownership_transfer: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'apply_checklist_template: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'claim_username: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'create_invitation: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'create_launch: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    // The gate's two halves are ungranted on purpose: the enforcer is reachable only as a trigger,
    // and the predicate would otherwise be a self-status oracle with no caller in this contract.
    'enforce_username_claim: secdef=true config=search_path="" acl=postgres=X/postgres',
    'ensure_owner_membership: secdef=true config=search_path="" acl=postgres=X/postgres',
    'handle_new_user: secdef=true config=search_path="" acl=postgres=X/postgres',
    'handle_user_email_change: secdef=true config=search_path="" acl=postgres=X/postgres',
    'has_username: secdef=true config=search_path="" acl=postgres=X/postgres',
    'hash_invitation_token: secdef=false config=search_path="" acl=postgres=X/postgres',
    'is_team_member: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'is_team_owner: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'request_team_ownership_transfer: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'resolve_team_usernames: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'restore_launch: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'set_default_checklist_template: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'transition_launch: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres']],
  // The launch slice is the first to add enumerated domains, so its labels and their order are
  // part of the contract: `transition_launch` compares against these values by name.
  ["enum inventory", `select t.typname || ': ' || string_agg(e.enumlabel, ', ' order by e.enumsortorder) as fact
    from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' group by t.typname order by 1`, [
    "launch_event_kind: created, transitioned, checklist_applied",
    "launch_status: preparing, active, archived, discarded, trash"]],
  // Tenant safety here is structural, not procedural: every descendant reaches its team through a
  // composite key, so `f/c` on a `(team_id, parent_id)` foreign key is what makes a cross-tenant
  // parent unrepresentable. Every authoring reference is `f/n`: a launch record is a fact about the
  // team, so a finally deleted account clears its own name and leaves the row standing. The one
  // `f/n` that is not about deletion is the PostgreSQL 17 column-list `set null` on
  // `origin_template_id`, which clears the origin pointer alone and never the `not null` team.
  ["launch constraint inventory", `select c.relname || ': ' || string_agg(con.conname || '/' || con.contype::text ||
    case when con.contype = 'f' then '/' || con.confdeltype::text else '' end, ', ' order by con.conname) as fact
    from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'launch%' group by c.relname order by 1`, [
    "launch_checklist_items: launch_checklist_items_checklist_fkey/f/c, launch_checklist_items_created_by_fkey/f/n, launch_checklist_items_label_check/c, launch_checklist_items_pkey/p, launch_checklist_items_position_check/c",
    "launch_checklist_template_items: launch_checklist_template_items_created_by_fkey/f/n, launch_checklist_template_items_label_check/c, launch_checklist_template_items_pkey/p, launch_checklist_template_items_position_check/c, launch_checklist_template_items_template_fkey/f/c",
    "launch_checklist_templates: launch_checklist_templates_created_by_fkey/f/n, launch_checklist_templates_name_check/c, launch_checklist_templates_pkey/p, launch_checklist_templates_team_fkey/f/c, launch_checklist_templates_team_id_id_key/u",
    "launch_checklists: launch_checklists_created_by_fkey/f/n, launch_checklists_launch_fkey/f/c, launch_checklists_launch_id_key/u, launch_checklists_origin_template_fkey/f/n, launch_checklists_pkey/p, launch_checklists_team_id_id_key/u",
    "launch_events: launch_events_actor_fkey/f/n, launch_events_kind_status_check/c, launch_events_launch_fkey/f/c, launch_events_pkey/p",
    "launches: launches_created_by_fkey/f/n, launches_name_check/c, launches_pkey/p, launches_team_fkey/f/c, launches_team_id_id_key/u, launches_trash_prior_status_check/c"]],
  // The identity side of the same boundary, and the reason the relaxation is safe to make. Both
  // invitation participants are `f/n`, so a canceled or accepted invitation outlives its people.
  // The two that stay strict are the contract: `teams_owner_user_id_fkey/f/r` is what refuses to
  // delete an account still holding a live team, and `memberships_user_id_fkey/f/c` is what makes a
  // membership a live relationship rather than history. Weakening either one fails right here.
  ["identity and invitation constraint inventory", `select c.relname || ': ' || string_agg(con.conname || '/' ||
    con.contype::text || case when con.contype = 'f' then '/' || con.confdeltype::text else '' end, ', '
    order by con.conname) as fact from pg_constraint con join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
    and c.relname in ('memberships', 'profiles', 'team_invitations', 'teams') group by c.relname order by 1`, [
    "memberships: memberships_pkey/p, memberships_team_id_fkey/f/c, memberships_team_id_id_key/u, memberships_user_id_fkey/f/c",
    "profiles: profiles_pkey/p, profiles_user_id_fkey/f/c",
    "team_invitations: team_invitations_accepted_by_fkey/f/n, team_invitations_invited_by_fkey/f/n, team_invitations_pkey/p, team_invitations_team_id_fkey/f/c, team_invitations_token_hash_key/u",
    "teams: teams_name_check/c, teams_owner_user_id_fkey/f/r, teams_pkey/p"]],
  // An offer is live working state, so it cascades off its team and off either participant, and the
  // check is what stops an owner offering a team to themselves. "At most one live offer per team" is
  // the whole of the supersede rule and lives in an index, so it is inventoried where it actually is.
  ["transfer constraint and index inventory", `select 'constraints: ' || string_agg(con.conname || '/' ||
    con.contype::text || case when con.contype = 'f' then '/' || con.confdeltype::text else '' end, ', '
    order by con.conname) as fact from pg_constraint con
    where con.conrelid = 'public.team_ownership_transfers'::regclass
    union all select 'indexes: ' || string_agg(i.relname || '/' || case when x.indisunique then 'unique'
    else 'plain' end || case when x.indpred is not null then '/partial' else '' end, ', ' order by i.relname)
    from pg_index x join pg_class i on i.oid = x.indexrelid
    where x.indrelid = 'public.team_ownership_transfers'::regclass`, [
    "constraints: team_ownership_transfers_from_user_id_fkey/f/c, team_ownership_transfers_pkey/p, team_ownership_transfers_recipient_check/c, team_ownership_transfers_team_id_fkey/f/c, team_ownership_transfers_to_user_id_fkey/f/c",
    "indexes: team_ownership_transfers_pending_idx/unique/partial, team_ownership_transfers_pkey/unique"]],
  // `set null` is only half a relaxed reference: on a required column the referential action would
  // raise a fresh violation and refuse the deletion again, so nullability is inventoried beside the
  // actions. The four columns that stay `required` are as much of the contract as the eight that do
  // not -- a team keeps its owner, a membership keeps its member.
  ["deletion reference nullability", `select c.relname || '.' || a.attname || ': ' ||
    case when a.attnotnull then 'required' else 'nullable' end as fact from pg_attribute a
    join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    and a.attname in ('created_by', 'actor_user_id', 'invited_by', 'accepted_by', 'owner_user_id', 'user_id')
    order by 1`, [
    "launch_checklist_items.created_by: nullable", "launch_checklist_template_items.created_by: nullable",
    "launch_checklist_templates.created_by: nullable", "launch_checklists.created_by: nullable",
    "launch_events.actor_user_id: nullable", "launches.created_by: nullable",
    "memberships.user_id: required", "profiles.user_id: required",
    "team_invitations.accepted_by: nullable", "team_invitations.invited_by: nullable",
    "teams.owner_user_id: required", "username_reservations.user_id: required"]],
  // The partial unique index is the whole of the "at most one default" rule, so it is inventoried
  // rather than left to a procedural check inside the setter.
  ["launch index inventory", `select c.relname || ': ' || string_agg(i.relname || '/' ||
    case when x.indisunique then 'unique' else 'plain' end || case when x.indpred is not null then '/partial' else '' end,
    ', ' order by i.relname) as fact from pg_index x join pg_class c on c.oid = x.indrelid
    join pg_class i on i.oid = x.indexrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'launch%' group by c.relname order by 1`, [
    "launch_checklist_items: launch_checklist_items_pkey/unique, launch_checklist_items_team_id_checklist_id_idx/plain",
    "launch_checklist_template_items: launch_checklist_template_items_pkey/unique, launch_checklist_template_items_team_id_template_id_idx/plain",
    "launch_checklist_templates: launch_checklist_templates_default_idx/unique/partial, launch_checklist_templates_pkey/unique, launch_checklist_templates_team_id_id_key/unique",
    "launch_checklists: launch_checklists_launch_id_key/unique, launch_checklists_pkey/unique, launch_checklists_team_id_id_key/unique, launch_checklists_team_id_origin_template_id_idx/plain",
    "launch_events: launch_events_pkey/unique, launch_events_team_id_launch_id_idx/plain, launch_events_team_id_seq_idx/plain",
    "launches: launches_pkey/unique, launches_team_id_id_key/unique"]],
  // The registry's absent foreign key is a decision, not an omission: a reservation has to outlive
  // the account that made it, and every referential action destroys exactly that. Inventorying the
  // constraints is what keeps a later "fix" from quietly adding one. The two unique keys are the
  // whole contract: the primary key makes a name global, `user_id` makes a claim one-time.
  ["username registry constraint inventory", `select con.conname || '/' || con.contype::text as fact
    from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'username_reservations' order by 1`, [
    "username_reservations_pkey/p", "username_reservations_user_id_key/u", "username_reservations_username_check/c"]],
  ["username registry index inventory", `select i.relname || '/' ||
    case when x.indisunique then 'unique' else 'plain' end as fact from pg_index x
    join pg_class c on c.oid = x.indrelid join pg_class i on i.oid = x.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'username_reservations' order by 1`, [
    "username_reservations_pkey/unique", "username_reservations_user_id_key/unique"]],
  // The gate is eleven statement-level triggers and nothing else, so this is the whole of it. The
  // definitions are compared verbatim: a trigger dropped, narrowed to a row, moved to `after`,
  // pointed at another function, or widened past `display_name` on `profiles` fails right here.
  // `teams` insert and delete are gated twice over -- once directly, and once through the
  // memberships write that the owner-membership trigger and the delete cascade each perform. That
  // is defense in depth and is kept deliberately, which is why the row trigger is inventoried too.
  ["trigger inventory", `select pg_catalog.pg_get_triggerdef(t.oid) as fact from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal order by c.relname, t.tgname`, [
    "CREATE TRIGGER launch_checklist_items_require_username BEFORE INSERT OR UPDATE ON public.launch_checklist_items FOR EACH STATEMENT EXECUTE FUNCTION enforce_username_claim()",
    "CREATE TRIGGER launch_checklist_template_items_require_username BEFORE INSERT OR UPDATE ON public.launch_checklist_template_items FOR EACH STATEMENT EXECUTE FUNCTION enforce_username_claim()",
    "CREATE TRIGGER launch_checklist_templates_require_username BEFORE INSERT OR UPDATE ON public.launch_checklist_templates FOR EACH STATEMENT EXECUTE FUNCTION enforce_username_claim()",
    "CREATE TRIGGER launch_checklists_require_username BEFORE INSERT OR UPDATE ON public.launch_checklists FOR EACH STATEMENT EXECUTE FUNCTION enforce_username_claim()",
    "CREATE TRIGGER launch_events_require_username BEFORE INSERT OR UPDATE ON public.launch_events FOR EACH STATEMENT EXECUTE FUNCTION enforce_username_claim()",
    "CREATE TRIGGER launches_require_username BEFORE INSERT OR UPDATE ON public.launches FOR EACH STATEMENT EXECUTE FUNCTION enforce_username_claim()",
    "CREATE TRIGGER memberships_require_username BEFORE INSERT OR DELETE ON public.memberships FOR EACH STATEMENT EXECUTE FUNCTION enforce_username_claim()",
    "CREATE TRIGGER profiles_require_username BEFORE UPDATE OF display_name ON public.profiles FOR EACH STATEMENT EXECUTE FUNCTION enforce_username_claim()",
    "CREATE TRIGGER team_invitations_require_username BEFORE INSERT OR DELETE OR UPDATE ON public.team_invitations FOR EACH STATEMENT EXECUTE FUNCTION enforce_username_claim()",
    "CREATE TRIGGER team_ownership_transfers_require_username BEFORE INSERT OR DELETE OR UPDATE ON public.team_ownership_transfers FOR EACH STATEMENT EXECUTE FUNCTION enforce_username_claim()",
    "CREATE TRIGGER teams_ensure_owner_membership AFTER INSERT ON public.teams FOR EACH ROW EXECUTE FUNCTION ensure_owner_membership()",
    "CREATE TRIGGER teams_require_username BEFORE INSERT OR DELETE OR UPDATE ON public.teams FOR EACH STATEMENT EXECUTE FUNCTION enforce_username_claim()"]],
];
it.each(INVENTORY)("matches the documented %s", async (_label, query, expected) => {
  expect(await facts(query)).toEqual(expected);
});
it("applies exactly the version-controlled migrations", async () => {
  const onDisk = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).map((f) => f.split("_")[0]).sort();
  expect(onDisk.length).toBeGreaterThan(0);
  expect(await facts("select version as fact from supabase_migrations.schema_migrations order by 1")).toEqual(onDisk);
});
it("grants no privilege to anon or PUBLIC and never a blanket GRANT ALL", async () => {
  // An ACL entry reads `grantee=privileges/grantor`; a PUBLIC grant has an empty grantee.
  for (const acl of await facts(`select coalesce(array_to_string(relacl, ', '), 'DEFAULT') as fact ${PUBLIC_TABLES}`))
    expect(acl).not.toMatch(/\banon=|(?:^|, )=|\bauthenticated=arwdDxtm\b/);
});
it("references every object in a definer body through a schema qualifier", async () => {
  // An empty search_path resolves an unqualified name to nothing. The pattern covers every
  // relation target -- `from`, `join`, `insert into`, `update` -- while skipping `do update set`
  // and plpgsql's `returning ... into <variable>`, neither of which names a relation.
  const bodies = await facts("select prosrc as fact from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'");
  expect(bodies).toHaveLength(19);
  for (const body of bodies)
    for (const [, ref] of body.matchAll(/\b(?:from|join|insert\s+into|update)\s+(?!set\b)([a-z_][\w.]*)/gi)) expect(ref).toContain(".");
});
it("keeps privileged keys and service_role out of the client tree", () => {
  const files = readdirSync("src", { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) expect(readFileSync(`${f.parentPath}/${f.name}`, "utf8")).not.toMatch(/service_role|SERVICE_ROLE|sb_secret_[A-Za-z0-9]/);
});
it("keeps the committed database types identical to the generated schema", () => {
  // Regenerate with `pnpm -s db:types > src/lib/database.types.ts`; that script and this
  // assertion apply the same canonicalization, because the CLI emits a trailing blank line.
  const generated = `${cli("gen", "types", "typescript", "--local", "--schema", "public").out.replace(/\n+$/, "")}\n`;
  expect(readFileSync("src/lib/database.types.ts", "utf8")).toBe(generated);
});
it("passes the schema linter", () => {
  expect(cli("db", "lint", "--level", "warning").log).toContain("No schema errors found");
});
it("adds exactly six launch tables and two launch enums", async () => {
  // The launch slice ships as one complete database contract. "Exactly" is the point: a seventh
  // table or a stray enum means something was added outside the reviewed migration.
  expect(await facts(`select c.relname::text as fact ${PUBLIC_TABLES} and c.relname like 'launch%' order by 1`)).toEqual([
    "launch_checklist_items", "launch_checklist_template_items", "launch_checklist_templates",
    "launch_checklists", "launch_events", "launches"]);
  expect(await facts(`select t.typname::text as fact from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e' order by 1`)).toEqual(["launch_event_kind", "launch_status"]);
});
it("closes the claim through a forward revoke that never drops the registry", async () => {
  // Rollback for this slice is asymmetric on purpose. Revoking `execute` closes new claims, but
  // dropping the table would destroy permanent reservations, so the table is deliberately absent
  // from the revoke below. As above, the block always aborts, proving the path and undoing it.
  await expect(sql(`do $$
    begin
      revoke execute on function public.claim_username(text) from authenticated;
      if pg_catalog.has_function_privilege('authenticated', 'public.claim_username(text)', 'execute') then
        raise exception 'forward revoke left execute open';
      end if;
      if pg_catalog.to_regclass('public.username_reservations') is null then
        raise exception 'rollback must never drop the registry';
      end if;
      raise exception 'forward revoke verified';
    end $$;`)).rejects.toThrow("forward revoke verified");

  // The aborted block restored the grant, and the registry was never at risk in the first place.
  expect(await facts(`select p.proname::text || '=' ||
    pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')::text as fact
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_username'`)).toEqual(["claim_username=true"]);
});
it("reopens the gate through a symmetric rollback that leaves the registry standing", async () => {
  // The claim's rollback is asymmetric because a reservation is permanent; the gate's is not.
  // Dropping the ten triggers and revoking the resolver restores the exact pre-gate schema, so a
  // future migration can undo this slice completely. As above, the block proves the path, then aborts.
  await expect(sql(`do $$
    declare gate record;
    begin
      for gate in select c.relname as tbl, t.tgname as trg from pg_trigger t
        join pg_class c on c.oid = t.tgrelid where t.tgname like '%require_username'
      loop execute pg_catalog.format('drop trigger %I on public.%I', gate.trg, gate.tbl); end loop;
      revoke execute on function public.resolve_team_usernames(uuid) from authenticated;
      if exists (select 1 from pg_trigger where tgname like '%require_username') then
        raise exception 'rollback left a gate trigger behind';
      end if;
      if pg_catalog.to_regclass('public.username_reservations') is null then
        raise exception 'rollback must never drop the registry';
      end if;
      raise exception 'symmetric rollback verified';
    end $$;`)).rejects.toThrow("symmetric rollback verified");

  // The aborted block put all ten triggers back, and the resolver grant with them.
  expect(await facts("select count(*)::text as fact from pg_trigger where tgname like '%require_username'")).toEqual(["11"]);
  expect(await facts(`select pg_catalog.has_function_privilege('authenticated',
    'public.resolve_team_usernames(uuid)', 'execute')::text as fact`)).toEqual(["true"]);
});
it("closes the launch surface through a forward revoke, leaving applied migrations untouched", async () => {
  // Rollback here is forward-only: a *new* migration revokes the grants and the execute privilege,
  // and no applied file is ever edited. This runs that exact revoke inside a block whose last
  // statement always aborts, so the rollback path is proven and then undone in the same statement.
  const revoked = sql(`do $$
    begin
      revoke all on public.launches, public.launch_events, public.launch_checklists,
        public.launch_checklist_items, public.launch_checklist_templates,
        public.launch_checklist_template_items from authenticated;
      revoke execute on function public.create_launch(uuid, uuid, text),
        public.transition_launch(uuid, public.launch_status), public.restore_launch(uuid),
        public.apply_checklist_template(uuid, uuid),
        public.set_default_checklist_template(uuid, uuid) from authenticated;
      if pg_catalog.has_table_privilege('authenticated', 'public.launches', 'select') then
        raise exception 'forward revoke left table access open';
      end if;
      if pg_catalog.has_function_privilege('authenticated', 'public.create_launch(uuid, uuid, text)', 'execute') then
        raise exception 'forward revoke left execute open';
      end if;
      raise exception 'forward revoke verified';
    end $$;`);
  await expect(revoked).rejects.toThrow("forward revoke verified");

  // The aborted block restored everything, so the database still matches the migrations exactly.
  expect(await facts(`select c.relname::text || '=' || pg_catalog.has_table_privilege('authenticated', c.oid, 'select')::text
    as fact ${PUBLIC_TABLES} and c.relname like 'launch%' order by 1`)).toEqual([
    "launch_checklist_items=true", "launch_checklist_template_items=true", "launch_checklist_templates=true",
    "launch_checklists=true", "launch_events=true", "launches=true"]);
  expect(await facts(`select p.proname::text || '=' ||
    pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')::text as fact
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
    and p.proname in ('create_launch', 'transition_launch', 'restore_launch', 'apply_checklist_template',
      'set_default_checklist_template') order by 1`)).toEqual([
    "apply_checklist_template=true", "create_launch=true", "restore_launch=true",
    "set_default_checklist_template=true", "transition_launch=true"]);
});
it("relaxes an author to null on deletion and cannot be rolled back once it has", async () => {
  // The deletion slice's rollback is one-way, and this is the proof rather than the claim. The block
  // deletes an account the pre-relaxation schema refused outright, shows the author reference going
  // null instead of the row going away, then shows that re-tightening the column afterwards is
  // impossible: a forward migration may close new deletion paths, but it never restores an author.
  // As with every rollback proof here, the last statement always raises, so the whole thing is
  // undone in the same statement and the schema is left exactly as the migrations built it.
  await expect(sql(`do $$
    declare keeper uuid := pg_catalog.gen_random_uuid(); author uuid := pg_catalog.gen_random_uuid();
      team uuid; target uuid;
    begin
      insert into auth.users (id, email) values
        (keeper, 'rollback-keeper@example.test'), (author, 'rollback-author@example.test');
      insert into public.teams (owner_user_id, name) values (keeper, 'Rollback') returning id into team;
      insert into public.launches (team_id, created_by, name) values (team, author, 'Rollback') returning id into target;
      insert into public.launch_events (team_id, launch_id, kind, to_status, actor_user_id)
      values (team, target, 'created', 'preparing', author);

      delete from auth.users where id = author;
      if not exists (select 1 from public.launch_events e where e.launch_id = target and e.actor_user_id is null) then
        raise exception 'the relaxed actor reference did not survive as null';
      end if;
      if not exists (select 1 from public.launches l where l.id = target and l.created_by is null) then
        raise exception 'the relaxed creator reference did not survive as null';
      end if;
      begin
        alter table public.launch_events alter column actor_user_id set not null;
        raise exception 'rollback re-tightened a reference that already holds a null author';
      exception when not_null_violation then null;
      end;
      raise exception 'asymmetric rollback verified';
    end $$;`)).rejects.toThrow("asymmetric rollback verified");

  // The aborted block took the ghost account, its team and the attempted re-tightening with it.
  expect(await facts(`select conname || '/' || confdeltype::text as fact from pg_constraint
    where conrelid = 'public.launch_events'::regclass and contype = 'f' order by 1`)).toEqual([
    "launch_events_actor_fkey/n", "launch_events_launch_fkey/c"]);
  expect(await facts("select count(*)::text as fact from public.launch_events")).toEqual(["0"]);
});
