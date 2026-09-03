// The only place the identity module reaches the database. It touches profiles, teams
// and memberships exclusively, and it authorises nothing: RLS is the wall, this is the door.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";
import type {
  AccountDeletionState, Membership, Team, TeamUsername, TransferId, TransferredTeamId, Username,
} from "./types";

export type IdentityClient = SupabaseClient<Database>;
const ok = <T>(result: { data: T | null; error: { message: string } | null }, action: string): T => {
  if (result.error) throw new Error(`identity: ${action} failed: ${result.error.message}`);
  return result.data as T;
};
export const createIdentityRepository = (client: IdentityClient) => ({
  listTeams: async (): Promise<Team[]> =>
    ok(await client.from("teams").select("*").order("created_at"), "list teams"),
  /** The database sets the owner column; the client is never granted it. */
  createTeam: async (name: string): Promise<Team> =>
    ok(await client.from("teams").insert({ name }).select("*").single(), "create team"),
  listMembers: async (teamId: string): Promise<Membership[]> =>
    ok(await client.from("memberships").select("*").eq("team_id", teamId), "list members"),
  /** The registry holds no grant at all, so this definer RPC is the only path that writes it. */
  claimUsername: async (username: string): Promise<Username> =>
    ok(await client.rpc("claim_username", { p_username: username }), "claim username"),
  /** Scoped by the caller's own membership: a non-member reads an empty set, never a refusal. */
  resolveTeamUsernames: async (teamId: string): Promise<TeamUsername[]> =>
    ok(await client.rpc("resolve_team_usernames", { p_team_id: teamId }), "resolve team usernames"),
  /** The offer names one current member; the transfer table itself is granted to nobody. */
  requestTeamOwnershipTransfer: async (teamId: string, toUserId: string): Promise<TransferId> =>
    ok(await client.rpc("request_team_ownership_transfer", { p_team_id: teamId, p_to_user_id: toUserId }),
      "request ownership transfer"),
  acceptTeamOwnershipTransfer: async (transferId: string): Promise<TransferredTeamId> =>
    ok(await client.rpc("accept_team_ownership_transfer", { p_transfer_id: transferId }), "accept ownership transfer"),
  /** Records intent only. The privileged claim, finalizer and status read are never wrapped here. */
  requestAccountDeletion: async (deleteTeamIds: string[]): Promise<AccountDeletionState> =>
    ok(await client.rpc("request_account_deletion", { p_delete_team_ids: deleteTeamIds }), "request account deletion"),
});
