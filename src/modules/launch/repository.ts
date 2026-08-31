// The only place the launch module reaches the database. It touches the six launch tables and
// the five launch RPCs exclusively, and it authorises nothing: RLS and the definer bodies are the
// wall, this is the door. State, history and snapshots move only through the RPCs, because no
// client grant exists to write them directly.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/database.types";
import type {
  Checklist, ChecklistItem, ChecklistTemplate, ChecklistTemplateItem,
  Launch, LaunchEvent, LaunchStatus, NewTemplateItem,
} from "./types";

export type LaunchClient = SupabaseClient<Database>;

const ok = <T>(result: { data: T | null; error: { message: string } | null }, action: string): T => {
  if (result.error) throw new Error(`launch: ${action} failed: ${result.error.message}`);
  return result.data as T;
};

export const createLaunchRepository = (client: LaunchClient) => ({
  /** The caller supplies the id, so a retry names the same launch instead of creating a second one. */
  createLaunch: async (launchId: string, teamId: string, name: string): Promise<string> =>
    ok(await client.rpc("create_launch", { p_launch_id: launchId, p_team_id: teamId, p_name: name }), "create launch"),
  transitionLaunch: async (launchId: string, next: LaunchStatus): Promise<LaunchStatus> =>
    ok(await client.rpc("transition_launch", { p_launch_id: launchId, p_next: next }), "transition launch"),
  restoreLaunch: async (launchId: string): Promise<LaunchStatus> =>
    ok(await client.rpc("restore_launch", { p_launch_id: launchId }), "restore launch"),
  applyChecklistTemplate: async (launchId: string, templateId: string): Promise<string> =>
    ok(await client.rpc("apply_checklist_template", { p_launch_id: launchId, p_template_id: templateId }), "apply template"),
  /**
   * A null template clears the team default; the RPC demotes and promotes atomically.
   * The generated argument type is not nullable, so the accepted null is asserted here rather
   * than hand-editing the generated file, which the migrations own.
   */
  setDefaultChecklistTemplate: async (teamId: string, templateId: string | null): Promise<string | null> =>
    ok(await client.rpc("set_default_checklist_template",
      { p_team_id: teamId, p_template_id: templateId as string }), "set default template"),

  launchById: async (launchId: string): Promise<Launch> =>
    ok(await client.from("launches").select("*").eq("id", launchId).single(), "read launch"),
  /** Creation time first, id as the tiebreak, so equal instants still return one stable order. */
  listLaunches: async (teamId: string): Promise<Launch[]> =>
    ok(await client.from("launches").select("*").eq("team_id", teamId).order("created_at").order("id"), "list launches"),
  listEvents: async (teamId: string): Promise<LaunchEvent[]> =>
    ok(await client.from("launch_events").select("*").eq("team_id", teamId).order("seq"), "list history"),
  listChecklists: async (teamId: string): Promise<Checklist[]> =>
    ok(await client.from("launch_checklists").select("*").eq("team_id", teamId), "list checklists"),
  listChecklistItems: async (teamId: string): Promise<ChecklistItem[]> =>
    ok(await client.from("launch_checklist_items").select("*").eq("team_id", teamId).order("position").order("id"),
      "list checklist items"),
  updateChecklistItem: async (itemId: string, isComplete: boolean): Promise<ChecklistItem> =>
    ok(await client.from("launch_checklist_items").update({ is_complete: isComplete }).eq("id", itemId).select("*").single(),
      "update checklist item"),

  /** `is_default` is never granted: only the atomic setter above may designate a default. */
  createTemplate: async (teamId: string, name: string): Promise<ChecklistTemplate> =>
    ok(await client.from("launch_checklist_templates").insert({ team_id: teamId, name }).select("*").single(), "create template"),
  addTemplateItems: async (teamId: string, templateId: string, items: NewTemplateItem[]): Promise<ChecklistTemplateItem[]> =>
    items.length === 0 ? [] : ok(await client.from("launch_checklist_template_items")
      .insert(items.map((item) => ({ ...item, team_id: teamId, template_id: templateId }))).select("*"), "add template items"),
  listTemplates: async (teamId: string): Promise<ChecklistTemplate[]> =>
    ok(await client.from("launch_checklist_templates").select("*").eq("team_id", teamId).order("created_at").order("id"),
      "list templates"),
  listTemplateItems: async (teamId: string): Promise<ChecklistTemplateItem[]> =>
    ok(await client.from("launch_checklist_template_items").select("*").eq("team_id", teamId).order("position").order("id"),
      "list template items"),
});
