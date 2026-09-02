// Behavioral proof for the team ownership transfer boundary, the first half of resolving an
// account's owned teams before deletion. Every `it` below is a scenario from
// `openspec/changes/account-deletion-lifecycle/specs/`: an offer comes from the current owner and
// names one current member, and acceptance moves ownership to exactly that member or to nobody.
// The request state that consumes a resolved team is the next slice and is deliberately absent.
import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, signIn, sql, uniqueEmail, uniqueUsername } from "../support/local-stack";

type Actor = Awaited<ReturnType<typeof signIn>>;

const startTeam = async (actor: Actor, name: string): Promise<string> =>
  (await actor.client.from("teams").insert({ name }).select("id").single()).data!.id as string;
const join = (team: string, actor: Actor): Promise<unknown[]> =>
  sql("insert into public.memberships (team_id, user_id) values ($1, $2)", [team, actor.userId]);
const offerTeam = (actor: Actor, team: string, to: string) =>
  actor.client.rpc("request_team_ownership_transfer", { p_team_id: team, p_to_user_id: to });
const acceptTeam = (actor: Actor, transfer: string) =>
  actor.client.rpc("accept_team_ownership_transfer", { p_transfer_id: transfer });

/** Every fact below is read privileged, because no client holds a single privilege on this table. */
const fact = async (expression: string, source: string, values: unknown[] = []): Promise<string | null> =>
  (await sql<{ fact: string }>(`select (${expression})::text as fact from public.${source}`, values))[0]?.fact ?? null;
const ownerOf = (team: string) => fact("owner_user_id", "teams where id = $1", [team]);
const offers = (team: string) => fact("count(*)", "team_ownership_transfers where team_id = $1", [team]);
const offerFact = (expression: string, transfer: string) =>
  fact(expression, "team_ownership_transfers where id = $1", [transfer]);
/** Moves an offer's expiry relative to now, so the seven-day boundary can be crossed on demand. */
const age = (transfer: string, shift: string) => sql(
  "update public.team_ownership_transfers set expires_at = pg_catalog.now() + $2::interval where id = $1",
  [transfer, shift]);

let owner: Actor, member: Actor, outsider: Actor, team: string;

beforeAll(async () => {
  [owner, member, outsider] = await Promise.all(
    ["xfer-owner", "xfer-member", "xfer-outsider"].map((l) => signIn(uniqueEmail(l))));
  team = await startTeam(owner, "Transfer team");
  await join(team, member);
});

