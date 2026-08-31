// Behavioral proof for launch history: the exact set of events that may be appended, the facts an
// event must expose, and team-isolated append-ordered queries. Every `it` below is a scenario from
// `openspec/changes/launch-workspace-core/specs/launch-history/spec.md`.
//
// History is append-only by construction: `launch_events` carries no insert, update or delete
// grant, so the only writer is an RPC that already succeeded.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { signIn, sql, uniqueEmail } from "../support/local-stack";

type Actor = Awaited<ReturnType<typeof signIn>>;

let owner: Actor, member: Actor, outsider: Actor, teamId: string, outsiderTeamId: string;

const startTeam = async (actor: Actor, name: string): Promise<string> =>
  (await actor.client.from("teams").insert({ name }).select("id").single()).data!.id as string;

const launch = async (team: string, name: string, actor: Actor = member): Promise<string> => {
  const { data, error } = await actor.client.rpc("create_launch", { p_launch_id: randomUUID(), p_team_id: team, p_name: name });
  expect(error).toBeNull();
  return data as string;
};
const transition = (actor: Actor, target: string, next: string) =>
  actor.client.rpc("transition_launch", { p_launch_id: target, p_next: next });
const restore = (actor: Actor, target: string) => actor.client.rpc("restore_launch", { p_launch_id: target });
const applyTemplate = (actor: Actor, target: string, tpl: string) =>
  actor.client.rpc("apply_checklist_template", { p_launch_id: target, p_template_id: tpl });

async function template(team: string, name: string, labels: string[], actor: Actor = member): Promise<string> {
  const created = await actor.client.from("launch_checklist_templates").insert({ team_id: team, name }).select("id").single();
  expect(created.error).toBeNull();
  const id = created.data!.id as string;
  if (labels.length > 0)
    expect((await actor.client.from("launch_checklist_template_items").insert(labels.map(
      (label, position) => ({ team_id: team, template_id: id, label, is_required: true, position })))).error).toBeNull();
  return id;
}

type EventRow = {
  seq: string; kind: string; from_status: string | null; to_status: string | null;
  // `pg` decodes timestamptz into a Date instance, so compare these by value, never by identity.
  launch_id: string; team_id: string; actor_user_id: string; created_at: Date;
};
const events = async (target: string): Promise<EventRow[]> => sql<EventRow>(
  `select seq, kind, from_status, to_status, launch_id, team_id, actor_user_id, created_at
     from public.launch_events where launch_id = $1 order by seq`, [target]);
/** Append-ordered history rendered as `kind:from>to`. */
const history = async (target: string): Promise<string[]> =>
  (await events(target)).map((e) => `${e.kind}:${e.from_status ?? "-"}>${e.to_status ?? "-"}`);

/** A launch already `active`, which requires a snapshot with every required item complete. */
async function activated(team: string, name: string): Promise<string> {
  const id = await launch(team, name);
  const checklist = (await applyTemplate(member, id, await template(team, `T ${name}`, ["Ready"]))).data as string;
  expect((await member.client.from("launch_checklist_items").update({ is_complete: true })
    .eq("checklist_id", checklist).select()).error).toBeNull();
  expect((await transition(member, id, "active")).error).toBeNull();
  return id;
}

beforeAll(async () => {
  [owner, member, outsider] = await Promise.all(
    ["hist-owner", "hist-member", "hist-outsider"].map((label) => signIn(uniqueEmail(label))));
  teamId = await startTeam(owner, "History team");
  outsiderTeamId = await startTeam(outsider, "Outside team");
  await sql("insert into public.memberships (team_id, user_id) values ($1, $2)", [teamId, member.userId]);
});

