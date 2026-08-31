// Contract proof for the launch module: it drives the shipped database contract through a single
// door, its layers depend inwards -- callers on the service, the service on the repository, the
// repository alone on the database -- and its domain types are projected from the generated schema
// rather than restated by hand. Scenarios come from
// `openspec/changes/launch-workspace-core/specs/`. The database remains the only authority, so every
// denial below is raised by a grant, a policy or an RPC, never by a guard inside the module.
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { LaunchClient } from "../../src/modules/launch/repository";
import { launchServiceFor } from "../../src/modules/launch/service";
import { signIn, sql, uniqueEmail } from "../support/local-stack";

const MODULE_DIR = "src/modules/launch";
/** The six tables the migration gives this module, and the only ones it may ever reach. */
const LAUNCH_TABLES = [
  "launch_checklist_items", "launch_checklist_template_items", "launch_checklist_templates",
  "launch_checklists", "launch_events", "launches",
];

type Actor = Awaited<ReturnType<typeof signIn>>;
type Service = ReturnType<typeof launchServiceFor>;

let member: Actor, outsider: Actor;
let service: Service, outsiderService: Service;
let teamId: string, outsiderTeamId: string;

const serviceFor = (actor: Actor): Service => launchServiceFor(actor.client as unknown as LaunchClient);
const startTeam = async (actor: Actor, name: string): Promise<string> =>
  (await actor.client.from("teams").insert({ name }).select("id").single()).data!.id as string;

/** The database's own column list, so a projection cannot silently drift from the schema. */
const tableColumns = async (table: string): Promise<string[]> =>
  (await sql<{ name: string }>(
    "select column_name as name from information_schema.columns where table_schema = 'public' and table_name = $1 order by 1",
    [table])).map((column) => column.name);

const statusOf = async (id: string): Promise<[string, string | null]> => {
  const [found] = await sql<{ status: string; prior_status: string | null }>(
    "select status, prior_status from public.launches where id = $1", [id]);
  return [found.status, found.prior_status];
};

beforeAll(async () => {
  [member, outsider] = await Promise.all(["lm-member", "lm-outsider"].map((label) => signIn(uniqueEmail(label))));
  [service, outsiderService] = [serviceFor(member), serviceFor(outsider)];
  teamId = await startTeam(member, "Module team");
  outsiderTeamId = await startTeam(outsider, "Outside module team");
});

