// Behavioral proof for the deletion-time reference boundary: which references refuse an account's
// final deletion, which relax to null, and what the surviving rows look like afterwards. Every `it`
// below is a scenario from `openspec/changes/account-deletion-lifecycle/specs/`.
//
// The first three describes predate the claim ledger and drive deletion through privileged SQL:
// their subject is the referential contract itself. The last one drives the claim, the way
// `service_role` will -- through the database, never through `src/`, which holds no such key. The
// finalizer that consumes a claim is the next slice; nothing here deletes an account.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signIn, sql, uniqueEmail } from "../support/local-stack";

type Actor = Awaited<ReturnType<typeof signIn>>;
type Refusal = { code?: string; constraint?: string };

/** Deletes the auth identity the way finalization will, reporting a referential refusal instead of throwing. */
async function deleteAccount(userId: string): Promise<Refusal> {
  try {
    await sql("delete from auth.users where id = $1", [userId]);
    return {};
  } catch (error) {
    const { code, constraint } = error as Refusal;
    return { code, constraint };
  }
}

const startTeam = async (actor: Actor, name: string): Promise<string> =>
  (await actor.client.from("teams").insert({ name }).select("id").single()).data!.id as string;
const join = (team: string, actor: Actor): Promise<unknown[]> =>
  sql("insert into public.memberships (team_id, user_id) values ($1, $2)", [team, actor.userId]);
const rows = async (query: string, values: unknown[]): Promise<number> =>
  Number((await sql<{ n: string }>(query, values))[0].n);

/** The six relaxed authoring references, as `<table>.<column>`; the names are constants, never input. */
const AUTHORED = ["launches.created_by", "launch_checklist_templates.created_by",
  "launch_checklist_template_items.created_by", "launch_checklists.created_by",
  "launch_checklist_items.created_by", "launch_events.actor_user_id"];
/** `<table>=<rows whose author is null>/<rows>` for every one of them, within one team. */
const authorship = async (team: string): Promise<string[]> => (await sql<{ fact: string }>(
  `${AUTHORED.map((reference) => { const [table, column] = reference.split(".");
    return `select '${table}=' || count(*) filter (where ${column} is null) || '/' || count(*) as fact
      from public.${table} where team_id = $1`; }).join(" union all ")} order by 1`,
  [team])).map((row) => row.fact);

/** The two privileged entry points, driven as `service_role` will drive them; names are constants. */
const privileged = async (rpc: string, userId: string): Promise<string | null> =>
  (await sql<{ state: string | null }>(`select public.${rpc}($1) as state`, [userId]))[0].state;
const status = (userId: string) => privileged("account_deletion_status", userId);
const claim = (userId: string) => privileged("claim_account_deletion", userId);
const requestDeletion = (actor: Actor) =>
  actor.client.rpc("request_account_deletion", { p_delete_team_ids: [] });
const attemptsOf = (userId: string): Promise<number> =>
  rows("select attempts as n from public.account_deletion_requests where user_id = $1", [userId]);
/** Writes the outcome the next slice's finalizer will write; this one ships no finalizer to write it. */
const settle = (userId: string, state: string): Promise<unknown[]> =>
  sql(`update public.account_deletion_requests set state = $2::public.account_deletion_state
    where user_id = $1`, [userId, state]);

/** Every invitation of a team, rendered as its participants plus the facts that must not move. */
const invitations = async (team: string): Promise<string[]> => (await sql<{ fact: string }>(
  `select i.email || ': by=' || coalesce(i.invited_by::text, 'null') || ' accepted_by='
     || coalesce(i.accepted_by::text, 'null') || ' accepted=' || (i.accepted_at is not null)::text
     || ' hashed=' || (pg_catalog.length(i.token_hash) = 64)::text as fact
     from public.team_invitations i where i.team_id = $1 order by i.email`, [team])).map((row) => row.fact);

describe("live team ownership still refuses final deletion", () => {
  // Scenario: Selected team is deleted -- the team is resolved before its owner identity, never after.
  it("refuses an owner holding a live team and accepts the same account once the team is gone", async () => {
    const owner = await signIn(uniqueEmail("del-owner"));
    const team = await startTeam(owner, "Owned team");

    expect(await deleteAccount(owner.userId)).toEqual({ code: "23503", constraint: "teams_owner_user_id_fkey" });
    expect(await rows("select count(*) as n from public.teams where id = $1", [team])).toBe(1);
    expect(await rows("select count(*) as n from public.profiles where user_id = $1", [owner.userId])).toBe(1);

    // Triangulation: the same account, with the team resolved first, is accepted -- so the refusal
    // above is that one live ownership reference, not a blanket ban on deleting an account.
    expect((await owner.client.from("teams").delete().eq("id", team).select()).error).toBeNull();
    expect(await deleteAccount(owner.userId)).toEqual({});
    expect(await rows("select count(*) as n from public.profiles where user_id = $1", [owner.userId])).toBe(0);
  });
});

