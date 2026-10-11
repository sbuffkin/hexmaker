/**
 * Work modes, per map (owner round 4, WM1–WM4): Play · Build · God.
 *
 * Stored readably in the map note (`mode: build`); a map opens in the mode
 * saved with it, default Build. This first pass enforces ONE rule:
 * canReshape() — changing what's already placed on an overworld (swapping a
 * placed biome, Reroll, regenerating, applying region settings to an
 * existing region) needs God. Placing a biome on an empty hex is allowed in
 * Build and God. Note text is never locked, and settings and palettes
 * aren't either (WM2, WM4). The rest of the modes plan (per-mode undo,
 * other locks) is still to come.
 *
 * Pure: no Obsidian imports.
 */

export type WorkMode = "play" | "build" | "god";

export const WORK_MODES: readonly WorkMode[] = ["play", "build", "god"];

export const DEFAULT_WORK_MODE: WorkMode = "build";

export const WORK_MODE_TEXT: Record<WorkMode, { label: string; desc: string }> = {
  play: { label: "Play", desc: "Run a game: look around and move. Notes stay editable." },
  build: { label: "Build", desc: "Add to the map. Things already placed stay as they are." },
  god: { label: "God", desc: "Change anything, including placed biomes, rerolls and regenerating." },
};

/** The hint on a locked reshape action. */
export const RESHAPE_LOCKED_HINT = "Switch to God to change a placed biome.";

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
  return workModeOf(map) === "god";
}
