/**
 * Finding and opening the plugin's views in the workspace, in one place
 * instead of a `getLeavesOfType(...)[0].view as unknown as {...}` cast at
 * every call site. The view classes are imported as types only (no
 * runtime import, so no new import cycles); a leaf's view is recognised
 * by its getViewType().
 */

import type { View, Workspace, WorkspaceLeaf } from "obsidian";
import type { HexMapView } from "../hex-map/HexMapView";
import type { RandomTableView } from "../random-tables/RandomTableView";
import { VIEW_TYPE_HEX_MAP, VIEW_TYPE_RANDOM_TABLES } from "../constants";

/** The workspace calls these need (so tests can pass a fake). */
export type ViewWorkspace = Pick<Workspace, "getLeavesOfType" | "getLeaf" | "revealLeaf">;

function viewsOfType<T>(workspace: ViewWorkspace, type: string): T[] {
  return workspace
    .getLeavesOfType(type)
    .map((leaf) => leaf.view as View | undefined)
    .filter((v): v is View => !!v && v.getViewType() === type) as unknown as T[];
}

/** Every open hex map view, in workspace order. */
export function eachMapView(workspace: ViewWorkspace): HexMapView[] {
  return viewsOfType<HexMapView>(workspace, VIEW_TYPE_HEX_MAP);
}

/** The first open hex map view (the one other views act on), or null when no map is open. */
export function activeMapView(workspace: ViewWorkspace): HexMapView | null {
  return eachMapView(workspace)[0] ?? null;
}

export interface OpenInViewOptions {
  /** Always open a new tab (else the first open tables view is reused). */
  newTab?: boolean;
  /** Wait for the leaf to be revealed before showing the note. */
  awaitReveal?: boolean;
}

/**
 * Make the first tables view (or a new tab) the random tables view, reveal
 * it, then call `show` on its view right away (in the same turn as the
 * reveal call, unless awaitReveal).
 */
async function showInTablesView<T>(workspace: ViewWorkspace, opts: OpenInViewOptions, show: (view: RandomTableView) => T): Promise<T> {
  const leaves = opts.newTab ? [] : workspace.getLeavesOfType(VIEW_TYPE_RANDOM_TABLES);
  const leaf: WorkspaceLeaf = leaves.length > 0 ? leaves[0] : workspace.getLeaf("tab");
  await leaf.setViewState({ type: VIEW_TYPE_RANDOM_TABLES, active: true });
  if (opts.awaitReveal) await workspace.revealLeaf(leaf);
  else void workspace.revealLeaf(leaf);
  return show(leaf.view as unknown as RandomTableView);
}

/** Show a table note in the random tables view (Tables mode). */
export async function openTableInView(workspace: ViewWorkspace, path: string, opts: OpenInViewOptions = {}): Promise<void> {
  await showInTablesView(workspace, opts, (view) => view.openTable(path));
}

/** Show a workflow note in the random tables view (Workflows mode). */
export async function openWorkflowInView(workspace: ViewWorkspace, path: string, opts: OpenInViewOptions = {}): Promise<void> {
  await showInTablesView(workspace, opts, (view) => view.openWorkflow(path));
}
