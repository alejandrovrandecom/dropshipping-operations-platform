// Behavioral proof for the launch lifecycle: creation defaults, the closed transition set and
// explicit activation. Every `it` below is a scenario from
// `openspec/changes/launch-workspace-core/specs/launch-lifecycle/spec.md`. The database is the
// only authority, so each denial must come from a grant, a policy or an RPC raise -- never from
// a client-side guard. Launches are written exclusively through the RPCs, because no client
// insert grant exists on `public.launches`.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { signIn, sql, uniqueEmail } from "../support/local-stack";

type Actor = Awaited<ReturnType<typeof signIn>>;

let owner: Actor, member: Actor, outsider: Actor, teamId: string, outsiderTeamId: string;

const startTeam = async (actor: Actor, name: string): Promise<string> =>
  (await actor.client.from("teams").insert({ name }).select("id").single()).data!.id as string;

// The launch id is chosen by the caller, so a retry can name the same resource. Tests that do not
// exercise retries take a fresh id per call, exactly as a client generating one per intent would.
const create = (actor: Actor, team: string, name: string, id: string | null = randomUUID()) =>
  actor.client.rpc("create_launch", { p_launch_id: id, p_team_id: team, p_name: name });
const transition = (actor: Actor, target: string, next: string) =>
  actor.client.rpc("transition_launch", { p_launch_id: target, p_next: next });
const restore = (actor: Actor, target: string) =>
  actor.client.rpc("restore_launch", { p_launch_id: target });

/** Creates a launch through the only write door and asserts the call succeeded. */
async function launch(name: string, actor: Actor = member, team: string = teamId): Promise<string> {
  const { data, error } = await create(actor, team, name);
  expect(error).toBeNull();
  return data as string;
}

type LaunchRow = { status: string; prior_status: string | null; name: string; url: string | null; notes: string | null };
const row = async (id: string): Promise<LaunchRow> =>
  (await sql<LaunchRow>("select status, prior_status, name, url, notes from public.launches where id = $1", [id]))[0];
const state = async (id: string): Promise<[string, string | null]> => {
  const current = await row(id);
  return [current.status, current.prior_status];
};
/** Append-ordered history rendered as `kind:from>to`, so an assertion reads like the spec. */
const history = async (id: string): Promise<string[]> =>
  (await sql<{ fact: string }>(
    `select kind || ':' || coalesce(from_status::text, '-') || '>' || coalesce(to_status::text, '-') as fact
       from public.launch_events where launch_id = $1 order by seq`, [id])).map((event) => event.fact);
const launchCount = async (team: string): Promise<number> =>
  Number((await sql<{ count: string }>("select count(*) from public.launches where team_id = $1", [team]))[0].count);

/** Applies a fresh template carrying `items` to `target` and returns the snapshot id. */
async function snapshot(target: string, items: Array<[label: string, required: boolean]>): Promise<string> {
  const template = (await member.client.from("launch_checklist_templates")
    .insert({ team_id: teamId, name: `Checklist ${Math.random().toString(16).slice(2, 8)}` })
    .select("id").single()).data!.id as string;
  if (items.length > 0)
    expect((await member.client.from("launch_checklist_template_items").insert(items.map(
      ([label, is_required], position) => ({ team_id: teamId, template_id: template, label, is_required, position })))).error).toBeNull();
  const { data, error } = await member.client.rpc("apply_checklist_template", { p_launch_id: target, p_template_id: template });
  expect(error).toBeNull();
  return data as string;
}

/** Marks every required snapshot item complete, which establishes activation eligibility. */
async function completeRequired(checklist: string): Promise<void> {
  const done = await member.client.from("launch_checklist_items").update({ is_complete: true })
    .eq("checklist_id", checklist).eq("is_required", true).select();
  expect(done.error).toBeNull();
}

/** A launch already in `active`: the only lawful route onward to `archived`. */
async function activated(name: string): Promise<string> {
  const id = await launch(name);
  await completeRequired(await snapshot(id, [["Assets ready", true]]));
  expect((await transition(member, id, "active")).error).toBeNull();
  return id;
}

beforeAll(async () => {
  [owner, member, outsider] = await Promise.all(
    ["lc-owner", "lc-member", "lc-outsider"].map((label) => signIn(uniqueEmail(label))));
  teamId = await startTeam(owner, "Lifecycle team");
  outsiderTeamId = await startTeam(outsider, "Outside team");
  await sql("insert into public.memberships (team_id, user_id) values ($1, $2)", [teamId, member.userId]);
});

