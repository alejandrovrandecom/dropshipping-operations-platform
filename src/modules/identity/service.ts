// Identity use cases. Callers depend on the service, the service depends on the
// repository port, and only the repository is allowed to touch the database.
import { createIdentityRepository, type IdentityClient } from "./repository";
import type { Membership, Team, TeamUsername, Username } from "./types";

export type IdentityRepository = ReturnType<typeof createIdentityRepository>;
export const createIdentityService = (repository: IdentityRepository) => ({
  /** Every team the caller belongs to, each with its members already resolved. */
  workspace: async (): Promise<Array<Team & { members: Membership[] }>> =>
    Promise.all((await repository.listTeams()).map(async (t) => ({ ...t, members: await repository.listMembers(t.id) }))),
  /** Starts a team; the database makes the creator its owner and first member. */
  startTeam: (name: string): Promise<Team> => repository.createTeam(name),
  /** The account's one permanent claim, and the only protected write the onboarding gate allows. */
  claimUsername: (username: string): Promise<Username> => repository.claimUsername(username),
  /** The claimed names of a team the caller shares; anyone else reads an empty list. */
  resolveTeamUsernames: (teamId: string): Promise<TeamUsername[]> => repository.resolveTeamUsernames(teamId),
});
export const identityServiceFor = (client: IdentityClient) => createIdentityService(createIdentityRepository(client));