describe("historical authoring references relax to null", () => {
  // Scenario: Historical attribution is cleared
  it("deletes a member and leaves every launch record present with a null author", async () => {
    const [owner, leaver] = await Promise.all(["del-hist-owner", "del-hist-leaver"]
      .map((label) => signIn(uniqueEmail(label))));
    const team = await startTeam(owner, "History survives");
    await join(team, leaver);

    const id = randomUUID();
    expect((await leaver.client.rpc("create_launch",
      { p_launch_id: id, p_team_id: team, p_name: "Authored once" })).data).toBe(id);
    const template = await leaver.client.from("launch_checklist_templates")
      .insert({ team_id: team, name: "Authored template" }).select("id").single();
    expect(template.error).toBeNull();
    expect((await leaver.client.from("launch_checklist_template_items")
      .insert({ team_id: team, template_id: template.data!.id, label: "Step", position: 0 })).error).toBeNull();
    expect((await leaver.client.rpc("apply_checklist_template",
      { p_launch_id: id, p_template_id: template.data!.id })).error).toBeNull();
    expect((await leaver.client.rpc("transition_launch", { p_launch_id: id, p_next: "discarded" })).error).toBeNull();

    // Every one of the six authoring references names the leaver while the leaver exists.
    expect(await authorship(team)).toEqual([
      "launch_checklist_items=0/1", "launch_checklist_template_items=0/1", "launch_checklist_templates=0/1",
      "launch_checklists=0/1", "launch_events=0/3", "launches=0/1"]);

    expect(await deleteAccount(leaver.userId)).toEqual({});

    // The same row counts, with every author cleared: the facts stayed, the person did not.
    expect(await authorship(team)).toEqual([
      "launch_checklist_items=1/1", "launch_checklist_template_items=1/1", "launch_checklist_templates=1/1",
      "launch_checklists=1/1", "launch_events=3/3", "launches=1/1"]);
    expect(await rows("select count(*) as n from public.profiles where user_id = $1", [leaver.userId])).toBe(0);
    // A membership is a live relationship rather than history, so it cascades away with the account
    // while the surviving owner's membership is untouched.
    expect(await rows("select count(*) as n from public.memberships where team_id = $1", [team])).toBe(1);
    expect(await rows("select count(*) as n from public.memberships where team_id = $1 and user_id = $2",
      [team, owner.userId])).toBe(1);
  });

  // Scenario: Historical reference survives without PII (identity-session-contracts)
  it("keeps both invitation scopes intact with a null issuer and a null acceptor", async () => {
    const joinerEmail = uniqueEmail("del-inv-joiner");
    const unusedEmail = uniqueEmail("del-inv-unused");
    const [issuer, successor, joiner] = await Promise.all(
      [uniqueEmail("del-inv-issuer"), uniqueEmail("del-inv-successor"), joinerEmail].map((email) => signIn(email)));
    const team = await startTeam(issuer, "Invitation history");
    await join(team, successor);

    const pending = await issuer.client.rpc("create_invitation", { target_team_id: team, invitee_email: unusedEmail });
    expect(pending.error).toBeNull();
    const offered = await issuer.client.rpc("create_invitation", { target_team_id: team, invitee_email: joinerEmail });
    expect(offered.error).toBeNull();
    expect((await joiner.client.rpc("accept_invitation", { token: offered.data as string })).error).toBeNull();
    expect(await invitations(team)).toEqual([
      `${joinerEmail}: by=${issuer.userId} accepted_by=${joiner.userId} accepted=true hashed=true`,
      `${unusedEmail}: by=${issuer.userId} accepted_by=null accepted=false hashed=true`]);

    // Ownership has to move before the issuer is deletable at all, because `teams.owner_user_id`
    // stays restrictive. The transfer RPC is a later slice, so the row state is built directly here:
    // what this slice owns is how the invitation references behave once the issuer is gone.
    await sql("update public.teams set owner_user_id = $2 where id = $1", [team, successor.userId]);
    expect(await deleteAccount(issuer.userId)).toEqual({});
    expect(await deleteAccount(joiner.userId)).toEqual({});

    // Both rows survive with only the participants cleared: recipient, hash and acceptance stand.
    expect(await invitations(team)).toEqual([
      `${joinerEmail}: by=null accepted_by=null accepted=true hashed=true`,
      `${unusedEmail}: by=null accepted_by=null accepted=false hashed=true`]);
  });

  // A null author is nobody, not everybody: the creator-only retry answer must not widen.
  it("still refuses a non-creator retry of a launch whose author was deleted", async () => {
    const [owner, author] = await Promise.all(["del-retry-owner", "del-retry-author"]
      .map((label) => signIn(uniqueEmail(label))));
    const team = await startTeam(owner, "Retry after deletion");
    await join(team, author);
    const id = randomUUID();
    const retry = (actor: Actor) =>
      actor.client.rpc("create_launch", { p_launch_id: id, p_team_id: team, p_name: "Authored" });

    expect((await retry(author)).data).toBe(id);
    expect((await retry(author)).data).toBe(id); // the author's own retry is answered
    expect((await retry(owner)).error?.code).toBe("42501"); // another member is refused

    expect(await deleteAccount(author.userId)).toEqual({});
    expect(await rows("select count(*) as n from public.launches where id = $1 and created_by is null", [id])).toBe(1);
    expect((await retry(owner)).error?.code).toBe("42501"); // and is still refused against a null author
  });
});