describe("service contracts", () => {
  it("starts launches and returns them on the board projected from the generated schema", async () => {
    const first = await service.startLaunch(teamId, "Winter capsule");
    expect([first.status, first.prior_status, first.name]).toEqual(["preparing", null, "Winter capsule"]);

    // Triangulation: a second launch keeps its own name and id, so the board is real data.
    const second = await service.startLaunch(teamId, "Spring restock");
    const board = await service.board(teamId);
    const named = new Map(board.map((row) => [row.id, row.name]));
    expect(named.get(first.id)).toBe("Winter capsule");
    expect(named.get(second.id)).toBe("Spring restock");
    expect(board.every((row) => row.checklist === null)).toBe(true);

    // The projection is the database's column set, not a hand-picked subset.
    const { checklist, ...columns } = board.find((row) => row.id === first.id)!;
    expect(Object.keys(columns).sort()).toEqual(await tableColumns("launches"));
    expect(checklist).toBeNull();
  });

  it("returns the same launch with no duplicate when a caller retries one launch id", async () => {
    const id = randomUUID();
    const first = await service.startLaunch(teamId, "Lost response", id);
    const retry = await service.startLaunch(teamId, "Lost response", id);
    expect([first.id, retry.id]).toEqual([id, id]);
    expect((await service.board(teamId)).filter((row) => row.id === id)).toHaveLength(1);

    // Triangulation: the id is the key, not the name -- the same name under a fresh id is new.
    const separate = await service.startLaunch(teamId, "Lost response");
    expect(separate.id).not.toBe(id);
  });

  it("applies a template snapshot and activates only once required items are complete", async () => {
    const template = await service.defineTemplate(teamId, "Standard", [
      { label: "Copy approved", is_required: true, position: 0 },
      { label: "Nice to have", is_required: false, position: 1 },
    ]);
    const target = await service.startLaunch(teamId, "Snapshot driven");
    const checklistId = await service.applyTemplate(target.id, template);

    const applied = (await service.board(teamId)).find((row) => row.id === target.id)!.checklist!;
    expect(applied.id).toBe(checklistId);
    expect(applied.origin_template_id).toBe(template);
    expect(applied.items.map((item) => [item.label, item.is_required, item.is_complete]))
      .toEqual([["Copy approved", true, false], ["Nice to have", false, false]]);

    // The required item blocks activation; completing it is the only difference that unblocks it.
    await expect(service.moveLaunch(target.id, "active")).rejects.toThrow(/launch: transition launch failed/);
    expect(await statusOf(target.id)).toEqual(["preparing", null]);
    const completed = await service.completeItem(applied.items[0].id);
    expect(completed.is_complete).toBe(true);
    expect(await service.moveLaunch(target.id, "active")).toBe("active");
    expect(await statusOf(target.id)).toEqual(["active", null]);

    // The snapshot item is projected from the schema too, and the optional item stayed open.
    const { items, ...columns } = (await service.board(teamId)).find((row) => row.id === target.id)!.checklist!;
    expect(Object.keys(columns).sort()).toEqual(await tableColumns("launch_checklists"));
    expect(Object.keys(items[1]).sort()).toEqual(await tableColumns("launch_checklist_items"));
    expect(items[1].is_complete).toBe(false);
  });

  it("trashes a launch and restores it to its exact prior status", async () => {
    const target = await service.startLaunch(teamId, "Recoverable");
    expect(await service.moveLaunch(target.id, "discarded")).toBe("discarded");
    expect(await service.moveLaunch(target.id, "trash")).toBe("trash");
    expect(await statusOf(target.id)).toEqual(["trash", "discarded"]);
    expect(await service.restoreLaunch(target.id)).toBe("discarded");
    expect(await statusOf(target.id)).toEqual(["discarded", null]);

    // Triangulation: restoring a launch that is not trashed is not a lifecycle move.
    await expect(service.restoreLaunch(target.id)).rejects.toThrow(/launch: restore launch failed/);
    expect(await statusOf(target.id)).toEqual(["discarded", null]);
  });

  it("designates a single default template and clears it without touching launches", async () => {
    const [first, second] = await Promise.all([
      service.defineTemplate(teamId, "Default candidate", []),
      service.defineTemplate(teamId, "Rival candidate", []),
    ]);
    expect(await service.chooseDefaultTemplate(teamId, first)).toBe(first);
    expect(await service.chooseDefaultTemplate(teamId, second)).toBe(second);
    const listed = await service.templates(teamId);
    expect(listed.filter((row) => row.is_default).map((row) => row.id)).toEqual([second]);

    // Each template carries only its own items: both candidates are empty while `Standard` keeps
    // its two, so an assembler that ignored the parent key would hand every template the same list.
    const itemCounts = new Map(listed.map((row) => [row.id, row.items.length]));
    expect([itemCounts.get(first), itemCounts.get(second)]).toEqual([0, 0]);
    expect([...itemCounts.values()].filter((count) => count > 0)).toEqual([2]);

    expect(await service.chooseDefaultTemplate(teamId, null)).toBeNull();
    expect((await service.templates(teamId)).filter((row) => row.is_default)).toEqual([]);
  });
});

