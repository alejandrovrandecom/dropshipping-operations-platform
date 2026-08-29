// The only place the identity module reaches the database. It touches profiles, teams
// and memberships exclusively, and it authorises nothing: RLS is the wall, this is the door.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";
import type { Membership, Team } from "./types";

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
});
