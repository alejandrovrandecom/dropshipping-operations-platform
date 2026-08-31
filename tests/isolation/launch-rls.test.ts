// Denial proofs for the launch tenant boundary. Every case below must fail closed in the database
// -- through a missing grant, a row level security predicate or an RPC raise -- and never in
// application code. The six launch tables are treated as one surface: a boundary that holds for
// `launches` but leaks through `launch_checklist_items` is not a boundary.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, signIn, sql, uniqueEmail } from "../support/local-stack";

type Actor = Awaited<ReturnType<typeof signIn>>;

const LAUNCH_TABLES = ["launches", "launch_events", "launch_checklists", "launch_checklist_items",
  "launch_checklist_templates", "launch_checklist_template_items"] as const;

let owner: Actor, member: Actor, outsider: Actor;
let teamId: string, outsiderTeamId: string;
let teamLaunch: string, teamTemplate: string, teamChecklist: string;
let outsiderLaunch: string, outsiderTemplate: string;

const startTeam = async (actor: Actor, name: string): Promise<string> =>
  (await actor.client.from("teams").insert({ name }).select("id").single()).data!.id as string;
const createLaunch = async (actor: Actor, team: string, name: string): Promise<string> => {
  const { data, error } = await actor.client.rpc("create_launch", { p_launch_id: randomUUID(), p_team_id: team, p_name: name });
  expect(error).toBeNull();
  return data as string;
};

async function template(actor: Actor, team: string, name: string): Promise<string> {
  const created = await actor.client.from("launch_checklist_templates").insert({ team_id: team, name }).select("id").single();
  expect(created.error).toBeNull();
  const id = created.data!.id as string;
  expect((await actor.client.from("launch_checklist_template_items")
    .insert({ team_id: team, template_id: id, label: "Step", is_required: true, position: 0 })).error).toBeNull();
  return id;
}

beforeAll(async () => {
  [owner, member, outsider] = await Promise.all(
    ["rls-owner", "rls-member", "rls-outsider"].map((label) => signIn(uniqueEmail(label))));
  teamId = await startTeam(owner, "Guarded team");
  outsiderTeamId = await startTeam(outsider, "Outside team");
  await sql("insert into public.memberships (team_id, user_id) values ($1, $2)", [teamId, member.userId]);

  teamTemplate = await template(member, teamId, "Guarded checklist");
  teamLaunch = await createLaunch(member, teamId, "Guarded launch");
  const applied = await member.client.rpc("apply_checklist_template", { p_launch_id: teamLaunch, p_template_id: teamTemplate });
  expect(applied.error).toBeNull();
  teamChecklist = applied.data as string;

  outsiderTemplate = await template(outsider, outsiderTeamId, "Outside checklist");
  outsiderLaunch = await createLaunch(outsider, outsiderTeamId, "Outside launch");
  // The outsider's team is populated across all six tables too, so "the member sees nothing here"
  // can be told apart from "there was nothing to see".
  expect((await outsider.client.rpc("apply_checklist_template",
    { p_launch_id: outsiderLaunch, p_template_id: outsiderTemplate })).error).toBeNull();
});

describe("unauthenticated callers", () => {
  it("reads no launch row and cannot reach any launch RPC", async () => {
    const anon = anonClient();
    for (const table of LAUNCH_TABLES) expect([table, (await anon.from(table).select("*")).data ?? []]).toEqual([table, []]);
    for (const [fn, args] of [
      ["create_launch", { p_launch_id: randomUUID(), p_team_id: teamId, p_name: "anonymous" }],
      ["transition_launch", { p_launch_id: teamLaunch, p_next: "discarded" }],
      ["restore_launch", { p_launch_id: teamLaunch }],
      ["apply_checklist_template", { p_launch_id: teamLaunch, p_template_id: teamTemplate }],
      ["set_default_checklist_template", { p_team_id: teamId, p_template_id: teamTemplate }],
    ] as const) expect([fn, (await anon.rpc(fn, args)).error]).not.toEqual([fn, null]);

    const [{ count }] = await sql<{ count: string }>("select count(*) from public.launches where team_id = $1", [teamId]);
    expect(Number(count)).toBe(1);
  });
});

describe("cross-team reads", () => {
  it("hides every row of all six launch tables from a non-member", async () => {
    for (const table of LAUNCH_TABLES)
      expect([table, (await outsider.client.from(table).select("*").eq("team_id", teamId)).data ?? []]).toEqual([table, []]);
    // The outsider's own team is fully visible, so the emptiness above is isolation, not a dead read.
    for (const table of LAUNCH_TABLES) {
      const own = (await outsider.client.from(table).select("*").eq("team_id", outsiderTeamId)).data ?? [];
      expect([table, own.length > 0]).toEqual([table, true]);
    }
  });

  it("refuses cross-team updates on every client-writable launch table", async () => {
    const attempts: Array<[string, unknown[]]> = [
      ["launches", (await outsider.client.from("launches").update({ name: "seized" }).eq("id", teamLaunch).select()).data ?? []],
      ["launch_checklist_templates", (await outsider.client.from("launch_checklist_templates")
        .update({ name: "seized" }).eq("id", teamTemplate).select()).data ?? []],
      ["launch_checklist_template_items", (await outsider.client.from("launch_checklist_template_items")
        .update({ label: "seized" }).eq("template_id", teamTemplate).select()).data ?? []],
      ["launch_checklist_items", (await outsider.client.from("launch_checklist_items")
        .update({ label: "seized" }).eq("checklist_id", teamChecklist).select()).data ?? []],
    ];
    for (const [table, rows] of attempts) expect([table, rows]).toEqual([table, []]);

    const [row] = await sql<{ name: string }>("select name from public.launches where id = $1", [teamLaunch]);
    expect(row.name).toBe("Guarded launch");
    const labels = await sql<{ label: string }>(
      "select label from public.launch_checklist_items where checklist_id = $1", [teamChecklist]);
    expect(labels.map((item) => item.label)).toEqual(["Step"]);
  });
});

