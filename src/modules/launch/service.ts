// Launch use cases. Callers depend on the service, the service depends on the repository port,
// and only the repository touches the database. Every rule this module appears to honour --
// isolation, the closed transition set, activation eligibility -- is enforced by the database;
// the service only composes the calls and assembles what it reads back.
import { randomUUID } from "node:crypto";
import { createLaunchRepository, type LaunchClient } from "./repository";
import type {
  Checklist, ChecklistItem, ChecklistTemplate, ChecklistTemplateItem,
  Launch, LaunchEvent, LaunchStatus, NewTemplateItem,
} from "./types";

export type LaunchRepository = ReturnType<typeof createLaunchRepository>;
export type BoardLaunch = Launch & { checklist: (Checklist & { items: ChecklistItem[] }) | null };
export type TemplateWithItems = ChecklistTemplate & { items: ChecklistTemplateItem[] };

/** Pure: attaches each child to its parent, preserving the order both lists arrived in. */
const withItems = <P extends { id: string }, C>(parents: P[], children: C[], parentOf: (child: C) => string): Array<P & { items: C[] }> =>
  parents.map((parent) => ({ ...parent, items: children.filter((child) => parentOf(child) === parent.id) }));

export const createLaunchService = (repository: LaunchRepository) => ({
  /** Starts a launch. The id is the idempotency key, so a retry returns the same launch. */
  startLaunch: async (teamId: string, name: string, launchId: string = randomUUID()): Promise<Launch> =>
    repository.launchById(await repository.createLaunch(launchId, teamId, name)),
  moveLaunch: (launchId: string, next: LaunchStatus): Promise<LaunchStatus> =>
    repository.transitionLaunch(launchId, next),
  /** Returns a trashed launch to its exact pre-trash status. */
  restoreLaunch: (launchId: string): Promise<LaunchStatus> => repository.restoreLaunch(launchId),
  applyTemplate: (launchId: string, templateId: string): Promise<string> =>
    repository.applyChecklistTemplate(launchId, templateId),
  completeItem: (itemId: string, isComplete = true): Promise<ChecklistItem> =>
    repository.updateChecklistItem(itemId, isComplete),
  chooseDefaultTemplate: (teamId: string, templateId: string | null): Promise<string | null> =>
    repository.setDefaultChecklistTemplate(teamId, templateId),

  /** Defines a team template and its items in one use case, returning the template id. */
  defineTemplate: async (teamId: string, name: string, items: NewTemplateItem[]): Promise<string> => {
    const template = await repository.createTemplate(teamId, name);
    await repository.addTemplateItems(teamId, template.id, items);
    return template.id;
  },
  /**
   * Every launch the caller may see, each with its single snapshot and that snapshot's items.
   * Three team-wide reads are stitched in memory instead of one read per launch.
   */
  board: async (teamId: string): Promise<BoardLaunch[]> => {
    const [launches, checklists, items] = await Promise.all([
      repository.listLaunches(teamId), repository.listChecklists(teamId), repository.listChecklistItems(teamId)]);
    const snapshots = new Map(withItems(checklists, items, (item) => item.checklist_id)
      .map((snapshot) => [snapshot.launch_id, snapshot]));
    return launches.map((launch) => ({ ...launch, checklist: snapshots.get(launch.id) ?? null }));
  },
  templates: async (teamId: string): Promise<TemplateWithItems[]> =>
    withItems(await repository.listTemplates(teamId), await repository.listTemplateItems(teamId), (item) => item.template_id),
  /** The team's complete retained history, trashed launches included, in append order. */
  timeline: (teamId: string): Promise<LaunchEvent[]> => repository.listEvents(teamId),
});

export type LaunchService = ReturnType<typeof createLaunchService>;
export const launchServiceFor = (client: LaunchClient): LaunchService =>
  createLaunchService(createLaunchRepository(client));
