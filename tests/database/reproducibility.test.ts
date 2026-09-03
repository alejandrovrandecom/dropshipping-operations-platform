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
    "teams: created_at timestamp with time zone, id uuid, name text, owner_user_id uuid",
    "username_reservations: claimed_at timestamp with time zone, user_id uuid, username text"]],
  ["row level security, enabled and forced", `select relname || ': rls=' || relrowsecurity || ' forced='
    || relforcerowsecurity as fact ${PUBLIC_TABLES} order by 1`, [
    "launch_checklist_items: rls=true forced=true", "launch_checklist_template_items: rls=true forced=true",
    "launch_checklist_templates: rls=true forced=true", "launch_checklists: rls=true forced=true",
    "launch_events: rls=true forced=true", "launches: rls=true forced=true", "memberships: rls=true forced=true",
    "profiles: rls=true forced=true", "team_invitations: rls=true forced=true", "teams: rls=true forced=true",
    "username_reservations: rls=true forced=true"]],
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
    "team_invitations: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=rd/postgres", "teams: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=rd/postgres",
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
    'apply_checklist_template: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'claim_username: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'create_invitation: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'create_launch: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'ensure_owner_membership: secdef=true config=search_path="" acl=postgres=X/postgres',
    'handle_new_user: secdef=true config=search_path="" acl=postgres=X/postgres',
    'handle_user_email_change: secdef=true config=search_path="" acl=postgres=X/postgres',
    'hash_invitation_token: secdef=false config=search_path="" acl=postgres=X/postgres',
    'is_team_member: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'is_team_owner: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
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
  // parent unrepresentable. `f/r` protects `profiles` from disappearing under a launch record, and
  // `f/n` is the PostgreSQL 17 column-list `set null` that clears only `origin_template_id`.
  ["launch constraint inventory", `select c.relname || ': ' || string_agg(con.conname || '/' || con.contype::text ||
    case when con.contype = 'f' then '/' || con.confdeltype::text else '' end, ', ' order by con.conname) as fact
    from pg_constraint con join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'launch%' group by c.relname order by 1`, [
    "launch_checklist_items: launch_checklist_items_checklist_fkey/f/c, launch_checklist_items_created_by_fkey/f/r, launch_checklist_items_label_check/c, launch_checklist_items_pkey/p, launch_checklist_items_position_check/c",
    "launch_checklist_template_items: launch_checklist_template_items_created_by_fkey/f/r, launch_checklist_template_items_label_check/c, launch_checklist_template_items_pkey/p, launch_checklist_template_items_position_check/c, launch_checklist_template_items_template_fkey/f/c",
    "launch_checklist_templates: launch_checklist_templates_created_by_fkey/f/r, launch_checklist_templates_name_check/c, launch_checklist_templates_pkey/p, launch_checklist_templates_team_fkey/f/c, launch_checklist_templates_team_id_id_key/u",
    "launch_checklists: launch_checklists_created_by_fkey/f/r, launch_checklists_launch_fkey/f/c, launch_checklists_launch_id_key/u, launch_checklists_origin_template_fkey/f/n, launch_checklists_pkey/p, launch_checklists_team_id_id_key/u",
    "launch_events: launch_events_actor_fkey/f/r, launch_events_kind_status_check/c, launch_events_launch_fkey/f/c, launch_events_pkey/p",
    "launches: launches_created_by_fkey/f/r, launches_name_check/c, launches_pkey/p, launches_team_fkey/f/c, launches_team_id_id_key/u, launches_trash_prior_status_check/c"]],
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
  expect(bodies).toHaveLength(14);
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
