// Launch domain types, projected from the generated database schema so this module never
// restates a column the migrations already own. When the schema changes, these follow it.
import type { Database } from "../../lib/database.types";

type Tables = Database["public"]["Tables"];
export type Launch = Tables["launches"]["Row"];
export type LaunchEvent = Tables["launch_events"]["Row"];
export type ChecklistTemplate = Tables["launch_checklist_templates"]["Row"];
export type ChecklistTemplateItem = Tables["launch_checklist_template_items"]["Row"];
export type Checklist = Tables["launch_checklists"]["Row"];
export type ChecklistItem = Tables["launch_checklist_items"]["Row"];
export type NewTemplateItem = Pick<Tables["launch_checklist_template_items"]["Insert"], "label" | "is_required" | "position">;
export type LaunchStatus = Database["public"]["Enums"]["launch_status"];
export type LaunchEventKind = Database["public"]["Enums"]["launch_event_kind"];
