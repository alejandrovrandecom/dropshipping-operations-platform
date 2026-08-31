// Behavioral proof for private checklist templates, the optional team default and the single
// template-derived launch snapshot. Every `it` below is a scenario from
// `openspec/changes/launch-workspace-core/specs/launch-checklist-templates/spec.md`.
//
// Templates and their items are the only launch tables a client writes directly; snapshots exist
// solely as the output of `apply_checklist_template`, so "no client insert grant" is itself part
// of the contract proven here.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { signIn, sql, uniqueEmail } from "../support/local-stack";

type Actor = Awaited<ReturnType<typeof signIn>>;
type Item = [label: string, required: boolean];

let owner: Actor, member: Actor, outsider: Actor;
let teamId: string, altTeamId: string, outsiderTeamId: string;

const startTeam = async (actor: Actor, name: string): Promise<string> =>
  (await actor.client.from("teams").insert({ name }).select("id").single()).data!.id as string;

const launch = async (team: string, name: string, actor: Actor = member): Promise<string> => {
  const { data, error } = await actor.client.rpc("create_launch", { p_launch_id: randomUUID(), p_team_id: team, p_name: name });
  expect(error).toBeNull();
  return data as string;
};
const applyTemplate = (actor: Actor, target: string, template: string) =>
  actor.client.rpc("apply_checklist_template", { p_launch_id: target, p_template_id: template });
const setDefault = (actor: Actor, team: string, template: string | null) =>
  actor.client.rpc("set_default_checklist_template", { p_team_id: team, p_template_id: template });

/** Creates a template and its items directly, which is the granted client write path. */
async function template(team: string, name: string, items: Item[], actor: Actor = member): Promise<string> {
  const created = await actor.client.from("launch_checklist_templates").insert({ team_id: team, name }).select("id").single();
  expect(created.error).toBeNull();
  const id = created.data!.id as string;
  if (items.length > 0)
    expect((await actor.client.from("launch_checklist_template_items").insert(items.map(
      ([label, is_required], position) => ({ team_id: team, template_id: id, label, is_required, position })))).error).toBeNull();
  return id;
}

/** Snapshot items as `label/required/complete`, in the deterministic copy order. */
const snapshotItems = async (checklist: string): Promise<string[]> =>
  (await sql<{ fact: string }>(
    `select label || '/' || is_required || '/' || is_complete as fact from public.launch_checklist_items
      where checklist_id = $1 order by position, id`, [checklist])).map((item) => item.fact);
const templateItems = async (source: string): Promise<string[]> =>
  (await sql<{ fact: string }>(
    `select label || '/' || is_required as fact from public.launch_checklist_template_items
      where template_id = $1 order by position, id`, [source])).map((item) => item.fact);
const checklistsOf = async (target: string): Promise<string[]> =>
  (await sql<{ id: string }>("select id from public.launch_checklists where launch_id = $1", [target])).map((row) => row.id);
const defaultsOf = async (team: string): Promise<string[]> =>
  (await sql<{ name: string }>(
    "select name from public.launch_checklist_templates where team_id = $1 and is_default order by name", [team]))
    .map((row) => row.name);

beforeAll(async () => {
  [owner, member, outsider] = await Promise.all(
    ["tpl-owner", "tpl-member", "tpl-outsider"].map((label) => signIn(uniqueEmail(label))));
  teamId = await startTeam(owner, "Template team");
  altTeamId = await startTeam(owner, "Second team");
  outsiderTeamId = await startTeam(outsider, "Outside team");
  // The member belongs to both of the owner's teams, which is what makes a *cross-team* apply
  // distinguishable from a plain authorization failure.
  for (const team of [teamId, altTeamId])
    await sql("insert into public.memberships (team_id, user_id) values ($1, $2)", [team, member.userId]);
});

describe("private team templates", () => {
  // Scenario: Maintain template
  it("retains a member's template and item edits inside their own team", async () => {
    const id = await template(teamId, "Standard drop", [["Photos uploaded", true], ["Teaser posted", false]]);
    expect(await templateItems(id)).toEqual(["Photos uploaded/true", "Teaser posted/false"]);

    expect((await member.client.from("launch_checklist_templates").update({ name: "Standard drop v2" })
      .eq("id", id).select()).data).toHaveLength(1);
    const edited = await member.client.from("launch_checklist_template_items")
      .update({ label: "Photos approved", is_required: false, position: 5 })
      .eq("template_id", id).eq("label", "Photos uploaded").select();
    expect(edited.data).toHaveLength(1);

    const [row] = await sql<{ name: string }>("select name from public.launch_checklist_templates where id = $1", [id]);
    expect(row.name).toBe("Standard drop v2");
    expect(await templateItems(id)).toEqual(["Teaser posted/false", "Photos approved/false"]);
  });

  // Scenario: Deny cross-team access
  it("hides another team's template and items and refuses every mutation", async () => {
    const foreign = await template(outsiderTeamId, "Outsider checklist", [["Private step", true]], outsider);
    expect((await member.client.from("launch_checklist_templates").select("id").eq("id", foreign)).data ?? []).toEqual([]);
    expect((await member.client.from("launch_checklist_template_items").select("id").eq("template_id", foreign)).data ?? []).toEqual([]);
    expect((await member.client.from("launch_checklist_templates").update({ name: "seized" }).eq("id", foreign).select()).data ?? []).toEqual([]);
    expect((await member.client.from("launch_checklist_template_items").update({ label: "seized" })
      .eq("template_id", foreign).select()).data ?? []).toEqual([]);
    // Writing a row *into* the other team is refused by the insert predicate, not merely hidden.
    expect((await member.client.from("launch_checklist_templates").insert({ team_id: outsiderTeamId, name: "planted" }).select()).error).not.toBeNull();
    expect((await member.client.from("launch_checklist_template_items")
      .insert({ team_id: outsiderTeamId, template_id: foreign, label: "planted", is_required: true, position: 0 }).select()).error).not.toBeNull();

    expect(await templateItems(foreign)).toEqual(["Private step/true"]);
    const [row] = await sql<{ name: string }>("select name from public.launch_checklist_templates where id = $1", [foreign]);
    expect(row.name).toBe("Outsider checklist");
  });
});

