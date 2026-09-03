// The onboarding gate, proved where it is hardest to fake. The usernameless account below owns its
// team and is a member of it, so every policy and every column grant already says yes; the only
// thing left to say no is the gate. Its refusal is asserted verbatim, code and message together,
// because an RLS or grant denial carries the same 42501 and would otherwise pass for a gate hit.
// Team-scoped resolution is proved beside it: a name nobody can read back is a name nobody can use.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { signIn, sql, uniqueEmail, uniqueUsername } from "../support/local-stack";

type Actor = Awaited<ReturnType<typeof signIn>>;
type Call = PromiseLike<{ error: { code: string; message: string } | null }>;

/** Asserts the gate's own refusal. Nothing else in the schema raises this pair, and a write that
 *  was allowed through matches neither half of it. */
const denies = async (call: Call): Promise<void> => {
  const { error } = await call;
  expect(`${error?.code}: ${error?.message}`).toBe("42501: username: claim a username before writing");
};
const count = async (text: string, values: unknown[] = []): Promise<number> =>
  Number((await sql<{ n: string }>(text, values))[0].n);
const byUser = <T extends { user_id: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.user_id.localeCompare(b.user_id));

let gated: Actor;    // confirmed, owner and member of `teamId`, holding no username
let peer: Actor;     // same team, claimed: the control proving the policies were never the problem
let mate: Actor;     // same team, claimed: a resolution subject distinct from the caller
let stranger: Actor; // claimed, shares no team
let teamId: string, launchId: string, trashedLaunchId: string;
let templateId: string, templateItemId: string, checklistItemId: string, invitationId: string;
const invitationToken = randomUUID().replace(/-/g, "");

beforeAll(async () => {
  const gatedEmail = uniqueEmail("gate-owner");
  [gated, peer, mate, stranger] = await Promise.all([signIn(gatedEmail, false),
    ...["gate-peer", "gate-mate", "gate-stranger"].map((label) => signIn(uniqueEmail(label)))]);
  // Seeded as the migration role, whose `auth.uid()` is null and whom the gate deliberately ignores,
  // so the fixture can hand the gated account the very authority its denials have to survive.
  teamId = (await sql<{ id: string }>(`insert into public.teams (name, owner_user_id)
    values ('Gated team', $1) returning id`, [gated.userId]))[0].id;
  for (const actor of [peer, mate])
    await sql("insert into public.memberships (team_id, user_id) values ($1, $2)", [teamId, actor.userId]);
  // Addressed to the gated owner itself, so acceptance would genuinely succeed but for the gate.
  invitationId = (await sql<{ id: string }>(`insert into public.team_invitations (team_id, email, token_hash, invited_by)
    values ($1, $2, public.hash_invitation_token($3), $4) returning id`,
  [teamId, gatedEmail, invitationToken, gated.userId]))[0].id;

  // Every fixture row is written by the claimed peer, so the launch surface is already complete
  // before the gated owner is asked to touch it.
  [launchId, trashedLaunchId] = [randomUUID(), randomUUID()];
  for (const [id, name] of [[launchId, "Gated launch"], [trashedLaunchId, "Trashed launch"]])
    await peer.client.rpc("create_launch", { p_launch_id: id, p_team_id: teamId, p_name: name });
  await peer.client.rpc("transition_launch", { p_launch_id: trashedLaunchId, p_next: "trash" });
  templateId = (await peer.client.from("launch_checklist_templates")
    .insert({ team_id: teamId, name: "Gated template" }).select("id").single()).data!.id as string;
  templateItemId = (await peer.client.from("launch_checklist_template_items")
    .insert({ team_id: teamId, template_id: templateId, label: "Ship it" }).select("id").single()).data!.id as string;
  await peer.client.rpc("apply_checklist_template", { p_launch_id: launchId, p_template_id: templateId });
  checklistItemId = (await sql<{ id: string }>(`select i.id from public.launch_checklist_items i
    join public.launch_checklists c on c.team_id = i.team_id and c.id = i.checklist_id
    where c.launch_id = $1`, [launchId]))[0].id;
});

