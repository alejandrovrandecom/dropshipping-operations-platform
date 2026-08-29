// Denial proofs for the identity tenant boundary. Every case below is a threat
// from the design's RED-first denial matrix and must fail closed in the
// database, not in application code.
import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, clientWithToken, expiredToken, signIn, sql, tamperedToken, uniqueEmail } from "../support/local-stack";

type Actor = Awaited<ReturnType<typeof signIn>>;

/** Well-formed but unissued invitation token used consistently across session states. */
const UNKNOWN_TOKEN = "0".repeat(64);

let owner: Actor;
let member: Actor;
let outsider: Actor;
let teamId: string;
let outsiderTeamId: string;

async function createTeam(actor: Actor, name: string): Promise<string> {
  const { data, error } = await actor.client.from("teams").insert({ name }).select("id").single();
  expect(error).toBeNull();
  return data!.id as string;
}

beforeAll(async () => {
  owner = await signIn(uniqueEmail("owner"));
  member = await signIn(uniqueEmail("member"));
  outsider = await signIn(uniqueEmail("outsider"));
  teamId = await createTeam(owner, "Owner team");
  outsiderTeamId = await createTeam(outsider, "Outsider team");
  await sql("insert into public.memberships (team_id, user_id) values ($1, $2)", [teamId, member.userId]);
});

describe("unauthenticated and expired sessions", () => {
  it("reads nothing and cannot write as an anonymous caller", async () => {
    const anon = anonClient();
    expect((await anon.from("teams").select("id")).data ?? []).toEqual([]);
    expect((await anon.from("memberships").select("team_id")).data ?? []).toEqual([]);
    expect((await anon.from("profiles").select("user_id")).data ?? []).toEqual([]);
    expect((await anon.from("teams").insert({ name: "anonymous" })).error).not.toBeNull();
  });

  it("rejects a correctly signed token that has expired", async () => {
    const stale = clientWithToken(expiredToken(owner.userId));
    const { data, error } = await stale.from("teams").select("id");
    expect(error).not.toBeNull();
    expect(data).toBeNull();
    expect((await stale.from("teams").insert({ name: "stale session" }).select()).error).not.toBeNull();
    const validRpc = await owner.client.rpc("accept_invitation", { token: UNKNOWN_TOKEN });
    const expiredRpc = await stale.rpc("accept_invitation", { token: UNKNOWN_TOKEN });
    expect({ status: validRpc.status, code: validRpc.error?.code }).toEqual({ status: 400, code: "22023" });
    expect({ status: expiredRpc.status, code: expiredRpc.error?.code }).toEqual({ status: 401, code: "PGRST303" });
  });

  // The valid `exp` matters: it proves the denial comes from signature verification, not from expiry.
  it("rejects an unexpired token whose signature does not verify", async () => {
    const forged = clientWithToken(tamperedToken(owner.userId));
    const { data, error } = await forged.from("teams").select("id");
    expect(error).not.toBeNull();
    expect(data).toBeNull();
    expect((await forged.from("teams").insert({ name: "forged session" }).select()).error).not.toBeNull();
    const forgedRpc = await forged.rpc("accept_invitation", { token: UNKNOWN_TOKEN });
    expect({ status: forgedRpc.status, code: forgedRpc.error?.code }).toEqual({ status: 401, code: "PGRST301" });
  });
});

describe("outsider access", () => {
  it("hides another team's rows from a non-member", async () => {
    expect((await outsider.client.from("teams").select("id")).data?.map((row) => row.id)).toEqual([outsiderTeamId]);
    expect((await outsider.client.from("memberships").select("team_id").eq("team_id", teamId)).data ?? []).toEqual([]);
  });

  it("cannot rename or delete a team it does not own", async () => {
    expect((await outsider.client.from("teams").update({ name: "seized" }).eq("id", teamId).select()).data ?? []).toEqual([]);
    expect((await outsider.client.from("teams").delete().eq("id", teamId).select()).data ?? []).toEqual([]);
    const [row] = await sql<{ name: string }>("select name from public.teams where id = $1", [teamId]);
    expect(row.name).toBe("Owner team");
  });
});