describe("list and history order", () => {
  it("returns the whole team history in append order across launches", async () => {
    const historyTeam = await startTeam(member, "History team");
    const scoped = serviceFor(member);
    const first = await scoped.startLaunch(historyTeam, "First");
    const second = await scoped.startLaunch(historyTeam, "Second");
    await scoped.moveLaunch(first.id, "discarded");
    await scoped.moveLaunch(second.id, "trash");
    await scoped.moveLaunch(first.id, "preparing");

    const timeline = await scoped.timeline(historyTeam);
    expect(timeline.map((event) => `${event.launch_id === first.id ? "1" : "2"}:${event.kind}:${event.from_status ?? "-"}>${event.to_status ?? "-"}`))
      .toEqual([
        "1:created:->preparing", "2:created:->preparing", "1:transitioned:preparing>discarded",
        "2:transitioned:preparing>trash", "1:transitioned:discarded>preparing",
      ]);
    // Append order is `seq`, which is strictly increasing and never ties.
    expect(timeline.map((event) => event.seq)).toEqual([...timeline.map((event) => event.seq)].sort((a, b) => a - b));
    expect(timeline.map((event) => event.team_id)).toEqual(Array(5).fill(historyTeam));
  });

  it("orders the board and its items deterministically when timestamps tie", async () => {
    const tieTeam = await startTeam(member, "Tie team");
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
    // Created in reverse, so insertion order can never stand in for the ordering the board applies.
    for (const [index, id] of [...ids].reverse().entries()) await service.startLaunch(tieTeam, `Tied ${index}`, id);
    // Equal creation instants leave `id` as the only tiebreak, so the order must still be stable.
    // Rewriting the rows from the highest id down puts them on disk in descending order, so an
    // untiebroken query would answer in that physical order instead of the one asserted below.
    const tied = new Date().toISOString();
    for (const id of [...ids].reverse())
      await sql("update public.launches set created_at = $2 where id = $1", [id, tied]);
    expect((await service.board(tieTeam)).map((row) => row.id)).toEqual(ids);
    expect((await service.board(tieTeam)).map((row) => row.id)).toEqual(ids);

    // Triangulation: with distinct instants, creation order wins over id order.
    const older = ids[2];
    await sql("update public.launches set created_at = now() - interval '1 hour' where id = $1", [older]);
    expect((await service.board(tieTeam)).map((row) => row.id)).toEqual([older, ids[0], ids[1]]);

    // Snapshot and template items are ordered by position, not by insertion or id.
    const template = await service.defineTemplate(tieTeam, "Ordered", [
      { label: "Third", is_required: false, position: 2 },
      { label: "First", is_required: true, position: 0 },
      { label: "Second", is_required: false, position: 1 },
    ]);
    expect((await service.templates(tieTeam))[0].items.map((item) => item.label)).toEqual(["First", "Second", "Third"]);
    await service.applyTemplate(older, template);
    const snapshot = (await service.board(tieTeam)).find((row) => row.id === older)!.checklist!;
    expect(snapshot.items.map((item) => item.label)).toEqual(["First", "Second", "Third"]);
  });

  it("surfaces database denials as errors and discloses nothing across teams", async () => {
    const mine = await service.startLaunch(teamId, "Members only");
    // The outsider sees their own team, which proves the empty result below is isolation at work.
    await outsiderService.startLaunch(outsiderTeamId, "Their own");
    expect((await outsiderService.board(outsiderTeamId)).map((row) => row.name)).toEqual(["Their own"]);

    expect(await outsiderService.board(teamId)).toEqual([]);
    expect(await outsiderService.timeline(teamId)).toEqual([]);
    await expect(outsiderService.startLaunch(teamId, "Trespass")).rejects.toThrow(/launch: create launch failed/);
    await expect(outsiderService.moveLaunch(mine.id, "discarded")).rejects.toThrow(/launch: transition launch failed/);
    expect(await statusOf(mine.id)).toEqual(["preparing", null]);
  });
});

describe("module boundary", () => {
  it("keeps the module boundary and its dependency direction", () => {
    const read = (file: string) => readFileSync(`${MODULE_DIR}/${file}`, "utf8");
    expect(readdirSync(MODULE_DIR).sort()).toEqual(["repository.ts", "service.ts", "types.ts"]);

    const reached = new Set<string>();
    for (const file of readdirSync(MODULE_DIR)) {
      for (const [, table] of read(file).matchAll(/\.from\("([a-z_]+)"\)/g)) {
        expect(LAUNCH_TABLES).toContain(table);
        reached.add(table);
      }
      // Every database call lives behind the repository door.
      if (file !== "repository.ts") expect(read(file)).not.toMatch(/\.(from|rpc)\(/);
    }
    expect([...reached].sort()).toEqual(LAUNCH_TABLES);
    expect(read("repository.ts")).not.toMatch(/from "\.\/service"/); // layers depend inwards, never up
    for (const rpc of ["create_launch", "transition_launch", "restore_launch", "apply_checklist_template", "set_default_checklist_template"])
      expect(read("repository.ts")).toContain(`.rpc("${rpc}"`);
  });

  it("gives every ordered list an id tiebreak the planner cannot be trusted to supply", () => {
    // PostgreSQL guarantees nothing about the order of tied rows. Today's plans happen to answer
    // in id order, so the behavioral test above cannot observe a missing tiebreak -- a plan change
    // would silently reorder results. The tiebreak is therefore pinned here as a contract.
    const ordered = [...readFileSync(`${MODULE_DIR}/repository.ts`, "utf8").matchAll(/\.order\("(\w+)"\)(\.order\("(\w+)"\))?/g)];
    expect(ordered.map((match) => [match[1], match[3] ?? null])).toEqual([
      ["created_at", "id"], ["seq", null], ["position", "id"], ["created_at", "id"], ["position", "id"],
    ]);
  });

  it("projects every domain type from the generated database types", () => {
    const source = readFileSync(`${MODULE_DIR}/types.ts`, "utf8");
    expect(source).toMatch(/import type \{ Database \} from "\.\.\/\.\.\/lib\/database\.types"/);
    const exported = [...source.matchAll(/^export type (\w+) = ([^;]+);$/gm)];
    expect(exported.length).toBeGreaterThanOrEqual(LAUNCH_TABLES.length);
    for (const [, name, definition] of exported)
      expect(`${name} = ${definition}`).toMatch(/Tables\["|Database\["public"\]\["Enums"\]/);
    expect(source).not.toMatch(/\binterface\b/); // a restated column set is a second source of truth
  });
});
