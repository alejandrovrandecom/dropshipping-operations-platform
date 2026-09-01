// Contract proof for the identity module: it works against a database built only from
// migrations, it reaches no table outside its own domain, and its layers depend inwards --
// callers on the service, the service on the repository, the repository alone on the database.
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import type { IdentityClient } from "../../src/modules/identity/repository";
import { identityServiceFor } from "../../src/modules/identity/service";
import { signIn, uniqueEmail, uniqueUsername } from "../support/local-stack";

const MODULE_DIR = "src/modules/identity";
const serviceFor = (client: unknown) => identityServiceFor(client as IdentityClient);

it("starts a team and reads the workspace through the service", async () => {
  const { client, userId } = await signIn(uniqueEmail("module"));
  const service = serviceFor(client);
  const team = await service.startTeam("Module team");
  expect(team.owner_user_id).toBe(userId);
  const workspace = await service.workspace();
  expect(workspace.map((row) => row.id)).toContain(team.id);
  expect(workspace.find((row) => row.id === team.id)?.members.map((m) => m.user_id)).toEqual([userId]);
});

it("claims the account's one username through the service and lets the database normalize it", async () => {
  const { client } = await signIn(uniqueEmail("claim"), false);
  const service = serviceFor(client);
  const candidate = uniqueUsername();
  // The wrapper forwards the candidate untouched and answers with the stored name, not the input.
  expect(await service.claimUsername(`  ${candidate.toUpperCase()}  `)).toBe(candidate);

  // Triangulation: the claim is one-time, and the refusal surfaces as a module error, not a null.
  await expect(service.claimUsername(uniqueUsername())).rejects.toThrow(/identity: claim username failed/);
});

it("resolves the usernames of a shared team and discloses nothing outside it", async () => {
  const [owner, member, outsider] = await Promise.all(
    ["res-owner", "res-member", "res-outsider"].map((label) => signIn(uniqueEmail(label))));
  const service = serviceFor(owner.client);
  const team = await service.startTeam("Resolution team");
  await owner.client.from("memberships").insert({ team_id: team.id, user_id: member.userId });

  // Each subject is paired with its own name, so a resolver that answered a constant would fail.
  expect(new Map((await service.resolveTeamUsernames(team.id)).map((row) => [row.user_id, row.username])))
    .toEqual(new Map([[owner.userId, owner.username], [member.userId, member.username]]));

  // Triangulation: the same team id through a non-member's client resolves to nothing at all.
  expect(await serviceFor(outsider.client).resolveTeamUsernames(team.id)).toEqual([]);
});

it("keeps the module boundary and its dependency direction", () => {
  const read = (file: string) => readFileSync(`${MODULE_DIR}/${file}`, "utf8");
  expect(readdirSync(MODULE_DIR).sort()).toEqual(["repository.ts", "service.ts", "types.ts"]);
  for (const file of readdirSync(MODULE_DIR)) {
    for (const [, t] of read(file).matchAll(/\.from\("([a-z_]+)"\)/g)) expect(["memberships", "profiles", "teams"]).toContain(t);
    // Every database call, table or RPC alike, lives behind the repository door.
    if (file !== "repository.ts") expect(read(file)).not.toMatch(/\.(from|rpc)\(/);
  }
  expect(read("repository.ts")).not.toMatch(/from "\.\/service"/); // layers depend inwards, never up
  for (const rpc of ["claim_username", "resolve_team_usernames"])
    expect(read("repository.ts")).toContain(`.rpc("${rpc}"`);
});

it("projects the username contract from the generated schema instead of restating it", () => {
  const source = readFileSync(`${MODULE_DIR}/types.ts`, "utf8");
  for (const [, name, definition] of source.matchAll(/^export type (\w+) = ([^;]+);$/gm))
    expect(`${name} = ${definition}`).toMatch(/Tables\["|Functions\["/);
  // The resolver's row shape is the database's, so a column added there arrives here for free.
  expect(source).toContain('Functions["resolve_team_usernames"]');
  expect(source).not.toMatch(/\binterface\b/); // a restated column set is a second source of truth
});
