/**
 * Work modes, per map (owner round 4, WM1–WM6): Play · Build · God.
 *
 * Stored readably in the map note (`mode: build`); a map opens in the mode
 * saved with it, default Build.
 *
 * The one rule: Play may change what a GM changes during a game (tokens,
 * note text, rolls, view toggles) but no MAP DATA (terrain, icons, region
 * areas, paths, links to other maps, the map's size or properties). Build
 * adds and edits map content. God may do everything, including reshaping
 * what's placed (biome swaps, rerolls, regenerating), swapping hexes,
 * shrinking and deleting maps.
 *
 * Never locked: note text (WM2), settings and palettes (WM4).
 *
 * Arrival (GM4, plan-tables-everywhere phase 4): when a world is set to
 * make places on arrival, Play may make a place where nothing exists yet
 * (`discover`): it only fills in an unknown hex and adds a new map, never
 * reshapes what's there. The new place can be rerolled in any mode until
 * someone locks it; after that rerolling it is God's (canRerollPlace).
 *
 * ACTION_POLICY is the classification of every user action;
 * TOOL_ACTIONS / COMMAND_ACTIONS / MENU_ACTIONS map each drawing tool,
 * command and map-view menu item onto it. tests/workModeCoverage.test.ts
 * fails when one isn't classified. The data layer refuses locked writes
 * (src/modeGate.ts → MapStore.set, the path gate), and the UI asks the
 * same table to hide or disable.
 *
 * Pure: no Obsidian imports.
 */
import type { DrawingMode } from "./hex-map/toolMode";

export type WorkMode = "play" | "build" | "god";

export const WORK_MODES: readonly WorkMode[] = ["play", "build", "god"];

export const DEFAULT_WORK_MODE: WorkMode = "build";

export const WORK_MODE_TEXT: Record<WorkMode, { label: string; desc: string }> = {
  play: { label: "Play", desc: "Run a game: move tokens, read and write notes, roll. The map itself stays as it is." },
  build: { label: "Build", desc: "Add to and edit the map: paint, draw paths, make maps and regions." },
  god: { label: "God", desc: "Change anything, including placed biomes, rerolls, regenerating, swapping hexes and deleting." },
};

/**
 * Every kind of user action. One id per row of the plan's feature inventory
 * (plan-work-modes §1), grouped by who may do it.
 */
export type ModeAction =
  // ── every mode (what a GM does during a game) ──
  | "view" // pan, zoom, layers, GM layer, legend, help, open views
  | "navigate" // change maps, enter regions, center a hex
  | "open-editor" // open the hex editor / region editor (its writes are gated one by one)
  | "open-note" // open (or create) a hex note
  | "edit-note" // note text: sections, link sections, a hex's name, map data callouts
  | "link-note" // the Link table / Factions tools: wiki-links written into hex notes
  | "roll" // random tables and workflows (result notes are new files)
  | "token" // place, move, edit, hide, remove tokens
  | "export" // PDF / Markdown / PNG exports (new files only)
  | "tables" // random table files: ranges, checks (not map data)
  | "settings" // plugin settings and palettes: never locked (WM4)
  | "switch-mode" // the mode switch itself
  | "new-top-map" // a new map that isn't made from a hex of another map
  | "discover" // arrival: make a place where nothing exists yet (only when the world is set to make places)
  | "lock-place" // lock a place made on arrival (after that, rerolling it needs God)
  // ── Build and God ──
  | "paint-terrain"
  | "paint-icon" // icon overrides and GM icons
  | "paint-region-area" // the Region areas tool (geo-region overlay)
  | "link-map" // link / unlink / reorder a hex's maps
  | "edit-path"
  | "grow-map" // the "+" expand buttons
  | "new-child-map" // new map / region / new land from a hex or a side
  | "map-properties" // rename, palette, stagger, background, map tables
  | "place-biome" // first biome on an empty overworld hex
  | "edit-biomes" // biome library, world types
  // ── God only ──
  | "reshape" // swap a placed biome, reroll, regenerate, region settings after lock
  | "swap-hexes"
  | "shrink-map"
  | "delete-map";

interface ActionPolicy {
  /** Modes that allow it. */
  modes: readonly WorkMode[];
  /** "Switch to Build to <verb>." */
  verb: string;
}

const ALL: readonly WorkMode[] = ["play", "build", "god"];
const BUILD: readonly WorkMode[] = ["build", "god"];
const GOD: readonly WorkMode[] = ["god"];

