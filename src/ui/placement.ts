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

  // ── Owner worksheet 2026-10-11 (dev/ui-inventory/inputs-tags-resolved.json):
  // maps, new maps, regions/overworlds/biomes, world types, palette editor,
  // random tables, workflows, export. simple = main, advanced = advanced,
  // overkill = debug; dropped controls were removed from the code. ──
  // Maps modal › Maps list
  "MapModal.mapRowContextGenerator": "advanced",
  "MapModal.mapRowContextMakeGenerator": "advanced",
  // Maps modal › Properties
  "MapProps.sectionTablePicker": "advanced",
  "MapModal.propsFolderName": "debug",
  "MapModal.propsRenameFolder": "debug",
  "MapModal.propsStagger": "main",
  "MapModal.propsTerrainTheme": "advanced",
  "MapModal.propsDelete": "main",
  "MapModal.propsDeleteConfirm": "main",
  // Maps modal › Weather & rumours
  "MapModal.propsWeatherTable": "advanced",
  "MapModal.propsWeatherClear": "advanced",
  "MapModal.propsRumoursTable": "advanced",
  "MapModal.propsRumoursClear": "advanced",
  // Maps modal › Background image
  "MapProps.backgroundImagePicker": "advanced",
  // New maps & map links › New map form
  "NewMap.rememberPalette": "advanced",
  "NewMap.rememberSize": "advanced",
  "NewMap.rememberGenerator": "advanced",
  "NewMap.rememberBase": "advanced",
  // New maps & map links › New map form: More
  "NewMapSetup.backgroundImagePicker": "advanced",
  "NewMap.folderName": "debug",
  "NewMap.startCoords": "advanced",
  "NewMap.stagger": "main",
  "NewMap.bgPick": "advanced",
  "NewMap.bgClear": "advanced",
  // New maps & map links › Generator options (world)
  "NewMap.overlandWater": "advanced",
  "NewMap.overlandClimate": "advanced",
  "NewMap.overlandRelief": "advanced",
  "NewMap.overlandSea": "advanced",
  "NewMap.planetRelief": "advanced",
  "NewMap.regionDetailInfluence": "advanced",
  "NewMap.regionDetailVariety": "advanced",
  // New maps & map links › Generator options (space)
  "NewMap.starRouteType": "advanced",
  "NewMap.orbitsPathType": "advanced",
  // New maps & map links › New land beside a map
  "WalkOW.seed": "debug",
  // Regions, overworlds & biomes › New overworld
  "NewOverworld.seed": "debug",
  // Regions, overworlds & biomes › Biome library & biome form
  "BiomeForm.chance": "debug",
  // Regions, overworlds & biomes › Biome picker & paint
  "BiomePicker.enterRegion": "main",
  // Regions, overworlds & biomes › Region settings
  "RegionGen.wigglyBorders": "debug",
  "RegionGen.seed": "debug",
  // Regions, overworlds & biomes › Edit region
  "EditRegion.name": "main",
  "EditRegion.enterRegion": "main",
  "EditRegion.openMapNote": "main",
  "EditRegion.locationsList": "main",
  "EditRegion.notes": "main",
  // Space: world types › Worlds tab
  "WorldTypes.worldGenerator": "debug",
  "WorldTypes.worldOptions": "debug",
  // Space: world types › Preview
  "WorldTypes.previewMap": "debug",
  "WorldTypes.previewOrbit": "debug",
  "WorldTypes.previewStar": "debug",
  "WorldTypes.previewTemperature": "debug",
  "WorldTypes.previewRolls": "debug",
  // Palette editor › Submap defaults
  "PaletteEditor.generatorOptions": "debug",
  // Random tables › Tables list
  "RTView.refreshList": "debug",
  "RTView.tablesTree": "main",
  "RTView.folderMenuRollPicker": "advanced",
  "RTView.folderMenuEncounters": "advanced",
  "RTView.fileMenuRollPicker": "advanced",
  "RTView.fileMenuEncounters": "advanced",
  "RTView.generateFromFolder": "advanced",
  // Random tables › Table detail
  "RTView.refreshLinked": "debug",
  "RTView.copyRollLink": "advanced",
  "RTView.roll": "main",
  // Random tables › Rolling
  "RollModal.roll": "main",
  "RollerBlock.roll": "main",
  // Random tables › Table editor
  "TableEditor.minusOneAll": "advanced",
  "TableEditor.plusOneAll": "advanced",
  "TableEditor.import": "advanced",
  "TableEditor.linkedFolder": "advanced",
  "TableEditor.excludeRollPicker": "advanced",
  "TableEditor.excludeEncounters": "advanced",
  // Export › Map export
  "MapExport.boldPaths": "main",
  "MapExport.showLinkBadges": "main",
  "MapExport.showFactionOverlay": "main",
  "MapExport.showRegionOverlay": "advanced",
  "MapExport.pdfColumnsFold": "main",
  "MapExport.exportPng": "main",
  "MapExport.exportPdf": "main",
  "MapExport.exportManual": "main",
  // Export › Map export: Hexcrawl manual
  "MapExport.playerEdition": "main",
  "MapExport.manualPartLegend": "main",
  "MapExport.manualPartTables": "main",
  "MapExport.manualPartFactions": "main",
  "MapExport.manualPartIndex": "main",
  // Export › Hex export
  "HexExport.exportMarkdown": "main",
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
