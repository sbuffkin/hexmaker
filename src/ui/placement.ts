/**
 * Where each control sits: the one declarative placement map (design rule 7,
 * "built to retool", in the self-paced-discovery UX notes).
 *
 * Every surface (settings tab, page, modal) is layered:
 *
 * - `main`     above the fold: the simple view that does the common job.
 * - `more`     below the fold: more specific options, still always shown.
 * - `advanced` inside the surface's collapsed "Advanced" dropdown.
 * - `debug`    in the "Debug" subsection inside Advanced, shown only while
 *              debug mode is on (src/ui/debugMode.ts).
 * - `hidden`   dropped: not rendered at all.
 *
 * Keys are UI item ids from the owner's UI inventory worksheet
 * (`<Surface>.<control>`, e.g. `Settings.hexGap`, `GenPage.clumping`). An id
 * that isn't listed is `main`, so this map only names the exceptions.
 *
 * Moving a control between layers is a one-line change here; no view code
 * changes. Views ask through Disclosure.place / Disclosure.target
 * (src/ui/disclosure.ts) or, in the settings tab, layoutSettings.
 */

export type Layer = "main" | "more" | "advanced" | "debug" | "hidden";

export const LAYERS: readonly Layer[] = ["main", "more", "advanced", "debug", "hidden"];

export const PLACEMENT: Readonly<Record<string, Layer>> = {
  // ── Settings: folder layout is Advanced (the custom icons folder stays
  // main: customisation is not "advanced", rule 5); maintenance is Debug ──
  "Settings.worldFolder": "advanced",
  "Settings.hexFolder": "advanced",
  "Settings.townsFolder": "advanced",
  "Settings.dungeonsFolder": "advanced",
  "Settings.questsFolder": "advanced",
  "Settings.featuresFolder": "advanced",
  "Settings.factionsFolder": "advanced",
  "Settings.regionsFolder": "advanced",
  "Settings.tablesFolder": "advanced",
  "Settings.workflowsFolder": "advanced",
  "Settings.templatesFolder": "advanced",
  "Settings.palettesFolder": "advanced",
  "Settings.biomesFolder": "debug",
  "Settings.biomePoolsFolder": "debug",
  "Settings.worldTypesFolder": "debug",
  "Settings.generateFolders": "advanced",
  "Settings.generateWorldData": "advanced",

  // ── Generator page: recipe extras are Advanced ──
  "GenPage.symmetry": "advanced",
  "GenPage.edgeStyle": "advanced",
  "GenPage.guaranteedFeatures": "advanced",
  "GenPage.connectedLand": "advanced",

  // ── Generator page: engine tuning is Debug ──
  "GenPage.clumping": "debug",
  "GenPage.edgeSmoothing": "debug",
  "GenPage.removeSmallPatches": "debug",
  "GenPage.keepRare": "debug",
  "GenPage.edgeStrength": "debug",
  "GenPage.directionalBias": "debug",
  "GenPage.scatter": "debug",
  "GenPage.spacing": "debug",
  "GenPage.randomness": "debug",
  "GenPage.mixStrength": "debug",

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
};

/** The layer of control `id` (unlisted = `main`). */
export function layerOf(id: string, map: Readonly<Record<string, Layer>> = PLACEMENT): Layer {
  const layer = Object.prototype.hasOwnProperty.call(map, id) ? map[id] : undefined;
  return layer && LAYERS.includes(layer) ? layer : "main";
}

/** Is control `id` shown at all right now (hidden never; debug only in debug mode). */
export function isShown(id: string, debugMode: boolean, map: Readonly<Record<string, Layer>> = PLACEMENT): boolean {
  const layer = layerOf(id, map);
  return layer !== "hidden" && (layer !== "debug" || debugMode);
}

/** Every listed id on `layer`, in map order (for tests and inventories). */
export function idsOn(layer: Layer, map: Readonly<Record<string, Layer>> = PLACEMENT): string[] {
  return Object.keys(map).filter((id) => map[id] === layer);
}

/**
 * Group tagged items by layer, keeping their order within each: what a
 * surface draws above the fold (`main` then `more`), in its Advanced
 * dropdown, and in Debug. Hidden items, and Debug ones while debug mode
 * is off, are left out.
 */
export function partition<T>(
  items: { id: string; item: T }[],
  debugMode: boolean,
  map: Readonly<Record<string, Layer>> = PLACEMENT,
): { main: T[]; more: T[]; advanced: T[]; debug: T[] } {
  const out = { main: [] as T[], more: [] as T[], advanced: [] as T[], debug: [] as T[] };
  for (const { id, item } of items) {
    const layer = layerOf(id, map);
    if (layer === "hidden" || (layer === "debug" && !debugMode)) continue;
    out[layer].push(item);
  }
  return out;
}