describe("optional default", () => {
  // Scenario: No default exists
  it("creates a snapshot-free launch when the team has no default", async () => {
    const team = await startTeam(member, "No default team");
    await template(team, "Unpromoted", [["Step", true]]);
    expect(await defaultsOf(team)).toEqual([]);

    const id = await launch(team, "First launch");
    expect(await checklistsOf(id)).toEqual([]);
  });

  // Scenario: Change default
  it("promotes exactly one default without changing launches or snapshots", async () => {
    const team = await startTeam(member, "Default team");
    const first = await template(team, "Alpha", [["Alpha step", true]]);
    const second = await template(team, "Beta", [["Beta step", false]]);
    const target = await launch(team, "Untouched launch");
    const checklist = (await applyTemplate(member, target, first)).data as string;
    const itemsBefore = await snapshotItems(checklist);

    expect((await setDefault(member, team, first)).data).toBe(first);
    expect(await defaultsOf(team)).toEqual(["Alpha"]);
    // Triangulation: promoting a second template must demote the first, never accumulate.
    expect((await setDefault(member, team, second)).data).toBe(second);
    expect(await defaultsOf(team)).toEqual(["Beta"]);
    // A team may also have no default at all.
    const cleared = await setDefault(member, team, null);
    expect(cleared.error).toBeNull();
    expect(await defaultsOf(team)).toEqual([]);

    // Designation only: the launch, its snapshot and its items are untouched throughout.
    const [row] = await sql<{ status: string }>("select status from public.launches where id = $1", [target]);
    expect(row.status).toBe("preparing");
    expect(await checklistsOf(target)).toEqual([checklist]);
    expect(await snapshotItems(checklist)).toEqual(itemsBefore);
    expect(itemsBefore).toEqual(["Alpha step/true/false"]);

    // A template from another team can never be promoted here.
    const foreign = await template(outsiderTeamId, "Foreign default", [], outsider);
    expect((await setDefault(member, team, foreign)).error?.code).toBe("22023");
    expect(await defaultsOf(team)).toEqual([]);
  });

  // Scenario: No default auto-application
  it("never applies the default implicitly when a launch is created", async () => {
    const team = await startTeam(member, "Auto apply team");
    const id = await template(team, "Would-be default", [["Should not appear", true]]);
    expect((await setDefault(member, team, id)).data).toBe(id);
    expect(await defaultsOf(team)).toEqual(["Would-be default"]);

    const created = await launch(team, "Still empty");
    expect(await checklistsOf(created)).toEqual([]);
    const [{ count }] = await sql<{ count: string }>(
      "select count(*) from public.launch_checklist_items where team_id = $1", [team]);
    expect(Number(count)).toBe(0);
  });
});

