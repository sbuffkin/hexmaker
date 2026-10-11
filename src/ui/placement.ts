/**
 * Where each control sits: the one declarative placement map (design rule 7,
 * "built to retool", in the self-paced-discovery UX notes).
 *
 * Every surface (settings tab, page, modal) is layered:
 *
 * - `main`     above the fold: the simple view that does the common job.
 * - `more`     below the fold: more specific options, still always shown.
 * - `advanced` inside the surface's collapsed "Advanced" dropdown.
 * - `advanced/<Sub-section>`
 *              inside a collapsible sub-section of that dropdown, e.g.
 *              `"advanced/Engine tuning"`. Sub-sections sit after the plain
 *              advanced controls, in the order a surface first uses them;
 *              each starts closed and its open state is remembered per
 *              surface on this device, like the dropdown's own
 *              (src/ui/disclosure.ts). The name is the heading users see,
 *              so write it as plain UI text.
 * - `debug`    in the "Debug" subsection inside Advanced, shown only while
 *              debug mode is on (src/ui/debugMode.ts).
 * - `hidden`   not rendered at all.
 *
 * Keys are UI item ids from the owner's UI inventory worksheet
 * (`<Surface>.<control>`, e.g. `Settings.hexGap`, `GenPage.clumping`,
 * `Plugin.cmd.checkTables`). An id that isn't listed is `main`, so this map
 * only names the exceptions. The worksheet's tiers map like this:
 * keep and simple = not listed (simple ones go first on the surface, keep
 * ones after them), advanced = `advanced` (or a sub-section), overkill =
 * `debug` (unless a note below says otherwise), drop = the control is
 * deleted from the code, so it has no entry either.
 *
 * Commands and menus: a command palette entry is only seen by someone
 * searching for it, so `advanced` commands stay registered; `debug`
 * commands are only offered while debug mode is on; `hidden` ones are not
 * registered (src/ui/commandPlacement.ts). In a right-click menu,
 * `advanced` items go in one submenu instead of the top level.
 *
 * Moving a control between layers is a one-line change here; no view code
 * changes. Views ask through Disclosure.place / Disclosure.target
 * (src/ui/disclosure.ts) or, in the settings tab, layoutDefinitions.
 */

export type Layer = "main" | "more" | "advanced" | "debug" | "hidden";

/** A layer, or a named sub-section of Advanced (`advanced/<Sub-section>`). */
export type Placement = Layer | `advanced/${string}`;

export const LAYERS: readonly Layer[] = ["main", "more", "advanced", "debug", "hidden"];

/** Prefix of an Advanced sub-section placement. */
const SUB_PREFIX = "advanced/";