describe("the claim is the one admission point, and it is bounded", () => {
  // Scenario: Finalization succeeds -- the observable half of it. The state is read back *after* the
  // claim returns, so `in_progress` is a committed fact rather than a label one transaction passes.
  it("commits in_progress on a pending receipt and counts that admission exactly once", async () => {
    const subject = await signIn(uniqueEmail("claim-admit"));
    expect((await requestDeletion(subject)).data).toBe("pending");
    expect(await status(subject.userId)).toBe("pending");
    // The ledger column is added to a table the previous slice already writes, and that slice's RPC
    // names no such column: a receipt it creates still arrives at a safe, countable zero.
    expect(await attemptsOf(subject.userId)).toBe(0);

    expect(await claim(subject.userId)).toBe("in_progress");
    expect(await status(subject.userId)).toBe("in_progress"); // the claim committed it
    expect(await attemptsOf(subject.userId)).toBe(1);

    // Triangulation: a run already in flight is not admitted a second time, so two finalizers racing
    // for the same receipt cannot both count as executions.
    expect(await claim(subject.userId)).toBe("in_progress");
    expect(await attemptsOf(subject.userId)).toBe(1);

    // And a completed request is reported back rather than reopened: deletion is definitive.
    await settle(subject.userId, "done");
    expect(await claim(subject.userId)).toBe("done");
    expect(await attemptsOf(subject.userId)).toBe(1);
  });

  // Threat matrix: unbounded privileged retry. A `failed` receipt is re-claimable, which is what
  // makes continuation possible and what would otherwise make it endless.
  it("admits three executions of a receipt that keeps failing and refuses the fourth", async () => {
    const subject = await signIn(uniqueEmail("claim-bound"));
    expect((await requestDeletion(subject)).data).toBe("pending");

    // One initial admission and two retries. Each is a committed claim followed by the failure the
    // next slice's finalizer will record; seeded here, because this slice ships nothing that fails.
    for (const counted of [1, 2, 3]) {
      expect(await claim(subject.userId)).toBe("in_progress");
      expect(await attemptsOf(subject.userId)).toBe(counted);
      await settle(subject.userId, "failed");
    }

    // The fourth is refused, and refused silently: it admits no run, moves no state, and answers
    // exactly what a plain status read already answers, so the exhaustion is not a new disclosure.
    expect(await claim(subject.userId)).toBe("failed");
    expect(await status(subject.userId)).toBe("failed");
    expect(await attemptsOf(subject.userId)).toBe(3);

    // Frozen rather than finished, and unfinalizable in the strongest sense available here: the
    // receipt never reaches `in_progress` again, and this schema holds no finalizer at all. The
    // next slice adds one that refuses anything but `in_progress`; the bound stands without it.
    expect(await rows(`select count(*) as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'finalize%'`, [])).toBe(0);
  });

  // Triangulation on the answer itself: the claim never invents one. An account that never asked
  // gets the same null a status read gives, so no caller learns a request exists from the claim.
  it("answers an unknown subject with the null a status read gives", async () => {
    const stranger = randomUUID();
    const subject = await signIn(uniqueEmail("claim-stranger"));
    expect((await requestDeletion(subject)).data).toBe("pending");

    expect(await status(stranger)).toBeNull();
    expect(await claim(stranger)).toBeNull(); // and the same call against a real receipt admits it
    expect(await claim(subject.userId)).toBe("in_progress");
  });
});