/** THE classification: which modes allow each action. */
export const ACTION_POLICY: Record<ModeAction, ActionPolicy> = {
  view: { modes: ALL, verb: "look around" },
  navigate: { modes: ALL, verb: "move around" },
  "open-editor": { modes: ALL, verb: "open the editor" },
  "open-note": { modes: ALL, verb: "open notes" },
  "edit-note": { modes: ALL, verb: "edit notes" },
  "link-note": { modes: ALL, verb: "link notes" },
  roll: { modes: ALL, verb: "roll" },
  token: { modes: ALL, verb: "move tokens" },
  export: { modes: ALL, verb: "export" },
  tables: { modes: ALL, verb: "edit tables" },
  settings: { modes: ALL, verb: "change settings" },
  "switch-mode": { modes: ALL, verb: "switch modes" },
  "new-top-map": { modes: ALL, verb: "make a map" },
  discover: { modes: ALL, verb: "go somewhere new" },
  "lock-place": { modes: ALL, verb: "lock a new place" },
  "paint-terrain": { modes: BUILD, verb: "paint terrain" },
  "paint-icon": { modes: BUILD, verb: "change icons" },
  "paint-region-area": { modes: BUILD, verb: "paint region areas" },
  "link-map": { modes: BUILD, verb: "link maps to hexes" },
  "edit-path": { modes: BUILD, verb: "change paths" },
  "grow-map": { modes: BUILD, verb: "grow the map" },
  "new-child-map": { modes: BUILD, verb: "make a map or region here" },
  "map-properties": { modes: BUILD, verb: "change the map's properties" },
  "place-biome": { modes: BUILD, verb: "place a biome" },
  "edit-biomes": { modes: BUILD, verb: "edit biomes" },
  reshape: { modes: GOD, verb: "change a placed biome" },
  "swap-hexes": { modes: GOD, verb: "swap hexes" },
  "shrink-map": { modes: GOD, verb: "shrink the map" },
  "delete-map": { modes: GOD, verb: "delete the map" },
};

export const MODE_ACTIONS = Object.keys(ACTION_POLICY) as ModeAction[];

/** May `action` be done in `mode`? */
export function allows(mode: WorkMode, action: ModeAction): boolean {
  return ACTION_POLICY[action].modes.includes(mode);
}

/** The lowest mode that allows `action` (Play < Build < God). */
export function modeFor(action: ModeAction): WorkMode {
  return WORK_MODES.find((m) => allows(m, action)) ?? "god";
}

/** "Switch to Build to paint terrain." */
export function lockedHint(action: ModeAction): string {
  return `Switch to ${WORK_MODE_TEXT[modeFor(action)].label} to ${ACTION_POLICY[action].verb}.`;
}

/**
 * God is in the mode switch's Advanced ▸ submenu (owner, 2026-10-11), so
 * it's offered where it's needed instead: a hint that says God unlocks
 * the action gets a "Switch to God for this map" button or menu item right
 * there. Never offered for an action Build already allows, and never
 * anywhere else (no nags).
 */
export const GOD_OFFER = "Switch to God for this map";

/** Is God the only mode that allows `action`? */
export function needsGod(action: ModeAction): boolean {
  return modeFor(action) === "god";
}

/**
 * The actionable form of a locked hint that names God ("Switch to God to
 * swap hexes." → "Switch to God for this map to swap hexes"); null for
 * every other hint (Build, or none).
 */
export function godOfferText(hint: string | null | undefined): string | null {
  if (!hint || !/\bSwitch to God\b/.test(hint)) return null;
  return hint.replace(/\bSwitch to God\b/, GOD_OFFER).replace(/\.$/, "");
}

/**
 * One line for several locked actions (a menu that hid them): the lowest
 * mode that unlocks any of them, with the verb when there's just one.
 */
export function lockedSummary(actions: readonly ModeAction[]): string | null {
  if (!actions.length) return null;
  const order = (m: WorkMode) => WORK_MODES.indexOf(m);
  const lowest = actions.map(modeFor).sort((a, b) => order(a) - order(b))[0];
  const at = [...new Set(actions.filter((a) => modeFor(a) === lowest))];
  return at.length === 1 ? lockedHint(at[0]) : `Switch to ${WORK_MODE_TEXT[lowest].label} to edit the map.`;
}

/** May `action` be done on this map, in its saved mode? */
export function mapAllows(map: { workMode?: string } | undefined, action: ModeAction): boolean {
  return allows(workModeOf(map), action);
}

// ── Entry points → actions (checked by tests/workModeCoverage.test.ts) ──

/** Every drawing tool (DrawingMode in src/hex-map/toolMode.ts). */
export const TOOL_ACTIONS: Record<DrawingMode, ModeAction> = {
  path: "edit-path",
  terrain: "paint-terrain",
  icon: "paint-icon",
  tableLink: "link-note",
  submapLink: "link-map",
  factionLink: "link-note",
  regionLink: "paint-region-area",
  swap: "swap-hexes",
  placeToken: "token",
  // First placements; a placed region's biome is God's (checked per hex, biomePainter.ts).
  biome: "place-biome",
};