describe("the gate leaves exactly one door open", () => {
  it("denies another protected write until the claim, and ignores callers carrying no subject", async () => {
    const newcomer = await signIn(uniqueEmail("gate-newcomer"), false);
    // Sign-up itself already crossed the gate: `handle_new_user` writes a profile from a trigger
    // with no verified subject in scope, and an unconditional raise would have broken the account.
    expect(await count("select count(*) as n from public.profiles where user_id = $1", [newcomer.userId])).toBe(1);
    await denies(newcomer.client.from("teams").insert({ name: "Too early" }));
    expect(await count("select count(*) as n from public.teams where owner_user_id = $1", [newcomer.userId])).toBe(0);

    // The claim is the one write the gate lets through, and it is the only thing that changes here:
    // same account, same statement, refused and then allowed.
    expect((await newcomer.client.rpc("claim_username", { p_username: uniqueUsername() })).error).toBeNull();
    expect((await newcomer.client.from("teams").insert({ name: "Now allowed" }).select("id")).error).toBeNull();
    expect(await count("select count(*) as n from public.teams where owner_user_id = $1", [newcomer.userId])).toBe(1);
  });
});

describe("identity, teams, membership and invitations", () => {
  it("denies renaming a profile, and leaves the email mirror alone", async () => {
    await denies(gated.client.from("profiles").update({ display_name: "Renamed" }).eq("user_id", gated.userId));
    expect(await count(`select count(*) as n from public.profiles
      where user_id = $1 and display_name is null`, [gated.userId])).toBe(1);
    // The gate watches `display_name` only, so a confirmed address change still reaches the mirror.
    const moved = uniqueEmail("gate-moved");
    await sql("update auth.users set email = $2 where id = $1", [mate.userId, moved]);
    expect(await count("select count(*) as n from public.profiles where user_id = $1 and email = $2",
      [mate.userId, moved])).toBe(1);
  });

  it("denies creating, renaming and deleting a team it owns outright", async () => {
    await denies(gated.client.from("teams").insert({ name: "Second team" }));
    await denies(gated.client.from("teams").update({ name: "Seized" }).eq("id", teamId));
    await denies(gated.client.from("teams").delete().eq("id", teamId));
    // One row, still named as the fixture left it: nothing created, renamed or removed.
    expect(await count(`select count(*) as n from public.teams
      where owner_user_id = $1 and name = 'Gated team'`, [gated.userId])).toBe(1);
  });

  it("denies adding and removing members", async () => {
    await denies(gated.client.from("memberships").insert({ team_id: teamId, user_id: stranger.userId }));
    await denies(gated.client.from("memberships").delete().eq("team_id", teamId).eq("user_id", peer.userId));
    expect(await count("select count(*) as n from public.memberships where team_id = $1", [teamId])).toBe(3);
  });

  it("denies issuing, accepting and revoking an invitation", async () => {
    await denies(gated.client.rpc("create_invitation",
      { target_team_id: teamId, invitee_email: uniqueEmail("gate-invitee") }));
    // Acceptance is the path the proposal names outright: it updates the invitation and inserts a
    // membership, and the gate reaches the statement before either can happen.
    await denies(gated.client.rpc("accept_invitation", { token: invitationToken }));
    await denies(gated.client.from("team_invitations").delete().eq("id", invitationId));
    expect(await count(`select count(*) as n from public.team_invitations
      where team_id = $1 and accepted_at is null`, [teamId])).toBe(1);
  });
});

