// Username reservation, first slice: a name is claimed once, atomically and permanently. It
// outlives the account that made it, it is refused without disclosing why, and the registry itself
// is closed to every direct read.
//
// This slice is the registry and the claim, nothing else. The onboarding gate and team-scoped
// resolution are the next one, so every refusal below belongs to the claim contract alone -- no
// assertion here can be satisfied by a gate that does not exist yet.
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { signIn, sql, uniqueEmail, uniqueUsername } from "../support/local-stack";

type Actor = Awaited<ReturnType<typeof signIn>>;
type Call = PromiseLike<{ error: { code: string; message: string } | null }>;

const account = (label: string) => signIn(uniqueEmail(label));
const claim = (actor: Actor, username: string) => actor.client.rpc("claim_username", { p_username: username });
const codeOf = async (call: Call): Promise<string> => (await call).error?.code ?? "ALLOWED";
const reservations = async (where: string, values: unknown[]): Promise<number> =>
  Number((await sql<{ n: string }>(`select count(*) as n from public.username_reservations where ${where}`, values))[0].n);
/** A fresh account that has adopted the contract, plus the name it now permanently holds. */
const claimant = async (label: string): Promise<Actor & { username: string }> => {
  const actor = await account(label);
  const claimed = await claim(actor, uniqueUsername());
  if (claimed.error) throw claimed.error;
  return { ...actor, username: claimed.data as string };
};

describe("permanent reservation", () => {
  it("accepts a first claim from an account that has no username", async () => {
    const actor = await account("ur-first");
    const wanted = uniqueUsername();
    const claimed = await claim(actor, wanted);
    expect(claimed.error).toBeNull();
    expect(claimed.data).toBe(wanted);
    expect((await sql("select username, user_id from public.username_reservations where user_id = $1", [actor.userId]))[0])
      .toEqual({ username: wanted, user_id: actor.userId });
  });

  it("normalizes the candidate, so the reservation is the name and not the caller's spelling", async () => {
    const actor = await account("ur-normalized");
    const wanted = uniqueUsername();
    const claimed = await claim(actor, `  ${wanted.toUpperCase()}  `);
    expect(claimed.data).toBe(wanted);
    // The stored row is normalized too, not merely the returned value.
    expect(await reservations("username = $1 and user_id = $2", [wanted, actor.userId])).toBe(1);
    // And the normalized name is now taken, so normalization cannot be used to claim twice.
    expect(await codeOf(claim(await account("ur-normalized-rival"), wanted.toUpperCase()))).toBe("22023");
  });

  it("rejects every malformed candidate without reserving anything", async () => {
    const actor = await account("ur-invalid");
    for (const candidate of ["", "ab", "a".repeat(31), "Not Valid", "dash-name", "dot.name", "emoji\u{1F600}"])
      expect(await codeOf(claim(actor, candidate))).toBe("22023");
    expect(await reservations("user_id = $1", [actor.userId])).toBe(0);
    // The length rule is a boundary, not a ceiling: 31 characters above is refused and exactly 30
    // is accepted. A literal short name is deliberately avoided -- the registry is permanent, so a
    // fixed candidate would be spent on its first run and collide on every later one.
    const longest = `${uniqueUsername()}${"0".repeat(30)}`.slice(0, 30);
    expect((await claim(actor, longest)).data).toBe(longest);
  });

  it("keeps the reservation, and only the reservation, once the account is deleted", async () => {
    const actor = await claimant("ur-deleted");
    await sql("delete from auth.users where id = $1", [actor.userId]);
    expect((await sql("select count(*) as n from public.profiles where user_id = $1", [actor.userId]))[0])
      .toEqual({ n: "0" });
    expect((await sql("select username, user_id from public.username_reservations where user_id = $1", [actor.userId]))[0])
      .toEqual({ username: actor.username, user_id: actor.userId });
    // The name stays taken by a user who no longer exists...
    expect(await codeOf(claim(await account("ur-survivor"), actor.username))).toBe("22023");
    // ...and the registry has no column that could ever have carried an email or the rest of a profile.
    expect(await sql(`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'username_reservations' order by 1`))
      .toEqual([{ column_name: "claimed_at" }, { column_name: "user_id" }, { column_name: "username" }]);
  });
});

describe("atomic, disclosure-safe claims", () => {
  it("lets exactly one of two concurrent claimants win the same name", async () => {
    const [a, b] = await Promise.all([account("ur-race-a"), account("ur-race-b")]);
    const wanted = uniqueUsername();
    const settled = await Promise.all([claim(a, wanted), claim(b, wanted)]);
    expect(settled.map((result) => result.error?.code ?? "won").sort()).toEqual(["22023", "won"]);
    expect(await reservations("username = $1", [wanted])).toBe(1);
  });

  it("refuses a taken name and a repeat claim with the identical rejection", async () => {
    const holder = await claimant("ur-holder");
    const rival = await account("ur-rival");
    const taken = await claim(rival, holder.username); // the name belongs to somebody else
    const repeat = await claim(holder, uniqueUsername()); // the caller already holds a name
    expect(taken.error?.code).toBe("22023");
    expect(taken.error?.code).toBe(repeat.error?.code);
    expect(taken.error?.message).toBe(repeat.error?.message);
    // Only the format rule may differ, because a caller can compute it without asking.
    expect((await claim(rival, "no")).error?.message).not.toBe(taken.error?.message);
    // Neither refusal wrote anything: the holder keeps one name, the rival still has none.
    expect(await reservations("user_id = $1", [rival.userId])).toBe(0);
    expect(await reservations("user_id = $1", [holder.userId])).toBe(1);
  });
});

describe("closed registry", () => {
  it("denies every direct read of the registry, broad or targeted", async () => {
    const holder = await claimant("ur-closed");
    const reader = await claimant("ur-reader");
    expect(await codeOf(reader.client.from("username_reservations").select("username"))).toBe("42501");
    expect(await codeOf(reader.client.from("username_reservations").select("username").eq("user_id", holder.userId)))
      .toBe("42501");
    // Not even the holder may read its own row: the registry has no `select` grant at all, so the
    // claim RPC is the only door and there is no reservation-status oracle anywhere.
    expect(await codeOf(holder.client.from("username_reservations").select("username").eq("user_id", holder.userId)))
      .toBe("42501");
  });
});

describe("backend-only adoption", () => {
  it("adopts the contract by recreating an account, with no backfill path", async () => {
    const legacy = await account("ur-legacy"); // an account predating the contract, never claimed
    const recreated = await claimant("ur-recreated"); // recreation is the whole adoption story
    expect(recreated.username).toMatch(/^[a-z0-9_]{3,30}$/);
    // No backfill door exists: the claim binds to the verified caller, so nothing lets one account
    // reserve a name on another account's behalf.
    expect(await reservations("user_id = $1", [legacy.userId])).toBe(0);
    expect(await reservations("user_id = $1", [recreated.userId])).toBe(1);
  });

  it("adds no user-visible onboarding surface", () => {
    // Backend-only is falsifiable here: an onboarding screen needs a component, markup or style
    // file, and the client tree still holds nothing but TypeScript modules.
    const files = readdirSync("src", { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile()).map((entry) => `${entry.parentPath}/${entry.name}`);
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => !file.endsWith(".ts"))).toEqual([]);
  });
});
