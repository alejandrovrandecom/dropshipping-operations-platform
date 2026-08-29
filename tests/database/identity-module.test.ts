// Contract proof for the identity module: it works against a database built only from
// migrations, it reaches no table outside its own domain, and its layers depend inwards --
// callers on the service, the service on the repository, the repository alone on the database.
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import type { IdentityClient } from "../../src/modules/identity/repository";
import { identityServiceFor } from "../../src/modules/identity/service";
import { signIn, uniqueEmail } from "../support/local-stack";

const MODULE_DIR = "src/modules/identity";

it("starts a team and reads the workspace through the service", async () => {
  const { client, userId } = await signIn(uniqueEmail("module"));
  const service = identityServiceFor(client as unknown as IdentityClient);
  const team = await service.startTeam("Module team");
  expect(team.owner_user_id).toBe(userId);
  const workspace = await service.workspace();
  expect(workspace.map((row) => row.id)).toContain(team.id);
  expect(workspace.find((row) => row.id === team.id)?.members.map((m) => m.user_id)).toEqual([userId]);
});

it("keeps the module boundary and its dependency direction", () => {
  const read = (file: string) => readFileSync(`${MODULE_DIR}/${file}`, "utf8");
  expect(readdirSync(MODULE_DIR).sort()).toEqual(["repository.ts", "service.ts", "types.ts"]);
  for (const file of readdirSync(MODULE_DIR))
    for (const [, t] of read(file).matchAll(/\.from\("([a-z_]+)"\)/g)) expect(["memberships", "profiles", "teams"]).toContain(t);
  expect(read("repository.ts")).not.toMatch(/from "\.\/service"/); // layers depend inwards, never up
  expect(read("service.ts")).not.toMatch(/\.from\(/); // the service never reaches the database itself
});
