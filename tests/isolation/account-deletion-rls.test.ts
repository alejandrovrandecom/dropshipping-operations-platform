// The privileged deletion surface, proved closed from the outside. `service_role` is the only
// principal that may observe, claim or perform a deletion, and it is execute-only -- it holds no
// privilege on the receipt itself, so there is no second door. Each refusal is asserted verbatim,
// code and message together, because the message is the disclosure surface: it may name the function
// the caller already knew it was calling, and nothing of the subject, its state or the tenant it
// still owns. Every `it` is the "Finalization is unauthorized" scenario from the change's specs.
import { beforeAll, describe, expect, it } from "vitest";
import { anonClient, signIn, sql, uniqueEmail } from "../support/local-stack";

type Actor = Awaited<ReturnType<typeof signIn>>;

/** Every privileged entry point, alphabetical; each takes the subject id, nothing else. The
 *  finalizer joins the pair the ledger shipped: it is the one that actually deletes, so a client
 *  role reaching it would be strictly worse than reaching either of the other two. */
const PRIVILEGED = ["account_deletion_status", "claim_account_deletion", "finalize_account_deletion"];

/** Every fact below is read privileged, because no client holds a single privilege on this table. */
const fact = async (expression: string, source: string, values: unknown[] = []): Promise<string | null> =>
  (await sql<{ fact: string }>(`select (${expression})::text as fact from public.${source}`, values))[0]?.fact ?? null;
/** `<function>=<may this role execute it>`, read out of the catalog rather than inferred from DDL. */
const executable = async (role: string): Promise<string[]> => (await sql<{ fact: string }>(
  `select p.proname || '=' || pg_catalog.has_function_privilege($1, p.oid, 'execute')::text as fact
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any ($2) order by 1`, [role, PRIVILEGED])).map((row) => row.fact);

let subject: Actor, insider: Actor, outsider: Actor, condemned: string;

beforeAll(async () => {
  [subject, insider, outsider] = await Promise.all(
    ["claim-subject", "claim-insider", "claim-outsider"].map((label) => signIn(uniqueEmail(label))));
  condemned = (await subject.client.from("teams").insert({ name: "Condemned" })
    .select("id").single()).data!.id as string;
  await sql("insert into public.memberships (team_id, user_id) values ($1, $2)", [condemned, insider.userId]);
  // A real subject in a real state: pending, owning a live team, with a teammate who can see it.
  expect((await subject.client.rpc("request_account_deletion", { p_delete_team_ids: [condemned] })).data)
    .toBe("pending");
});

describe("no client role reaches the privileged claim", () => {
  it("refuses every entry point to the subject, an insider, an outsider and anon alike", async () => {
    const callers = [subject.client, insider.client, outsider.client, anonClient()];
    const refusals = await Promise.all(callers.flatMap((client) =>
      PRIVILEGED.map((name) => client.rpc(name, { p_user_id: subject.userId }))));

    // Twelve calls collapse to three answers, one per function and none per caller: the subject can
    // neither claim nor perform its own deletion, the insider cannot read a teammate's state, and
    // neither the outsider nor anon learns whether the subject, its request or its team exists.
    expect([...new Set(refusals.map((r) => `${r.error?.code}: ${r.error?.message}`))].sort())
      .toEqual(PRIVILEGED.map((name) => `42501: permission denied for function ${name}`));
  });

  it("moves no deletion state and leaves no other route to the receipt", async () => {
    expect(await fact("state", "account_deletion_requests where user_id = $1", [subject.userId])).toBe("pending");
    expect(await fact("attempts", "account_deletion_requests where user_id = $1", [subject.userId])).toBe("0");
    expect(await fact("owner_user_id", "teams where id = $1", [condemned])).toBe(subject.userId);
    // A refused caller cannot fall back to the table: forced and ungranted, so those are the doors.
    for (const reader of [subject.client, insider.client, outsider.client, anonClient()])
      expect((await reader.from("account_deletion_requests").select("state")).error?.code).toBe("42501");
  });

  it("holds execute for service_role alone", async () => {
    // Triangulation: the grant exists and lands on exactly one role, so the refusals above are a
    // closed privilege rather than a missing function.
    expect(await executable("service_role")).toEqual(PRIVILEGED.map((name) => `${name}=true`));
    for (const role of ["authenticated", "anon"])
      expect(await executable(role)).toEqual(PRIVILEGED.map((name) => `${name}=false`));
  });
});