export const PLACEMENT: Readonly<Record<string, Placement>> = {
  // ── Settings ──
  // The world folder and custom icons folder stay main (keep); the rest of
  // the folder layout is Advanced. Storage plumbing for overworlds and
  // space is Debug (owner: overkill).
  "Settings.templatePath": "advanced/Folders",
  // Overkill in the worksheet, but the README's manual setup uses it.
  "Settings.generateFolders": "advanced/Folders",
  "Settings.hexFolder": "advanced/Folders",
  "Settings.townsFolder": "advanced/Folders",
  "Settings.dungeonsFolder": "advanced/Folders",
  "Settings.questsFolder": "advanced/Folders",
  "Settings.featuresFolder": "advanced/Folders",
  "Settings.factionsFolder": "advanced/Folders",
  "Settings.regionsFolder": "advanced/Folders",
  "Settings.tablesFolder": "advanced/Folders",
  "Settings.workflowsFolder": "advanced/Folders",
  "Settings.templatesFolder": "advanced/Folders",
  "Settings.palettesFolder": "advanced/Folders",
  "Settings.biomesFolder": "debug",
  "Settings.biomePoolsFolder": "debug",
  "Settings.worldTypesFolder": "debug",
  // Overkill in the worksheet, but the README's manual setup uses it and
  // the "table not found" messages point here (repairHint.ts), so it sits
  // at the top of Advanced, not in a sub-section or Debug.
  "Settings.generateWorldData": "advanced",
  "Settings.defaultNewMapCols": "advanced/New map sizes",
  "Settings.defaultNewMapRows": "advanced/New map sizes",
  "Settings.defaultSubmapCols": "advanced/New map sizes",
  "Settings.defaultSubmapRows": "advanced/New map sizes",
  // Custom palettes are simple (owner's note): naming, editing, deleting
  // and adding stay main. Restoring the shipped ones and opening the raw
  // note are Advanced.
  "Settings.addDefaultPalettes": "advanced/Palettes",
  "Settings.paletteRowOpenNote": "advanced/Palettes",

  // ── Hex map view (menus and toolbars: Advanced ▸ / Debug ▸ submenus,
  // src/hex-map/placedMenu.ts; panels: an Advanced dropdown) ──
  "WorkModeMenu.god": "advanced",
  "ModeBar.crossImpassable": "advanced",
  "DrawingPanel.linkTable": "advanced",
  "DrawingPanel.linkSubmap": "advanced",
  "DrawingPanel.regionAreas": "advanced",
  "MapView.tableLinkToolPicker": "advanced",
  "PathMenu.splitHere": "advanced",
  "PathMenu.reverse": "advanced",
  "LayersMenu.regionOverlay": "advanced",
  // Dropped (the code is gone; listed so the inventory stays complete).
  "PainterMenu.newPath": "hidden",
  "MapView.dblRightClickExit": "hidden",
  "MapView.dblClickOffGridExit": "hidden",

  // ── Hex editor: a section's table source is Advanced ──
  "HexEditor.weatherSource": "advanced",
  "HexEditor.hooksSource": "advanced",
  "HexEditor.rolledSetMapTable": "advanced",
  "HexEditor.rolledSetHexTable": "advanced",

  // ── Hex table ──
  "HexTable.refresh": "debug",
  "HexTable.xMin": "advanced",
  "HexTable.xMax": "advanced",
  "HexTable.yMin": "advanced",
  "HexTable.yMax": "advanced",
  "TerrainFilter.typeRow": "advanced",

  // ── Map pickers and editors ──
  "Token.description": "advanced",
  "PathPicker.pathsOnMap": "advanced",
  "PathType.carves": "advanced",
  "PathType.carveWidth": "debug",
  "TerrainPicker.refreshEncounterLinks": "debug",
  "Locations.openButton": "hidden",

  // ── Setup wizard ──
  "Wizard.configureFoldersIndividually": "advanced",
  "Wizard.genOptWater": "advanced",
  "Wizard.genOptClimate": "advanced",
  "Wizard.genOptRelief": "advanced",
  "Wizard.genOptSea": "advanced",
  "Wizard.genOptOther": "advanced",

  // ── Commands & menus ──
  "Plugin.cmd.addRollRanges": "debug",
  "Plugin.cmd.checkTables": "debug",
  "Plugin.cmd.addMapDataToHexNotes": "debug",
  "Plugin.cmd.updateRegionFactionMapData": "debug",
  "Plugin.cmd.exportNotePdf": "advanced",
  "Plugin.cmd.exportNoteMarkdown": "advanced",
  "Plugin.cmd.exportCurrentWorkflow": "advanced",
  "Plugin.fileMenuExportPdf": "advanced",
  "Plugin.fileMenuExportMarkdown": "advanced",

  // ── Generator page ──
  // Owner: the generator's overkill controls go in the page's own Advanced
  // dropdown (closed by default) in tidy sub-sections, not behind debug
  // mode, so anyone can open them for one generator. Nothing on this page
  // is Debug.
  "GenPage.clumping": "advanced/Engine tuning",
  "GenPage.edgeSmoothing": "advanced/Engine tuning",
  "GenPage.removeSmallPatches": "advanced/Engine tuning",
  "GenPage.keepRare": "advanced/Engine tuning",
  "GenPage.edgeStrength": "advanced/Engine tuning",
  "GenPage.directionalBias": "advanced/Engine tuning",
  "GenPage.scatter": "advanced/Engine tuning",
  "GenPage.spacing": "advanced/Engine tuning",
  "GenPage.randomness": "advanced/Engine tuning",
  "GenPage.near": "advanced/Engine tuning",
  "GenPage.mixStrength": "advanced/Engine tuning",
  // Single routes: each path type's route list (its fold) carries the
  // route controls with it.
  "GenPage.pathTypeFold": "advanced/Paths",
  "GenPage.pathTypeAvoid": "advanced/Paths",
  "GenPage.routeOn": "advanced/Paths",
  "GenPage.routeCount": "advanced/Paths",
  "GenPage.routeAs": "advanced/Paths",
  "GenPage.routeWiggle": "advanced/Paths",
  "GenPage.routeLength": "advanced/Paths",
  "GenPage.routeFollow": "advanced/Paths",
  // The seed is saved with every save and shown in the saves list; Re-roll
  // stays by the preview.
  "GenPage.seed": "advanced/Seed",
  "GenPage.seedLock": "advanced/Seed",
  "BiomePage.seed": "advanced/Seed",
};

