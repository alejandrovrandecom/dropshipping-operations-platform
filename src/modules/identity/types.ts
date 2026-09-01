// Identity domain types, projected from the generated database schema so this
// module never restates a column that the migrations already own.
import type { Database } from "../../lib/database.types";

type Tables = Database["public"]["Tables"];
type Functions = Database["public"]["Functions"];
export type Profile = Tables["profiles"]["Row"];
export type Team = Tables["teams"]["Row"];
export type Membership = Tables["memberships"]["Row"];
/** The claim's answer is the stored name, which the database normalizes; the registry itself is unreadable. */
export type Username = Functions["claim_username"]["Returns"];
export type TeamUsername = Functions["resolve_team_usernames"]["Returns"][number];