describe("forged payloads and cross-tenant writes", () => {
  it("refuses a forged owner_user_id and binds a new team to the caller", async () => {
    const forged = await outsider.client.from("teams").insert({ name: "forged", owner_user_id: owner.userId }).select();
    expect(forged.error).not.toBeNull();
    const honest = await createTeam(outsider, "Honest team");
    const [row] = await sql<{ owner_user_id: string }>("select owner_user_id from public.teams where id = $1", [honest]);
    expect(row.owner_user_id).toBe(outsider.userId);
  });

  it("refuses a membership written into a team the caller does not own", async () => {
    const forgedTeam = await outsider.client.from("memberships").insert({ team_id: teamId, user_id: outsider.userId }).select();
    expect(forgedTeam.error).not.toBeNull();
    const crossTeam = await owner.client.from("memberships").insert({ team_id: outsiderTeamId, user_id: owner.userId }).select();
    expect(crossTeam.error).not.toBeNull();
    const rows = await sql<{ count: string }>("select count(*) from public.memberships where team_id = $1", [outsiderTeamId]);
    expect(rows[0].count).toBe("1");
  });
});

describe("owner governance", () => {
  it("keeps the creator as a member and the sole governor", async () => {
    const rows = await sql<{ user_id: string }>("select user_id from public.memberships where team_id = $1", [teamId]);
    expect(rows.map((row) => row.user_id).sort()).toEqual([owner.userId, member.userId].sort());
  });

  it("denies a plain member the right to remove members or delete the team", async () => {
    expect((await member.client.from("memberships").delete().eq("team_id", teamId).eq("user_id", owner.userId).select()).data ?? []).toEqual([]);
    expect((await member.client.from("memberships").insert({ team_id: teamId, user_id: outsider.userId }).select()).error).not.toBeNull();
    expect((await member.client.from("teams").delete().eq("id", teamId).select()).data ?? []).toEqual([]);
    expect((await member.client.from("teams").update({ name: "member rename" }).eq("id", teamId).select()).data ?? []).toEqual([]);
  });

  it("lets the owner remove a member but never their own membership", async () => {
    expect((await owner.client.from("memberships").delete().eq("team_id", teamId).eq("user_id", owner.userId).select()).data ?? []).toEqual([]);
    const removed = await owner.client.from("memberships").delete().eq("team_id", teamId).eq("user_id", member.userId).select();
    expect(removed.error).toBeNull();
    expect(removed.data).toHaveLength(1);
    expect((await member.client.from("teams").select("id").eq("id", teamId)).data ?? []).toEqual([]);
  });
});

// Removal is authorization, not session state: the cutoff must be immediate and team-local, so a
// still-valid session keeps every team it was not removed from. Dedicated actors, because the
// governance case above consumes `member`.
describe("membership removal", () => {
  it("cuts off the removed team on the very next request and leaves the other team intact", async () => {
    const dual = await signIn(uniqueEmail("dual"));
    const [kept, dropped] = [await createTeam(owner, "Kept team"), await createTeam(owner, "Dropped team")];
    for (const team of [kept, dropped])
      await sql("insert into public.memberships (team_id, user_id) values ($1, $2)", [team, dual.userId]);
    const visible = async (): Promise<string[]> =>
      ((await dual.client.from("teams").select("id").in("id", [kept, dropped])).data ?? []).map((row) => row.id).sort();
    expect(await visible()).toEqual([kept, dropped].sort());

    await sql("delete from public.memberships where team_id = $1 and user_id = $2", [dropped, dual.userId]);

    // Same client, same unexpired JWT: the next request re-evaluates against live membership.
    expect(await visible()).toEqual([kept]);
    expect((await dual.client.from("memberships").select("user_id").eq("team_id", dropped)).data ?? []).toEqual([]);
    expect((await dual.client.from("memberships").insert({ team_id: dropped, user_id: dual.userId }).select()).error).not.toBeNull();
    expect((await dual.client.from("memberships").select("user_id").eq("team_id", kept)).data).toHaveLength(2);
  });
});
