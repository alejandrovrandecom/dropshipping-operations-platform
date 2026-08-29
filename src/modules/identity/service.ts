// Identity use cases. Callers depend on the service, the service depends on the
// repository port, and only the repository is allowed to touch the database.
import { createIdentityRepository, type IdentityClient } from "./repository";
import type { Membership, Team } from "./types";

export type IdentityRepository = ReturnType<typeof createIdentityRepository>;
export const createIdentityService = (repository: IdentityRepository) => ({
  /** Every team the caller belongs to, each with its members already resolved. */
  workspace: async (): Promise<Array<Team & { members: Membership[] }>> =>
    Promise.all((await repository.listTeams()).map(async (t) => ({ ...t, members: await repository.listMembers(t.id) }))),
  /** Starts a team; the database makes the creator its owner and first member. */
  startTeam: (name: string): Promise<Team> => repository.createTeam(name),
});
export const identityServiceFor = (client: IdentityClient) => createIdentityService(createIdentityRepository(client));