/** Read a placement value: its layer and, for `advanced/<Sub>`, the sub-section. Null when it isn't one. */
export function parsePlacement(value: unknown): { layer: Layer; sub?: string } | null {
  if (typeof value !== "string") return null;
  if (value.startsWith(SUB_PREFIX)) {
    const sub = value.slice(SUB_PREFIX.length).trim();
    return sub ? { layer: "advanced", sub } : { layer: "advanced" };
  }
  return LAYERS.includes(value as Layer) ? { layer: value as Layer } : null;
}

function lookup(id: string, map: Readonly<Record<string, Placement>>): { layer: Layer; sub?: string } {
  const value = Object.prototype.hasOwnProperty.call(map, id) ? map[id] : undefined;
  return parsePlacement(value) ?? { layer: "main" };
}

/** The layer of control `id` (unlisted = `main`; `advanced/<Sub>` = `advanced`). */
export function layerOf(id: string, map: Readonly<Record<string, Placement>> = PLACEMENT): Layer {
  return lookup(id, map).layer;
}

/** The Advanced sub-section control `id` goes in, if any. */
export function subSectionOf(id: string, map: Readonly<Record<string, Placement>> = PLACEMENT): string | undefined {
  return lookup(id, map).sub;
}

/** Is control `id` shown at all right now (hidden never; debug only in debug mode). */
export function isShown(id: string, debugMode: boolean, map: Readonly<Record<string, Placement>> = PLACEMENT): boolean {
  const layer = layerOf(id, map);
  return layer !== "hidden" && (layer !== "debug" || debugMode);
}

/** Every listed id on `layer` (Advanced includes its sub-sections), in map order (for tests and inventories). */
export function idsOn(layer: Layer, map: Readonly<Record<string, Placement>> = PLACEMENT): string[] {
  return Object.keys(map).filter((id) => layerOf(id, map) === layer);
}

/**
 * Group tagged items by layer, keeping their order within each: what a
 * surface draws above the fold (`main` then `more`), in its Advanced
 * dropdown (sub-sections included), and in Debug. Hidden items, and Debug
 * ones while debug mode is off, are left out.
 */
export function partition<T>(
  items: { id: string; item: T }[],
  debugMode: boolean,
  map: Readonly<Record<string, Placement>> = PLACEMENT,
): { main: T[]; more: T[]; advanced: T[]; debug: T[] } {
  const out = { main: [] as T[], more: [] as T[], advanced: [] as T[], debug: [] as T[] };
  for (const { id, item } of items) {
    const layer = layerOf(id, map);
    if (layer === "hidden" || (layer === "debug" && !debugMode)) continue;
    out[layer].push(item);
  }
  return out;
}

/**
 * partition, with Advanced split into its plain controls and its
 * sub-sections (each named once, in the order first used).
 */
export function partitionSections<T>(
  items: { id: string; item: T }[],
  debugMode: boolean,
  map: Readonly<Record<string, Placement>> = PLACEMENT,
): { main: T[]; more: T[]; advanced: T[]; subs: { name: string; items: T[] }[]; debug: T[] } {
  const out = { main: [] as T[], more: [] as T[], advanced: [] as T[], subs: [] as { name: string; items: T[] }[], debug: [] as T[] };
  for (const { id, item } of items) {
    const { layer, sub } = lookup(id, map);
    if (layer === "hidden" || (layer === "debug" && !debugMode)) continue;
    if (layer === "advanced" && sub) {
      let group = out.subs.find((s) => s.name === sub);
      if (!group) out.subs.push((group = { name: sub, items: [] }));
      group.items.push(item);
    } else out[layer].push(item);
  }
  return out;
}