/** Every registered command id (addCommand in src/). */
export const COMMAND_ACTIONS: Record<string, ModeAction> = {
  "open-hex-map": "view",
  "open-hex-table": "view",
  "open-terrain-generator": "view",
  "open-palette-editor": "settings",
  "edit-world-types": "edit-biomes",
  "convert-world-types": "edit-biomes",
  "new-overworld": "new-top-map",
  "map-go-up": "navigate",
  "map-go-back": "navigate",
  "map-go-forward": "navigate",
  "open-random-tables": "view",
  "add-roll-ranges": "tables",
  "check-tables": "tables",
  "export-current-note-pdf": "export",
  "export-current-note-markdown": "export",
  "export-current-hex": "export",
  "export-current-workflow": "export",
  "add-map-data-to-hex-notes": "edit-note",
  "update-region-faction-map-data": "edit-note",
  "export-current-map": "export",
};

/** Every item of the map view's menus (ModeMenu in src/hex-map/modeMenu.ts). */
export const MENU_ACTIONS = {
  // hex right-click menu
  "hex.center": "navigate",
  "hex.copy-link": "navigate",
  "hex.open-note": "open-note",
  "hex.enter-region": "navigate",
  "hex.open-location": "navigate",
  "hex.arrive": "discover",
  "hex.locations": "navigate",
  "hex.new-map": "new-child-map",
  "hex.link-map": "link-map",
  "hex.manage-locations": "link-map",
  "hex.link-table": "link-note",
  "hex.swap": "swap-hexes",
  "hex.create-token": "token",
  "hex.clear-terrain": "paint-terrain",
  "hex.remove-icon": "paint-icon",
  // overworld hex menu
  "ow.enter-region": "navigate",
  "ow.arrive": "discover",
  "ow.edit-region": "open-editor",
  "ow.set-biome": "place-biome",
  "ow.center": "navigate",
  "ow.copy-link": "navigate",
  "ow.locations": "navigate",
  "ow.create-token": "token",
  // token menu
  "token.info": "view",
  "token.edit": "token",
  "token.open-note": "open-note",
  "token.remove": "token",
  // the mode switch
  "mode.switch": "switch-mode",
  // hex editor: the maps strip "+" and a section's table source
  "editor.new-map": "new-child-map",
  "editor.link-map": "link-map",
  "editor.manage-locations": "link-map",
  "editor.map-table": "map-properties",
  "editor.hex-table": "edit-note",
} as const satisfies Record<string, ModeAction>;

export type MenuActionId = keyof typeof MENU_ACTIONS;

// ── The map note's `mode:` ──

/** The hint on a locked reshape action. */
export const RESHAPE_LOCKED_HINT = "Switch to God to change a placed biome.";

/** The hint on a locked first placement (Play mode). */
export const PLACE_LOCKED_HINT = "Switch to Build to place a biome.";

/** The hint when making a region is locked (Play mode). */
export const ADD_REGION_LOCKED_HINT = "Switch to Build to make a region.";

/** A map note's `mode:` value, read forgivingly ("God mode", "BUILD", "player"); unknown → undefined. */
export function parseWorkMode(raw: unknown): WorkMode | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().toLowerCase();
  if (/^god/.test(t)) return "god";
  if (/^build/.test(t)) return "build";
  if (/^play/.test(t)) return "play";
  return undefined;
}

/** The mode a map is in (its saved one, else Build). */
export function workModeOf(map: { workMode?: string } | undefined): WorkMode {
  return parseWorkMode(map?.workMode) ?? DEFAULT_WORK_MODE;
}

/** May what's already placed on this map be changed (biome swap, reroll, regenerate)? */
export function canReshape(map: { workMode?: string } | undefined): boolean {
  return mapAllows(map, "reshape");
}

/** The hint when a locked place can't be rerolled. */
export const REROLL_PLACE_LOCKED_HINT = "This place is locked. Switch to God to reroll it.";

/**
 * May a place made on arrival be rerolled? Until it's locked (`arrival:
 * open`), in any mode; once locked, only in God (GM4). A map not made on
 * arrival follows the usual reshape rule.
 */
export function canRerollPlace(map: { workMode?: string; arrival?: string } | undefined): boolean {
  if (map?.arrival?.trim().toLowerCase() === "open") return true;
  return mapAllows(map, "reshape");
}

/** May new things be added to this map (a first biome, a new region)? Build and God; not Play. */
export function canAdd(map: { workMode?: string } | undefined): boolean {
  return mapAllows(map, "new-child-map");
}