describe("forged payloads", () => {
  it("refuses a template or item planted into a team the caller does not belong to", async () => {
    expect((await outsider.client.from("launch_checklist_templates")
      .insert({ team_id: teamId, name: "planted" }).select()).error).not.toBeNull();
    expect((await outsider.client.from("launch_checklist_template_items")
      .insert({ team_id: teamId, template_id: teamTemplate, label: "planted", is_required: true, position: 0 })
      .select()).error).not.toBeNull();
    // A forged tenant key on an item that points at the caller's own template is refused by the
    // composite foreign key even though the caller *is* a member of the named team.
    expect((await member.client.from("launch_checklist_template_items")
      .insert({ team_id: teamId, template_id: outsiderTemplate, label: "planted", is_required: true, position: 0 })
      .select()).error).not.toBeNull();

    const [{ count }] = await sql<{ count: string }>(
      "select count(*) from public.launch_checklist_template_items where team_id = $1", [teamId]);
    expect(Number(count)).toBe(1);
  });

  it("never lets a client set the default flag directly", async () => {
    expect((await member.client.from("launch_checklist_templates")
      .insert({ team_id: teamId, name: "self promoted", is_default: true }).select()).error).not.toBeNull();
    expect((await member.client.from("launch_checklist_templates")
      .update({ is_default: true }).eq("id", teamTemplate).select()).error).not.toBeNull();
    const [{ count }] = await sql<{ count: string }>(
      "select count(*) from public.launch_checklist_templates where team_id = $1 and is_default", [teamId]);
    expect(Number(count)).toBe(0);
  });
});

describe("RPC-only write paths", () => {
  it("refuses direct inserts into launches, snapshots, snapshot items and events", async () => {
    const attempts: Array<[string, { error: unknown }]> = [
      ["launches", await member.client.from("launches").insert({ team_id: teamId, name: "direct" }).select()],
      ["launch_checklists", await member.client.from("launch_checklists")
        .insert({ team_id: teamId, launch_id: teamLaunch }).select()],
      ["launch_checklist_items", await member.client.from("launch_checklist_items")
        .insert({ team_id: teamId, checklist_id: teamChecklist, label: "direct", is_required: true, position: 1 }).select()],
      ["launch_events", await member.client.from("launch_events")
        .insert({ team_id: teamId, launch_id: teamLaunch, kind: "created", to_status: "preparing" }).select()],
    ];
    for (const [table, result] of attempts) expect([table, result.error]).not.toEqual([table, null]);

    const [row] = await sql<{ launches: string; checklists: string; items: string; events: string }>(
      `select (select count(*) from public.launches where team_id = $1) as launches,
              (select count(*) from public.launch_checklists where team_id = $1) as checklists,
              (select count(*) from public.launch_checklist_items where team_id = $1) as items,
              (select count(*) from public.launch_events where team_id = $1) as events`, [teamId]);
    expect(row).toEqual({ launches: "1", checklists: "1", items: "1", events: "2" });
  });

  it("exposes no delete path on any launch table, to a member or to the team owner", async () => {
    for (const actor of [member, owner])
      for (const table of LAUNCH_TABLES)
        expect([table, (await actor.client.from(table).delete().eq("team_id", teamId).select()).error])
          .not.toEqual([table, null]);

    const [row] = await sql<{ launches: string; events: string }>(
      `select (select count(*) from public.launches where team_id = $1) as launches,
              (select count(*) from public.launch_events where team_id = $1) as events`, [teamId]);
    expect(row).toEqual({ launches: "1", events: "2" });
  });
});

// An absent row and a row the caller may not touch must be indistinguishable: a different message,
// or a different SQLSTATE, would turn every RPC into an existence oracle for other tenants.
describe("opaque authorization failures", () => {
  it("answers an unknown id and another team's id with the identical 42501 rejection", async () => {
    const absent = randomUUID();
    const probes: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ["create_launch", { p_launch_id: randomUUID(), p_team_id: absent, p_name: "probe" },
        { p_launch_id: randomUUID(), p_team_id: outsiderTeamId, p_name: "probe" }],
      ["transition_launch", { p_launch_id: absent, p_next: "discarded" }, { p_launch_id: outsiderLaunch, p_next: "discarded" }],
      ["restore_launch", { p_launch_id: absent }, { p_launch_id: outsiderLaunch }],
      ["apply_checklist_template", { p_launch_id: absent, p_template_id: teamTemplate },
        { p_launch_id: outsiderLaunch, p_template_id: teamTemplate }],
      ["set_default_checklist_template", { p_team_id: absent, p_template_id: null },
        { p_team_id: outsiderTeamId, p_template_id: null }],
    ];

    for (const [fn, unknownArgs, foreignArgs] of probes) {
      const unknown = await member.client.rpc(fn, unknownArgs);
      const foreign = await member.client.rpc(fn, foreignArgs);
      expect([fn, unknown.error?.code, foreign.error?.code]).toEqual([fn, "42501", "42501"]);
      expect([fn, unknown.error?.message]).toEqual([fn, foreign.error?.message]);
    }

    // The outsider's data is untouched by all of the probing above.
    const [row] = await sql<{ status: string; name: string }>(
      "select status, name from public.launches where id = $1", [outsiderLaunch]);
    expect(row).toEqual({ status: "preparing", name: "Outside launch" });
  });
});