describe("ownership transfer is owner-to-member and recipient-bound", () => {
  // Scenario: Isolated ownership transfer -- only a current owner offers, only to a current member.
  it("refuses every offer that is not the current owner naming another current member", async () => {
    for (const a of [member, outsider]) expect((await offerTeam(a, team, member.userId)).error?.code).toBe("42501");
    expect((await offerTeam(owner, team, outsider.userId)).error?.code).toBe("42501"); // not a member
    expect((await offerTeam(owner, team, owner.userId)).error?.code).toBe("42501"); // not another member
    expect((await anonClient().rpc("request_team_ownership_transfer",
      { p_team_id: team, p_to_user_id: member.userId })).error).not.toBeNull();

    expect(await ownerOf(team)).toBe(owner.userId);
    expect(await offers(team)).toBe("0");
  });

  // Scenarios: Invalid acceptance, then Intended acceptance -- ownership lands on the named successor.
  it("moves ownership to the intended recipient alone, with no ownerless interval", async () => {
    const offered = await offerTeam(owner, team, member.userId);
    expect(offered.error).toBeNull();
    const id = offered.data as string;

    for (const a of [owner, outsider]) expect((await acceptTeam(a, id)).error?.code).toBe("22023");
    expect((await anonClient().rpc("accept_team_ownership_transfer", { p_transfer_id: id })).error).not.toBeNull();
    expect(await ownerOf(team)).toBe(owner.userId); // every refusal left ownership where it was

    expect((await acceptTeam(member, id)).data).toBe(team);
    expect(await ownerOf(team)).toBe(member.userId); // the recipient this offer named, by id
    expect((await acceptTeam(member, id)).error?.code).toBe("22023"); // single use

    // Unrepresentable rather than merely unobserved: the claim and the move share one transaction,
    // and the column they move cannot hold the absence of an owner in between.
    expect((await sql<{ fact: string }>(`select a.attnotnull::text as fact from pg_attribute a
      where a.attrelid = 'public.teams'::regclass and a.attname = 'owner_user_id'`))[0].fact).toBe("true");
  });

  // A re-offer must not depend on the previous one expiring: the index predicate cannot call `now()`,
  // so an unaccepted row left standing would block its team forever.
  it("supersedes a standing offer, leaving only the newest one acceptable", async () => {
    const retried = await startTeam(owner, "Superseded");
    await Promise.all([join(retried, member), join(retried, outsider)]);
    const first = await offerTeam(owner, retried, member.userId);
    const second = await offerTeam(owner, retried, outsider.userId);
    expect(second.error).toBeNull();
    expect(await offers(retried)).toBe("1");

    expect((await acceptTeam(member, first.data as string)).error?.code).toBe("22023");
    expect(await ownerOf(retried)).toBe(owner.userId);
    expect((await acceptTeam(outsider, second.data as string)).data).toBe(retried);
    expect(await ownerOf(retried)).toBe(outsider.userId);
  });

  // An owner may remove a member at any time, including after offering them the team. Ownership must
  // not land on a non-member, or the owner-is-a-member invariant `ensure_owner_membership` sets up
  // would be broken by a row that was valid when it was written.
  it("refuses a recipient removed from the team after the offer was made", async () => {
    const revoked = await startTeam(owner, "Removed recipient");
    await join(revoked, member);
    const offered = await offerTeam(owner, revoked, member.userId);
    expect(offered.error).toBeNull();
    expect((await owner.client.from("memberships")
      .delete().eq("team_id", revoked).eq("user_id", member.userId).select()).error).toBeNull();

    expect((await acceptTeam(member, offered.data as string)).error?.code).toBe("22023");
    expect(await ownerOf(revoked)).toBe(owner.userId);
    expect(await offerFact("accepted_at is null", offered.data as string)).toBe("true");
  });

  // Scenario: Invalid acceptance -- the seven-day boundary from both sides. The unexpired offer
  // keeps a minute rather than a second, so this proves the boundary and not the round trip.
  it("expires an offer after seven days and denies it without leaking transfer state", async () => {
    const [stale, fresh] = [await startTeam(outsider, "Stale"), await startTeam(outsider, "Fresh")];
    await Promise.all([join(stale, member), join(fresh, member)]);
    const [expired, live] = await Promise.all(
      [offerTeam(outsider, stale, member.userId), offerTeam(outsider, fresh, member.userId)]);
    expect(await offerFact("expires_at - created_at = interval '7 days'", live.data as string)).toBe("true");

    await age(expired.data as string, "-1 second");
    expect((await acceptTeam(member, expired.data as string)).error?.code).toBe("22023");
    expect(await ownerOf(stale)).toBe(outsider.userId);
    expect(await offerFact("accepted_at is null", expired.data as string)).toBe("true");

    // Triangulation: one minute inside the same boundary the identical call succeeds, so the
    // refusal above proves the expiry and not the recipient, the team or the offer.
    await age(live.data as string, "1 minute");
    expect((await acceptTeam(member, live.data as string)).data).toBe(fresh);
    expect(await ownerOf(fresh)).toBe(member.userId);
  });
});

// The gate is a baseline contract (`openspec/specs/identity-session-contracts/spec.md`): a confirmed
// account without a username may claim one and MUST be denied every other protected identity, team
// and membership write. Transfers are exactly that, and the tests above cannot see the gap, because
// `signIn` claims a username on the way in.
describe("the username gate reaches the transfer write path", () => {
  const GATE = "username: claim a username before writing";

  it("denies both RPCs to an account holding no username, then admits them once it claims", async () => {
    const newcomer = await signIn(uniqueEmail("gate-newcomer"), false);
    const [kept, handed] = [await startTeam(owner, "Gate kept"), await startTeam(owner, "Gate handed")];
    await Promise.all([join(kept, newcomer), join(handed, newcomer)]);
    // Setup only, privileged: a usernameless account cannot reach ownership through the product.
    await sql("update public.teams set owner_user_id = $2 where id = $1", [handed, newcomer.userId]);
    const offered = await offerTeam(owner, kept, newcomer.userId);
    expect(offered.error).toBeNull();

    // Both calls are otherwise valid, and the gate's own message proves the refusal is the gate and
    // not the ownership check or the recipient binding. The offer is stopped by this slice's own
    // trigger; acceptance is stopped by the `teams` trigger the ownership move already passes.
    for (const denied of [await offerTeam(newcomer, handed, owner.userId),
      await acceptTeam(newcomer, offered.data as string)]) {
      expect(denied.error?.code).toBe("42501");
      expect(denied.error?.message).toContain(GATE);
    }
    expect(await offers(handed)).toBe("0");
    expect(await ownerOf(kept)).toBe(owner.userId);
    expect(await offerFact("accepted_at is null", offered.data as string)).toBe("true");

    // Triangulation: one claim later the identical two calls succeed, so the missing username was
    // the whole of the refusal and the gate is not standing in for some other denial.
    expect((await newcomer.client.rpc("claim_username", { p_username: uniqueUsername() })).error).toBeNull();
    expect((await offerTeam(newcomer, handed, owner.userId)).error).toBeNull();
    expect((await acceptTeam(newcomer, offered.data as string)).data).toBe(kept);
    expect(await ownerOf(kept)).toBe(newcomer.userId);
  });
});