describe("single template-derived snapshot", () => {
  // Scenario: Apply a same-team template
  it("copies every current item and its required designation into one snapshot", async () => {
    const source = await template(teamId, "Full checklist",
      [["Assets ready", true], ["Ads drafted", false], ["Pricing set", true]]);
    const id = await launch(teamId, "Snapshot target");
    const applied = await applyTemplate(member, id, source);
    expect(applied.error).toBeNull();

    const checklist = applied.data as string;
    expect(await checklistsOf(id)).toEqual([checklist]);
    expect(await snapshotItems(checklist)).toEqual(
      ["Assets ready/true/false", "Ads drafted/false/false", "Pricing set/true/false"]);
    const [row] = await sql<{ origin_template_id: string; team_id: string }>(
      "select origin_template_id, team_id from public.launch_checklists where id = $1", [checklist]);
    expect(row).toEqual({ origin_template_id: source, team_id: teamId });
  });

  // Scenario: Deny cross-team application
  it("refuses a template and launch from different teams and leaves the launch snapshot-free", async () => {
    const id = await launch(teamId, "Cross-team target");
    // The caller is a member of *both* teams, so this is a tenant-boundary rejection, not a
    // missing-authorization one -- exactly what separates `22023` from `42501` here.
    const otherTeams = await template(altTeamId, "Second team checklist", [["Step", true]]);
    expect((await applyTemplate(member, id, otherTeams)).error?.code).toBe("22023");
    // A template the caller cannot see at all stays an opaque authorization failure.
    const foreign = await template(outsiderTeamId, "Outsider checklist", [["Step", true]], outsider);
    expect((await applyTemplate(member, id, foreign)).error?.code).toBe("42501");
    expect(await checklistsOf(id)).toEqual([]);
  });

  // Scenario: Reject replacement
  it("preserves the existing snapshot when reapplication or replacement is attempted", async () => {
    const first = await template(teamId, "Original", [["Original step", true]]);
    const second = await template(teamId, "Replacement", [["Replacement step", true]]);
    const id = await launch(teamId, "Single snapshot");
    const checklist = (await applyTemplate(member, id, first)).data as string;

    expect((await applyTemplate(member, id, first)).error?.code).toBe("23505");
    expect((await applyTemplate(member, id, second)).error?.code).toBe("23505");
    expect(await checklistsOf(id)).toEqual([checklist]);
    expect(await snapshotItems(checklist)).toEqual(["Original step/true/false"]);
  });

  // Scenario: Reject direct creation
  it("refuses a snapshot written directly instead of through the template RPC", async () => {
    const id = await launch(teamId, "No direct snapshot");
    expect((await member.client.from("launch_checklists").insert({ team_id: teamId, launch_id: id }).select()).error).not.toBeNull();
    expect((await member.client.from("launch_checklists")
      .insert({ team_id: teamId, launch_id: id, origin_template_id: null }).select()).error).not.toBeNull();
    expect(await checklistsOf(id)).toEqual([]);
  });
});

describe("editable snapshot items", () => {
  // Scenario: Template isolation
  it("keeps an applied snapshot unchanged when its source template changes", async () => {
    const source = await template(teamId, "Drifting template", [["Initial step", true]]);
    const id = await launch(teamId, "Isolated from template");
    const checklist = (await applyTemplate(member, id, source)).data as string;

    expect((await member.client.from("launch_checklist_template_items")
      .update({ label: "Renamed step", is_required: false }).eq("template_id", source).select()).data).toHaveLength(1);
    expect((await member.client.from("launch_checklist_template_items")
      .insert({ team_id: teamId, template_id: source, label: "Added later", is_required: true, position: 9 })).error).toBeNull();

    expect(await templateItems(source)).toEqual(["Renamed step/false", "Added later/true"]);
    expect(await snapshotItems(checklist)).toEqual(["Initial step/true/false"]);
  });

  // Scenario: Snapshot isolation
  it("keeps the source template and peer snapshots unchanged when a snapshot item changes", async () => {
    const source = await template(teamId, "Shared template", [["Shared step", true]]);
    const [first, second] = [await launch(teamId, "Snapshot one"), await launch(teamId, "Snapshot two")];
    const one = (await applyTemplate(member, first, source)).data as string;
    const two = (await applyTemplate(member, second, source)).data as string;

    const edited = await member.client.from("launch_checklist_items")
      .update({ label: "Locally renamed", is_required: false, is_complete: true }).eq("checklist_id", one).select();
    expect(edited.data).toHaveLength(1);

    expect(await snapshotItems(one)).toEqual(["Locally renamed/false/true"]);
    expect(await snapshotItems(two)).toEqual(["Shared step/true/false"]);
    expect(await templateItems(source)).toEqual(["Shared step/true"]);
  });

  // Scenario: Missing snapshot blocks activation
  it("refuses activation without a snapshot and does not apply a template as a side effect", async () => {
    const team = await startTeam(member, "Activation team");
    const fallback = await template(team, "Default checklist", [["Step", true]]);
    expect((await setDefault(member, team, fallback)).data).toBe(fallback);

    const id = await launch(team, "No snapshot");
    expect((await member.client.rpc("transition_launch", { p_launch_id: id, p_next: "active" })).error?.code).toBe("23514");
    const [row] = await sql<{ status: string }>("select status from public.launches where id = $1", [id]);
    expect(row.status).toBe("preparing");
    expect(await checklistsOf(id)).toEqual([]);
  });

  // Scenario: Completion does not auto-activate
  it("leaves the launch preparing when the last incomplete required item is completed", async () => {
    const source = await template(teamId, "Two step", [["First", true], ["Second", true]]);
    const id = await launch(teamId, "Eligible only");
    const checklist = (await applyTemplate(member, id, source)).data as string;

    for (const label of ["First", "Second"]) {
      expect((await member.client.from("launch_checklist_items").update({ is_complete: true })
        .eq("checklist_id", checklist).eq("label", label).select()).data).toHaveLength(1);
      const [row] = await sql<{ status: string }>("select status from public.launches where id = $1", [id]);
      expect(row.status).toBe("preparing");
    }
    expect(await snapshotItems(checklist)).toEqual(["First/true/true", "Second/true/true"]);
  });
});