describe("launch lifecycle, history and templates", () => {
  const events = (): Promise<number> =>
    count("select count(*) as n from public.launch_events where team_id = $1", [teamId]);

  it("denies creating a launch", async () => {
    await denies(gated.client.rpc("create_launch",
      { p_launch_id: randomUUID(), p_team_id: teamId, p_name: "Denied" }));
    expect(await count("select count(*) as n from public.launches where team_id = $1", [teamId])).toBe(2);
  });

  it("denies editing a launch", async () => {
    await denies(gated.client.from("launches")
      .update({ name: "Renamed", url: "https://denied.test", notes: "denied" }).eq("id", launchId));
    expect(await count(`select count(*) as n from public.launches
      where id = $1 and name = 'Gated launch' and url is null`, [launchId])).toBe(1);
  });

  it("denies transitioning a launch, so no state moves and no history is written", async () => {
    const before = await events();
    await denies(gated.client.rpc("transition_launch", { p_launch_id: launchId, p_next: "discarded" }));
    expect(await count("select count(*) as n from public.launches where id = $1 and status = 'preparing'",
      [launchId])).toBe(1);
    expect(await events()).toBe(before);
  });

  it("denies restoring a launch out of trash", async () => {
    await denies(gated.client.rpc("restore_launch", { p_launch_id: trashedLaunchId }));
    expect(await count("select count(*) as n from public.launches where id = $1 and status = 'trash'",
      [trashedLaunchId])).toBe(1);
  });

  it("denies creating a template", async () => {
    await denies(gated.client.from("launch_checklist_templates").insert({ team_id: teamId, name: "Denied" }));
    expect(await count("select count(*) as n from public.launch_checklist_templates where team_id = $1", [teamId]))
      .toBe(1);
  });

  it("denies renaming a template", async () => {
    await denies(gated.client.from("launch_checklist_templates").update({ name: "Renamed" }).eq("id", templateId));
    expect(await count(`select count(*) as n from public.launch_checklist_templates
      where id = $1 and name = 'Gated template'`, [templateId])).toBe(1);
  });

  it("denies making a template the team default", async () => {
    await denies(gated.client.rpc("set_default_checklist_template",
      { p_team_id: teamId, p_template_id: templateId }));
    expect(await count(`select count(*) as n from public.launch_checklist_templates
      where team_id = $1 and is_default`, [teamId])).toBe(0);
  });

  it("denies adding and editing template items", async () => {
    await denies(gated.client.from("launch_checklist_template_items")
      .insert({ team_id: teamId, template_id: templateId, label: "Denied" }));
    await denies(gated.client.from("launch_checklist_template_items").update({ label: "Renamed" })
      .eq("id", templateItemId));
    // One label, and it is the fixture's: neither the insert nor the rename left a trace.
    expect(await sql("select label from public.launch_checklist_template_items where template_id = $1", [templateId]))
      .toEqual([{ label: "Ship it" }]);
  });

  it("denies applying a template and ticking a snapshot item", async () => {
    // The trashed launch carries no snapshot yet, so this application would genuinely succeed.
    await denies(gated.client.rpc("apply_checklist_template",
      { p_launch_id: trashedLaunchId, p_template_id: templateId }));
    await denies(gated.client.from("launch_checklist_items").update({ is_complete: true }).eq("id", checklistItemId));
    expect(await count("select count(*) as n from public.launch_checklists where team_id = $1", [teamId])).toBe(1);
    expect(await count("select count(*) as n from public.launch_checklist_items where id = $1 and not is_complete",
      [checklistItemId])).toBe(1);
  });
});

describe("team-scoped resolution", () => {
  it("returns the claimed members of a shared team, subjects other than the caller included", async () => {
    const resolved = await peer.client.rpc("resolve_team_usernames", { p_team_id: teamId });
    expect(resolved.error).toBeNull();
    // `mate` is the point: the caller resolves a subject that is not itself. The gated owner is
    // absent because it holds no reservation -- this is a directory of claims, never a roster.
    expect(byUser(resolved.data ?? [])).toEqual(byUser([
      { user_id: mate.userId, username: mate.username }, { user_id: peer.userId, username: peer.username }]));
  });

  it("discloses nothing to an account that does not share the team", async () => {
    const outside = await stranger.client.rpc("resolve_team_usernames", { p_team_id: teamId });
    // An empty set rather than a refusal, and the same empty set for a team that does not exist, so
    // neither answer says whether the team, the membership or the reservation is the missing one.
    expect(outside.error).toBeNull();
    expect(outside.data).toEqual([]);
    expect((await stranger.client.rpc("resolve_team_usernames", { p_team_id: randomUUID() })).data).toEqual([]);
    // The resolver stays the only door: the registry underneath it is still unreadable.
    expect((await stranger.client.from("username_reservations").select("username")).error?.code).toBe("42501");
  });
});
