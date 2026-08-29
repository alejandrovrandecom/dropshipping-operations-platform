// Denial proofs for team invitations, each a threat from the design's RED-first matrix: issuing
// is owner-only, acceptance is bound to one team and one verified recipient, and every expired,
// reused, wrong-recipient, unauthenticated or tampered attempt fails closed leaving state intact.
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createCaptureDelivery, DeliveryNotConfigured, resolveDelivery } from "../../supabase/functions/send-invitation/delivery";
import { anonClient, signIn, sql, uniqueEmail } from "../support/local-stack";

type Actor = Awaited<ReturnType<typeof signIn>>;
let owner: Actor, member: Actor, outsider: Actor, teamId: string, outsiderTeamId: string;

const issue = (actor: Actor, team: string, email: string) =>
  actor.client.rpc("create_invitation", { target_team_id: team, invitee_email: email });
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const count = async (where: string, values: unknown[]): Promise<number> =>
  Number((await sql<{ count: string }>(`select count(*) from public.${where}`, values))[0].count);
const members = (team: string) => count("memberships where team_id = $1", [team]);
const acceptedAt = async (token: string): Promise<string | null> =>
  (await sql<{ accepted_at: string | null }>(
    "select accepted_at from public.team_invitations where token_hash = $1", [hashOf(token)]))[0]?.accepted_at ?? null;
const startTeam = async (actor: Actor, name: string): Promise<string> =>
  (await actor.client.from("teams").insert({ name }).select("id").single()).data!.id as string;

/** Issues a fresh invitation for a never-seen address and returns both halves. */
async function pending(label: string): Promise<{ email: string; token: string }> {
  const email = uniqueEmail(label);
  const { data, error } = await issue(owner, teamId, email);
  expect(error).toBeNull();
  return { email, token: data as string };
}

beforeAll(async () => {
  [owner, member, outsider] = await Promise.all(["inv-owner", "inv-member", "inv-outsider"].map((l) => signIn(uniqueEmail(l))));
  teamId = await startTeam(owner, "Invite team");
  outsiderTeamId = await startTeam(outsider, "Other team");
  await sql("insert into public.memberships (team_id, user_id) values ($1, $2)", [teamId, member.userId]);
});

describe("issuing", () => {
  it("refuses every caller that is not this team's owner", async () => {
    const before = await members(teamId);
    for (const actor of [member, outsider]) expect((await issue(actor, teamId, uniqueEmail("denied"))).error).not.toBeNull();
    expect((await issue(owner, outsiderTeamId, uniqueEmail("denied"))).error).not.toBeNull(); // cross-team
    expect((await issue(owner, teamId, "not-an-address")).error).not.toBeNull();
    const anon = await anonClient().rpc("create_invitation", { target_team_id: teamId, invitee_email: uniqueEmail("anon") });
    expect(anon.error).not.toBeNull();
    expect(await count("team_invitations where team_id = $1", [teamId])).toBe(0);
    expect(await members(teamId)).toBe(before);
  });

  it("returns a server-generated token and stores only its hash", async () => {
    const { email, token } = await pending("hashed");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const [row] = await sql<{ token_hash: string; email: string; accepted_at: string | null }>(
      "select token_hash, email, accepted_at from public.team_invitations where team_id = $1 and email = $2", [teamId, email]);
    expect(row.email).toBe(email.toLowerCase());
    expect(row.accepted_at).toBeNull();
    expect(row.token_hash).toBe(hashOf(token));
    expect(row.token_hash).not.toBe(token);
  });

  it("hides invitations from every caller except the owner", async () => {
    await pending("hidden");
    for (const client of [member.client, outsider.client, anonClient()])
      expect((await client.from("team_invitations").select("id")).data ?? []).toEqual([]);
    expect(((await owner.client.from("team_invitations").select("id")).data ?? []).length).toBeGreaterThan(0);
  });
});

describe("acceptance", () => {
  it("grants membership exactly once and consumes the invitation", async () => {
    const { email, token } = await pending("joiner");
    const joiner = await signIn(email);
    const first = await joiner.client.rpc("accept_invitation", { token });
    expect(first.error).toBeNull();
    expect(first.data).toBe(teamId); // team-bound: the token names the team, the caller never does
    expect(await acceptedAt(token)).not.toBeNull();
    expect((await joiner.client.rpc("accept_invitation", { token })).error).not.toBeNull(); // single use
    expect(await count("memberships where team_id = $1 and user_id = $2", [teamId, joiner.userId])).toBe(1);
  });

  it("leaves the team unchanged for expired, wrong-recipient, unauthenticated and tampered attempts", async () => {
    const before = await members(teamId);
    const expired = await pending("expired");
    await sql("update public.team_invitations set expires_at = now() - interval '1 day' where token_hash = $1", [hashOf(expired.token)]);
    const stale = await signIn(expired.email);
    expect((await stale.client.rpc("accept_invitation", { token: expired.token })).error).not.toBeNull();
    const target = await pending("target");
    expect((await outsider.client.rpc("accept_invitation", { token: target.token })).error).not.toBeNull(); // wrong recipient
    expect((await anonClient().rpc("accept_invitation", { token: target.token })).error).not.toBeNull(); // unauthenticated
    const intended = await signIn(target.email);
    const tampered = target.token.slice(0, -1) + (target.token.endsWith("0") ? "1" : "0");
    expect((await intended.client.rpc("accept_invitation", { token: tampered })).error).not.toBeNull();
    for (const token of [expired.token, target.token]) expect(await acceptedAt(token)).toBeNull();
    expect(await members(teamId)).toBe(before);
  });
});

it("captures invitation mail locally and never claims delivery without a configured provider", async () => {
  const message = { to: "invitee@example.test", teamId, acceptUrl: "http://127.0.0.1:3000/invitations/token" };
  const capture = createCaptureDelivery();
  await capture.send(message);
  expect(capture.sent).toEqual([message]);
  for (const environment of ["local", "test"]) expect(resolveDelivery({ INVITATION_ENV: environment }).channel).toBe("capture");
  for (const env of [{}, { INVITATION_ENV: "production" }, { INVITATION_ENV: "staging" }])
    expect(() => resolveDelivery(env)).toThrow(DeliveryNotConfigured);
});