describe("preparing launches", () => {
  // Scenario: Creation
  it("starts a name-only launch in preparing with no prior status and no optional fields", async () => {
    const id = await launch("Winter capsule");
    expect(await row(id)).toEqual({ status: "preparing", prior_status: null, name: "Winter capsule", url: null, notes: null });
    // Triangulation: a second launch keeps its own name, so the row is real and not a fixed echo.
    const other = await launch("Spring restock");
    expect((await row(other)).name).toBe("Spring restock");
    expect(other).not.toBe(id);
  });

  // Scenario: Missing name
  it("rejects blank, whitespace-only and oversize names without creating a launch", async () => {
    // `btrim` with no character set strips spaces only, which is exactly the `nonblank` rule the
    // design specifies and the rule `teams.name` already uses. Tab- and newline-only names are
    // therefore NOT rejected today; that gap is reported with this change rather than silently
    // widened here, because changing it would diverge from both the design and the existing tables.
    const before = await launchCount(teamId);
    for (const name of ["", "   ", "x".repeat(121)]) {
      const { data, error } = await create(member, teamId, name);
      expect(data).toBeNull();
      expect(error?.code).toBe("22023");
    }
    // The boundary length itself is accepted, proving a length rule rather than a blanket refusal.
    expect((await create(member, teamId, "x".repeat(120))).error).toBeNull();
    expect(await launchCount(teamId)).toBe(before + 1);
  });

  // Scenario: Retry after a lost response
  it("returns the same launch with no second record or event when a launch id is retried", async () => {
    // The response-loss case: the first call committed, its answer never reached the client, and
    // the client retries the identical intent. Resource identity is the idempotency key.
    const id = randomUUID();
    const before = await launchCount(teamId);
    const first = await create(member, teamId, "Lost response", id);
    const retry = await create(member, teamId, "Lost response", id);
    expect([first.error, retry.error]).toEqual([null, null]);
    expect([first.data, retry.data]).toEqual([id, id]);
    expect(await launchCount(teamId)).toBe(before + 1);
    expect(await history(id)).toEqual(["created:->preparing"]);

    // Triangulation: the id is the key, not the name. The same name under a fresh id is a new
    // launch, so this is deduplication of one intent rather than a name uniqueness rule.
    const separate = await create(member, teamId, "Lost response", randomUUID());
    expect(separate.error).toBeNull();
    expect(separate.data).not.toBe(id);
    expect(await launchCount(teamId)).toBe(before + 2);
  });

  // Scenario: Rejected launch identifier
  it("rejects a missing launch id and denies one already held by another team or creator", async () => {
    const before = await launchCount(teamId);
    expect((await create(member, teamId, "No id", null)).error?.code).toBe("22023");

    // An id that exists outside the caller's tenant, and one created inside it by somebody else,
    // are both refused with the opaque code: a retry may only ever return the caller's own launch.
    const foreign = await launch("Outsider owned", outsider, outsiderTeamId);
    expect((await create(member, teamId, "Seized", foreign)).error?.code).toBe("42501");
    const othersLaunch = await launch("Owner owned", owner);
    expect((await create(member, teamId, "Seized", othersLaunch)).error?.code).toBe("42501");

    expect(await launchCount(teamId)).toBe(before + 1);
    expect(await history(foreign)).toEqual(["created:->preparing"]);
    expect((await row(foreign)).name).toBe("Outsider owned");
  });

  // Scenario: Isolation
  it("denies an outside-team caller every read and write on a launch", async () => {
    const id = await launch("Members only");
    expect((await create(outsider, teamId, "Trespass")).error?.code).toBe("42501");
    expect((await outsider.client.from("launches").select("id").eq("id", id)).data ?? []).toEqual([]);
    expect((await outsider.client.from("launches").update({ name: "seized" }).eq("id", id).select()).data ?? []).toEqual([]);
    expect((await transition(outsider, id, "discarded")).error?.code).toBe("42501");
    expect(await state(id)).toEqual(["preparing", null]);
    expect((await row(id)).name).toBe("Members only");
  });
});