describe("exact append-only event scope", () => {
  // Scenario: Creation event
  it("appends exactly one creation event when a launch is created", async () => {
    const id = await launch(teamId, "Created once");
    expect(await history(id)).toEqual(["created:->preparing"]);
    // Triangulation: a second launch gets its own single event, not a shared or duplicated one.
    const other = await launch(teamId, "Created separately");
    expect(await history(other)).toEqual(["created:->preparing"]);
    expect((await events(id))[0].launch_id).toBe(id);
    expect((await events(other))[0].launch_id).toBe(other);
  });

  // Scenario: Transition event
  it("appends exactly one corresponding event after each successful transition", async () => {
    const id = await launch(teamId, "Transitions");
    expect((await transition(member, id, "discarded")).error).toBeNull();
    expect(await history(id)).toEqual(["created:->preparing", "transitioned:preparing>discarded"]);
    expect((await transition(member, id, "preparing")).error).toBeNull();
    expect((await transition(member, id, "trash")).error).toBeNull();
    expect(await history(id)).toEqual(["created:->preparing", "transitioned:preparing>discarded",
      "transitioned:discarded>preparing", "transitioned:preparing>trash"]);
  });

  // Scenario: Template event
  it("appends one application event when a same-team template is applied", async () => {
    const id = await launch(teamId, "Template applied");
    expect((await applyTemplate(member, id, await template(teamId, "Applied", ["Step"]))).error).toBeNull();
    expect(await history(id)).toEqual(["created:->preparing", "checklist_applied:->-"]);
  });

  // Scenario: Failed operation
  it("leaves history unchanged when a transition or template application fails", async () => {
    const id = await launch(teamId, "Failures");
    const before = await history(id);
    expect((await transition(member, id, "active")).error?.code).toBe("23514"); // no snapshot
    expect((await transition(member, id, "archived")).error?.code).toBe("22023"); // unlisted pair
    expect((await restore(member, id)).error?.code).toBe("22023"); // not trashed
    const foreign = await template(outsiderTeamId, "Outsider", ["Step"], outsider);
    expect((await applyTemplate(member, id, foreign)).error?.code).toBe("42501");
    expect(await history(id)).toEqual(before);
    expect(before).toEqual(["created:->preparing"]);
  });

  // Scenario: Routine edit
  it("appends nothing for routine note, url, item, template and default edits", async () => {
    const id = await launch(teamId, "Routine edits");
    const source = await template(teamId, "Routine", ["Step"]);
    expect((await applyTemplate(member, id, source)).error).toBeNull();
    const before = await history(id);
    const checklist = (await sql<{ id: string }>("select id from public.launch_checklists where launch_id = $1", [id]))[0].id;

    expect((await member.client.from("launches").update({ url: "https://example.test/drop", notes: "ship monday" })
      .eq("id", id).select()).data).toHaveLength(1);
    expect((await member.client.from("launch_checklist_items").update({ is_complete: true })
      .eq("checklist_id", checklist).select()).data).toHaveLength(1);
    expect((await member.client.from("launch_checklist_templates").update({ name: "Routine v2" })
      .eq("id", source).select()).data).toHaveLength(1);
    expect((await member.client.rpc("set_default_checklist_template",
      { p_team_id: teamId, p_template_id: source })).error).toBeNull();

    expect(await history(id)).toEqual(before);
    expect(before).toEqual(["created:->preparing", "checklist_applied:->-"]);
  });

  // Scenario: Event mutation
  it("refuses to update or delete an individual event and preserves it", async () => {
    const id = await launch(teamId, "Immutable history");
    const before = await events(id);
    expect(before).toHaveLength(1);
    expect((await member.client.from("launch_events").update({ kind: "transitioned" }).eq("launch_id", id).select()).error).not.toBeNull();
    expect((await member.client.from("launch_events").delete().eq("launch_id", id).select()).error).not.toBeNull();
    expect((await member.client.from("launch_events")
      .insert({ team_id: teamId, launch_id: id, kind: "created", to_status: "preparing" }).select()).error).not.toBeNull();
    expect(await events(id)).toEqual(before);
  });
});

