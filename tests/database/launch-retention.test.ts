// Behavioral proof for retention and the single destructive exception. Recovery must never lose a
// record, no individual purge path may exist, and owner-only whole-team deletion must remove every
// team-owned launch, template, snapshot and event at once.
//
// The `it` blocks below cover the retention scenarios of all three specs in
// `openspec/changes/launch-workspace-core/specs/`: launch-lifecycle "Retention and team deletion",
// launch-checklist-templates "Checklist retention and team deletion", and launch-history
// "History retention and team-deletion boundary".
//
// Counts are read with the migration role on purpose: an RLS-filtered read cannot distinguish
// "deleted" from "hidden", and this file has to prove which one actually happened.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { signIn, sql, uniqueEmail } from "../support/local-stack";

type Actor = Awaited<ReturnType<typeof signIn>>;
type Counts = Record<"launches" | "events" | "checklists" | "checklist_items" | "templates" | "template_items", number>;

let owner: Actor, member: Actor, outsider: Actor;

const startTeam = async (actor: Actor, name: string): Promise<string> =>
  (await actor.client.from("teams").insert({ name }).select("id").single()).data!.id as string;
const launch = async (team: string, name: string): Promise<string> => {
  const { data, error } = await member.client.rpc("create_launch", { p_launch_id: randomUUID(), p_team_id: team, p_name: name });
  expect(error).toBeNull();
  return data as string;
};
const transition = (target: string, next: string) =>
  member.client.rpc("transition_launch", { p_launch_id: target, p_next: next });
const restore = (target: string) => member.client.rpc("restore_launch", { p_launch_id: target });

async function template(team: string, name: string, labels: string[]): Promise<string> {
  const created = await member.client.from("launch_checklist_templates").insert({ team_id: team, name }).select("id").single();
  expect(created.error).toBeNull();
  const id = created.data!.id as string;
  expect((await member.client.from("launch_checklist_template_items").insert(labels.map(
    (label, position) => ({ team_id: team, template_id: id, label, is_required: true, position })))).error).toBeNull();
  return id;
}

/** Row counts for all six launch tables, scoped to one team. */
async function counts(team: string): Promise<Counts> {
  const [row] = await sql<Record<string, string>>(
    `select (select count(*) from public.launches where team_id = $1) as launches,
            (select count(*) from public.launch_events where team_id = $1) as events,
            (select count(*) from public.launch_checklists where team_id = $1) as checklists,
            (select count(*) from public.launch_checklist_items where team_id = $1) as checklist_items,
            (select count(*) from public.launch_checklist_templates where team_id = $1) as templates,
            (select count(*) from public.launch_checklist_template_items where team_id = $1) as template_items`, [team]);
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])) as unknown as Counts;
}
const allEvents = async (): Promise<number> =>
  Number((await sql<{ count: string }>("select count(*) from public.launch_events"))[0].count);
const history = async (target: string): Promise<string[]> =>
  (await sql<{ fact: string }>(
    `select kind || ':' || coalesce(from_status::text, '-') || '>' || coalesce(to_status::text, '-') as fact
       from public.launch_events where launch_id = $1 order by seq`, [target])).map((event) => event.fact);
const snapshotItems = async (checklist: string): Promise<string[]> =>
  (await sql<{ fact: string }>(
    `select label || '/' || is_required || '/' || is_complete as fact from public.launch_checklist_items
      where checklist_id = $1 order by position, id`, [checklist])).map((item) => item.fact);

type Seeded = { teamId: string; kept: string; trashed: string; checklist: string; templateId: string };

/** A self-contained team carrying every launch-owned record type, including a trashed launch. */
async function seed(label: string): Promise<Seeded> {
  const teamId = await startTeam(owner, `${label} team`);
  await sql("insert into public.memberships (team_id, user_id) values ($1, $2)", [teamId, member.userId]);
  const templateId = await template(teamId, `${label} template`, ["Step one", "Step two"]);

  const kept = await launch(teamId, `${label} kept`);
  const applied = await member.client.rpc("apply_checklist_template", { p_launch_id: kept, p_template_id: templateId });
  expect(applied.error).toBeNull();
  const checklist = applied.data as string;

  const trashed = await launch(teamId, `${label} trashed`);
  expect((await transition(trashed, "discarded")).error).toBeNull();
  expect((await transition(trashed, "trash")).error).toBeNull();
  return { teamId, kept, trashed, checklist, templateId };
}

beforeAll(async () => {
  [owner, member, outsider] = await Promise.all(
    ["ret-owner", "ret-member", "ret-outsider"].map((label) => signIn(uniqueEmail(label))));
});