describe("closed lifecycle", () => {
  // Scenario: Reopen
  it("reopens a discarded launch into preparing and appends exactly one transition event", async () => {
    const id = await launch("Reopened");
    expect((await transition(member, id, "discarded")).error).toBeNull();
    const before = await history(id);
    const reopened = await transition(member, id, "preparing");
    expect(reopened.error).toBeNull();
    expect(reopened.data).toBe("preparing");
    expect(await state(id)).toEqual(["preparing", null]);
    expect(await history(id)).toEqual([...before, "transitioned:discarded>preparing"]);
  });

  // Scenario: Trash launch
  it("stores the exact prior state when a non-trash launch is trashed", async () => {
    const fromPreparing = await launch("Trash from preparing");
    expect((await transition(member, fromPreparing, "trash")).error).toBeNull();
    expect(await state(fromPreparing)).toEqual(["trash", "preparing"]);
    // Triangulation: a different origin must be stored verbatim, not defaulted back to `preparing`.
    const fromActive = await activated("Trash from active");
    expect((await transition(member, fromActive, "trash")).error).toBeNull();
    expect(await state(fromActive)).toEqual(["trash", "active"]);
    // Trashing a trashed launch would overwrite the only record of where it came from.
    expect((await transition(member, fromActive, "trash")).error?.code).toBe("22023");
    expect(await state(fromActive)).toEqual(["trash", "active"]);
  });

  // Scenario: Restore launch
  it("returns a trashed launch to its exact pre-trash state", async () => {
    const id = await activated("Restored");
    expect((await transition(member, id, "archived")).error).toBeNull();
    expect((await transition(member, id, "trash")).error).toBeNull();
    const restored = await restore(member, id);
    expect(restored.error).toBeNull();
    expect(restored.data).toBe("archived");
    expect(await state(id)).toEqual(["archived", null]);
    expect((await history(id)).at(-1)).toBe("transitioned:trash>archived");
    // Restoring again is not a lifecycle move: the launch is no longer trashed.
    expect((await restore(member, id)).error?.code).toBe("22023");
    expect(await state(id)).toEqual(["archived", null]);
  });

  // Scenario: Reject others
  it("rejects archived-to-preparing and every unlisted pair without touching state or history", async () => {
    const archived = await activated("Archived");
    expect((await transition(member, archived, "archived")).error).toBeNull();
    const before = await history(archived);
    for (const next of ["preparing", "active", "discarded", "archived"])
      expect((await transition(member, archived, next)).error?.code).toBe("22023");
    expect(await state(archived)).toEqual(["archived", null]);
    expect(await history(archived)).toEqual(before);

    // A second unlisted origin: `preparing` may never jump straight to `archived`.
    const preparing = await launch("No shortcut");
    expect((await transition(member, preparing, "archived")).error?.code).toBe("22023");
    expect(await state(preparing)).toEqual(["preparing", null]);
    expect(await history(preparing)).toEqual(["created:->preparing"]);
  });
});

describe("explicit activation", () => {
  // Scenario: Eligibility
  it("leaves the launch preparing when the last required item is completed", async () => {
    const id = await launch("Eligible but idle");
    await completeRequired(await snapshot(id, [["Copy approved", true]]));
    expect(await state(id)).toEqual(["preparing", null]);
    expect(await history(id)).toEqual(["created:->preparing", "checklist_applied:->-"]);
  });

  // Scenario: Activation
  it("activates an eligible preparing launch when activation is requested", async () => {
    const id = await launch("Ready");
    await completeRequired(await snapshot(id, [["Copy approved", true], ["Pricing set", true]]));
    const active = await transition(member, id, "active");
    expect(active.error).toBeNull();
    expect(active.data).toBe("active");
    expect(await state(id)).toEqual(["active", null]);
    expect((await history(id)).at(-1)).toBe("transitioned:preparing>active");
  });

  // Scenario: Required
  it("fails activation in preparing while a required item is incomplete", async () => {
    const id = await launch("Blocked");
    const checklist = await snapshot(id, [["Copy approved", true], ["Pricing set", true]]);
    const partial = await member.client.from("launch_checklist_items").update({ is_complete: true })
      .eq("checklist_id", checklist).eq("label", "Copy approved").select();
    expect(partial.data).toHaveLength(1);
    expect((await transition(member, id, "active")).error?.code).toBe("23514");
    expect(await state(id)).toEqual(["preparing", null]);
    expect((await history(id)).at(-1)).toBe("checklist_applied:->-");
    // Completing the remaining required item is the only difference, and it unblocks activation.
    await completeRequired(checklist);
    expect((await transition(member, id, "active")).error).toBeNull();
    expect(await state(id)).toEqual(["active", null]);
  });

  // Scenario: Optional
  it("activates while only optional items are incomplete", async () => {
    const id = await launch("Optional pending");
    const checklist = await snapshot(id, [["Copy approved", true], ["Nice to have", false]]);
    await completeRequired(checklist);
    expect((await transition(member, id, "active")).error).toBeNull();
    expect(await state(id)).toEqual(["active", null]);
    // The optional item genuinely stayed incomplete, so activation ignored it rather than completing it.
    const open = await sql<{ label: string }>(
      "select label from public.launch_checklist_items where checklist_id = $1 and not is_complete", [checklist]);
    expect(open.map((item) => item.label)).toEqual(["Nice to have"]);
  });
});