describe("events expose minimum behavioral facts", () => {
  // Scenario: Transition facts
  it("exposes launch, team, kind, time, initiator and both states to an authorized member", async () => {
    const id = await launch(teamId, "Fact carrier");
    expect((await transition(member, id, "discarded")).error).toBeNull();
    const read = await member.client.from("launch_events")
      .select("seq, kind, from_status, to_status, launch_id, team_id, actor_user_id, created_at")
      .eq("launch_id", id).order("seq");
    expect(read.error).toBeNull();

    const rows = read.data!;
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      kind: "transitioned", from_status: "preparing", to_status: "discarded",
      launch_id: id, team_id: teamId, actor_user_id: member.userId,
    });
    expect(Date.parse(rows[1].created_at as string)).toBeGreaterThan(0);
    // The creation event names the same launch and the same initiator, so the fields are per-event.
    expect(rows[0]).toMatchObject({ kind: "created", from_status: null, to_status: "preparing", actor_user_id: member.userId });
  });

  // Scenario: Equal-time order
  it("keeps append order stable across repeated queries when events share a timestamp", async () => {
    const id = await launch(teamId, "Equal time");
    expect((await transition(member, id, "discarded")).error).toBeNull();
    expect((await transition(member, id, "preparing")).error).toBeNull();
    // Collapse every timestamp onto one instant: ordering may not depend on `created_at`.
    await sql("update public.launch_events set created_at = timestamptz '2026-01-01 00:00:00+00' where launch_id = $1", [id]);

    const stamps = await sql<{ stamp: string }>(
      "select created_at::text as stamp from public.launch_events where launch_id = $1", [id]);
    expect(stamps).toHaveLength(3);
    expect(new Set(stamps.map((row) => row.stamp)).size).toBe(1);
    const first = await member.client.from("launch_events").select("seq, kind, from_status, to_status").eq("launch_id", id).order("seq");
    const second = await member.client.from("launch_events").select("seq, kind, from_status, to_status").eq("launch_id", id).order("seq");
    expect(first.data).toEqual(second.data);
    expect(first.data!.map((e) => `${e.kind}:${e.from_status ?? "-"}>${e.to_status ?? "-"}`)).toEqual(
      ["created:->preparing", "transitioned:preparing>discarded", "transitioned:discarded>preparing"]);
    const sequence = first.data!.map((e) => Number(e.seq));
    expect(sequence).toEqual([...sequence].sort((a, b) => a - b));
    expect(new Set(sequence).size).toBe(3);
  });
});

describe("team-isolated queries preserve continuity", () => {
  // Scenario: Complete query
  it("returns every retained team event in append order, including trashed launches", async () => {
    const team = await startTeam(member, "Complete query team");
    const kept = await launch(team, "Kept");
    const trashed = await launch(team, "Trashed");
    expect((await transition(member, trashed, "discarded")).error).toBeNull();
    expect((await transition(member, trashed, "trash")).error).toBeNull();

    const read = await member.client.from("launch_events").select("seq, launch_id, kind, from_status, to_status")
      .eq("team_id", team).order("seq");
    expect(read.error).toBeNull();
    expect(read.data!.map((e) => `${e.launch_id === kept ? "kept" : "trashed"}/${e.kind}:${e.from_status ?? "-"}>${e.to_status ?? "-"}`))
      .toEqual(["kept/created:->preparing", "trashed/created:->preparing",
        "trashed/transitioned:preparing>discarded", "trashed/transitioned:discarded>trash"]);
  });

  // Scenario: Cross-team query
  it("discloses no event fact to an outside-team caller", async () => {
    const id = await launch(teamId, "Hidden history");
    expect((await transition(member, id, "discarded")).error).toBeNull();
    expect((await outsider.client.from("launch_events").select("seq").eq("launch_id", id)).data ?? []).toEqual([]);
    expect((await outsider.client.from("launch_events").select("seq").eq("team_id", teamId)).data ?? []).toEqual([]);
    // The outsider still sees their own team's events, so the emptiness above is isolation, not a broken read.
    const own = await launch(outsiderTeamId, "Outsider launch", outsider);
    expect(((await outsider.client.from("launch_events").select("seq").eq("launch_id", own)).data ?? [])).toHaveLength(1);
  });

  // Scenario: Discarded-to-preparing continuity
  it("continues history with one event when a discarded launch reopens", async () => {
    const id = await launch(teamId, "Reopen continuity");
    expect((await transition(member, id, "discarded")).error).toBeNull();
    const before = await events(id);
    expect((await transition(member, id, "preparing")).error).toBeNull();

    const after = await events(id);
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toMatchObject({ kind: "transitioned", from_status: "discarded", to_status: "preparing" });
    expect(Number(after.at(-1)!.seq)).toBeGreaterThan(Number(before.at(-1)!.seq));
  });

  // Scenario: Trash-restoration continuity
  it("continues history with one event when a trashed launch is restored", async () => {
    const id = await activated(teamId, "Restore continuity");
    expect((await transition(member, id, "trash")).error).toBeNull();
    const before = await events(id);
    expect((await restore(member, id)).error).toBeNull();

    const after = await events(id);
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toMatchObject({ kind: "transitioned", from_status: "trash", to_status: "active" });
    expect(Number(after.at(-1)!.seq)).toBeGreaterThan(Number(before.at(-1)!.seq));
  });
});