describe("launch retention", () => {
  // Scenario: Recovery continuity
  it("keeps the same launch record, history and snapshot across reopen and restoration", async () => {
    const { teamId, kept, checklist } = await seed("continuity");
    const before = { history: await history(kept), items: await snapshotItems(checklist) };
    expect(before.items).toEqual(["Step one/true/false", "Step two/true/false"]);

    expect((await transition(kept, "discarded")).error).toBeNull();
    expect((await transition(kept, "preparing")).error).toBeNull();
    expect((await transition(kept, "trash")).error).toBeNull();
    expect((await restore(kept)).error).toBeNull();

    const [row] = await sql<{ id: string; status: string; name: string }>(
      "select id, status, name from public.launches where id = $1", [kept]);
    expect(row).toEqual({ id: kept, status: "preparing", name: "continuity kept" });
    // Continuation, not replacement: the original events are still the prefix of the history.
    expect((await history(kept)).slice(0, before.history.length)).toEqual(before.history);
    expect(await snapshotItems(checklist)).toEqual(before.items);
    expect((await counts(teamId)).checklists).toBe(1);
  });

  // Scenario: Trash retention  ·  Scenario: Trash retains checklist data  ·  Scenario: Trash retention (history)
  it("keeps every launch-owned record recoverable while the launch sits in trash", async () => {
    const { teamId, kept, checklist } = await seed("trash-retention");
    const before = { counts: await counts(teamId), history: await history(kept), items: await snapshotItems(checklist) };
    expect((await transition(kept, "trash")).error).toBeNull();

    // Nothing is removed by trashing. History still grows by exactly the one transition event the
    // move itself records, which is retention working, not a record being replaced.
    expect(await counts(teamId)).toEqual({ ...before.counts, events: before.counts.events + 1 });
    expect(await snapshotItems(checklist)).toEqual(before.items);
    // A member can still read the trashed launch's history through the client, not only as
    // postgres: the whole prior history is intact and the trash move is appended to it.
    const readable = await member.client.from("launch_events").select("seq").eq("launch_id", kept).order("seq");
    expect(readable.error).toBeNull();
    expect(readable.data).toHaveLength(before.history.length + 1);
    expect((await member.client.from("launch_checklist_items").select("label").eq("checklist_id", checklist)).data)
      .toHaveLength(before.items.length);

    // Recoverable means restorable to the exact prior state, which appends one further event.
    expect((await restore(kept)).data).toBe("preparing");
    expect(await counts(teamId)).toEqual({ ...before.counts, events: before.counts.events + 2 });
    expect((await history(kept)).slice(0, before.history.length)).toEqual(before.history);
  });

  // Scenario: Reject purge
  it("rejects every permanent purge attempt on all six launch tables", async () => {
    const { teamId, kept, trashed, checklist, templateId } = await seed("purge");
    const before = await counts(teamId);

    const attempts: Array<[string, () => PromiseLike<{ error: unknown }>]> = [
      ["launches", () => member.client.from("launches").delete().eq("id", kept).select()],
      ["launch_events", () => member.client.from("launch_events").delete().eq("launch_id", kept).select()],
      ["launch_checklists", () => member.client.from("launch_checklists").delete().eq("id", checklist).select()],
      ["launch_checklist_items", () => member.client.from("launch_checklist_items").delete().eq("checklist_id", checklist).select()],
      ["launch_checklist_templates", () => member.client.from("launch_checklist_templates").delete().eq("id", templateId).select()],
      ["launch_checklist_template_items", () => member.client.from("launch_checklist_template_items").delete().eq("template_id", templateId).select()],
    ];
    for (const [table, attempt] of attempts) expect([table, (await attempt()).error]).not.toEqual([table, null]);

    expect(await counts(teamId)).toEqual(before);
    // Trash recovery is untouched by the refusal, so no purge path was opened as a side effect.
    expect((await restore(trashed)).data).toBe("discarded");
  });
});

describe("owner-only whole-team deletion", () => {
  // Scenario: Owner deletion · Owner deletes all team checklist data · Owner deletes team
  it("removes every team-owned launch, checklist and event without appending any event", async () => {
    const { teamId } = await seed("owner-delete");
    const before = await counts(teamId);
    // Two launches: `kept` contributes `created` + `checklist_applied`, `trashed` contributes
    // `created` + two transitions, so the seeded team holds five events in total.
    expect(before).toEqual({ launches: 2, events: 5, checklists: 1, checklist_items: 2, templates: 1, template_items: 2 });
    const globalBefore = await allEvents();

    const deleted = await owner.client.from("teams").delete().eq("id", teamId).select();
    expect(deleted.error).toBeNull();
    expect(deleted.data).toHaveLength(1);

    expect(await counts(teamId)).toEqual(
      { launches: 0, events: 0, checklists: 0, checklist_items: 0, templates: 0, template_items: 0 });
    expect((await sql("select 1 from public.teams where id = $1", [teamId]))).toHaveLength(0);
    // The cascade only removes: it never appends a launch event anywhere in the database.
    expect(await allEvents()).toBe(globalBefore - before.events);
  });

  // Scenario: Unauthorized deletion · Deny non-owner checklist-data deletion · Non-owner deletes team
  it("retains all team launch, checklist and event data when a non-owner requests deletion", async () => {
    const { teamId, trashed } = await seed("non-owner-delete");
    const before = await counts(teamId);

    // A plain member of the team and a complete outsider are both refused.
    expect((await member.client.from("teams").delete().eq("id", teamId).select()).data ?? []).toEqual([]);
    expect((await outsider.client.from("teams").delete().eq("id", teamId).select()).data ?? []).toEqual([]);

    expect((await sql("select 1 from public.teams where id = $1", [teamId]))).toHaveLength(1);
    expect(await counts(teamId)).toEqual(before);
    // Trash recovery still works, so the refusal changed nothing about the lifecycle.
    expect((await restore(trashed)).data).toBe("discarded");
  });
});
