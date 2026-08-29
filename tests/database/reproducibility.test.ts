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
    "memberships: created_at timestamp with time zone, id uuid, team_id uuid, user_id uuid",
    "profiles: created_at timestamp with time zone, display_name text, email text, user_id uuid",
    "team_invitations: accepted_at timestamp with time zone, accepted_by uuid, created_at timestamp with time zone, email text, expires_at timestamp with time zone, id uuid, invited_by uuid, team_id uuid, token_hash text",
    "teams: created_at timestamp with time zone, id uuid, name text, owner_user_id uuid"]],
  ["row level security, enabled and forced", `select relname || ': rls=' || relrowsecurity || ' forced='
    || relforcerowsecurity as fact ${PUBLIC_TABLES} order by 1`, ["memberships: rls=true forced=true",
    "profiles: rls=true forced=true", "team_invitations: rls=true forced=true", "teams: rls=true forced=true"]],
  ["policy inventory", `select tablename || ': ' || string_agg(policyname || '/' || cmd || '/' ||
    array_to_string(roles, '+'), ', ' order by policyname) as fact from pg_policies
    where schemaname = 'public' group by tablename order by 1`, [
    "memberships: memberships_delete_owner/DELETE/authenticated, memberships_insert_owner/INSERT/authenticated, memberships_select_member/SELECT/authenticated",
    "profiles: profiles_select_self/SELECT/authenticated, profiles_update_self/UPDATE/authenticated",
    "team_invitations: team_invitations_delete_owner/DELETE/authenticated, team_invitations_select_owner/SELECT/authenticated",
    "teams: teams_delete_owner/DELETE/authenticated, teams_insert_self_owned/INSERT/authenticated, teams_select_member/SELECT/authenticated, teams_update_owner/UPDATE/authenticated"]],
  ["table grants", `select relname || ': ' || coalesce(array_to_string(relacl, ', '), 'DEFAULT') as fact
    ${PUBLIC_TABLES} order by 1`, [
    "memberships: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=rd/postgres",
    "profiles: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=r/postgres",
    "team_invitations: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=rd/postgres", "teams: postgres=arwdDxtm/postgres, service_role=Dxtm/postgres, authenticated=rd/postgres"]],
  ["column grants", `select c.relname || '.' || a.attname || ': ' || array_to_string(a.attacl, ', ') as fact
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and a.attacl is not null order by 1`, [
    "memberships.team_id: authenticated=a/postgres", "memberships.user_id: authenticated=a/postgres", "profiles.display_name: authenticated=w/postgres", "teams.name: authenticated=aw/postgres"]],
  ["function definer, search_path and execute inventory", `select p.proname || ': secdef=' || p.prosecdef || ' config='
    || coalesce(array_to_string(p.proconfig, ','), 'NONE') || ' acl=' || coalesce(array_to_string(p.proacl, ', '), 'DEFAULT')
    as fact from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`, [
    'accept_invitation: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'create_invitation: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'ensure_owner_membership: secdef=true config=search_path="" acl=postgres=X/postgres',
    'handle_new_user: secdef=true config=search_path="" acl=postgres=X/postgres',
    'handle_user_email_change: secdef=true config=search_path="" acl=postgres=X/postgres',
    'hash_invitation_token: secdef=false config=search_path="" acl=postgres=X/postgres',
    'is_team_member: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres',
    'is_team_owner: secdef=true config=search_path="" acl=postgres=X/postgres, authenticated=X/postgres']],
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
  expect(bodies).toHaveLength(8);
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
