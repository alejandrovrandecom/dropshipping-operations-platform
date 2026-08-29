// Identity domain types, projected from the generated database schema so this
// module never restates a column that the migrations already own.
import type { Database } from "../../lib/database.types";

type Tables = Database["public"]["Tables"];
export type Profile = Tables["profiles"]["Row"];
export type Team = Tables["teams"]["Row"];
export type Membership = Tables["memberships"]["Row"];
