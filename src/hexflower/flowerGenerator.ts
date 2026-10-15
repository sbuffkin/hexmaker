/**
 * The "Hex flower" generator card (plan-hex-flower, phase 6): offered on
 * every map scale of the setup wizard and New map, right after Blank.
 *
 * Options: Flower (new from this palette, or one of the vault's flowers),
 * Start (blank, filled as the party explores; or the whole map now), and in
 * Advanced Party token (on) and Reveal (the hex entered, or its neighbours
 * too). The map it makes has only its middle hex filled (or every hex),
 * a "Party" token there, and `explore-with`, `hex-flower-at` and `seed:`
 * in its map note. The flower note is written from the user's palette.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { GeneratorContribution, GeneratorHelpers, ScaleMapMade } from "../modules/types";
import type { ProcOption } from "../worldgen/procedural/common";
import type { GridSpec } from "../worldgen/generators";
import { applyTokenFrontmatter } from "../frontmatter";
import { normalizeFolder } from "../utils";
import { emptyFlower, isCell, type Flower } from "./flower";
import { fillFromPalette } from "./fromPalette";
import { classifyResult, formatFlowerAt, formatRule, planStep, readRules, startCell } from "./explore";
import { exploreOrder } from "./exploreOrder";
import { flowerStoreOf } from "./context";
import type { ExploreMap } from "./exploreFields";
import { hexKey, hexXY, neighbourKeys } from "../hexKey";

export const HEX_FLOWER_GENERATOR_ID = "procedural:hex-flower";
/** The Flower option's value for "New from this palette". */
export const NEW_FLOWER = "new";
/** The name of the party token a hex flower map starts with (Q5: on by default, Advanced). */
export const PARTY_TOKEN_NAME = "Party";

export const FLOWER_OPTIONS = {
  start: { key: "start", label: "Start", choices: [{ value: "blank", label: "Blank, fill as you explore" }, { value: "fill", label: "Fill the whole map now" }], default: "blank" },
  party: { key: "party", label: "Party token", choices: [{ value: "on", label: "On the middle hex" }, { value: "off", label: "None" }], default: "on" },
  reveal: { key: "reveal", label: "Reveal", choices: [{ value: "entered", label: "The hex entered" }, { value: "neighbours", label: "The hexes around too" }], default: "entered" },
} as const satisfies Record<string, ProcOption>;

function flowerOption(names: readonly string[]): ProcOption {
  return {
    key: "flower",
    label: "Flower",
    choices: [{ value: NEW_FLOWER, label: "New from this palette" }, ...names.map((n) => ({ value: n, label: n }))],
    default: NEW_FLOWER,
  };
}

/** The middle hex of a grid ("x_y"). */
export function middleHex(grid: Pick<GridSpec, "cols" | "rows" | "offset">): string {
  return hexKey(grid.offset.x + Math.floor(grid.cols / 2), grid.offset.y + Math.floor(grid.rows / 2));
}

/** The flower a run uses: a vault flower by name, else one from the palette (the same for the same seed). */
export function runFlower(plugin: HexmakerPlugin, choice: string | undefined, terrains: readonly string[], seed: number, palette?: string): Flower {
  const own = choice && choice !== NEW_FLOWER ? flowerStoreOf(plugin)?.get(choice)?.flower : undefined;
  if (own) return own;
  const f = emptyFlower("Hex flower", palette);
  f.cells = fillFromPalette(terrains, seed);
  return f;
}

/**
 * What a new map starts with: the middle hex from the flower's start (the
 * nearest cell showing a terrain when the start doesn't), or every hex
 * filled outward from the middle, each seen from where it was reached.
 */
export function startFill(
  flower: Flower,
  terrains: readonly string[],
  grid: GridSpec,
  orientation: "flat" | "pointy",
  seed: number,
  whole: boolean,
): { cells: Map<string, string>; at: Map<string, number> } {
  const start = middleHex(grid);
  const key = flower.name.toLowerCase();
  const cells = new Map<string, string>();
  // The middle hex: the start cell's terrain (or the nearest that has one).
  const ordered = [startCell(flower, undefined, undefined, true), ...flower.cells.map((_, i) => i + 1)];
  const cell = ordered.find((n) => isCell(n) && classifyResult(flower.cells[n - 1].result, terrains, () => false)?.kind === "terrain");
  let at = new Map<string, number>(cell ? [[key, cell]] : []);
  if (cell) cells.set(start, classifyResult(flower.cells[cell - 1].result, terrains, () => false)!.value);
  if (!whole) return { cells, at };
  const inGrid = (k: string) => {
    const { x, y } = hexXY(k);
    return x >= grid.offset.x && y >= grid.offset.y && x < grid.offset.x + grid.cols && y < grid.offset.y + grid.rows;
  };
  const near = (k: string) => neighbourKeys(k, orientation, grid.stagger).filter(inGrid);
  const rules = readRules([formatRule({ source: flower.name, target: { kind: "terrain" }, every: false })]);
  for (const { hex, from } of exploreOrder(start, near)) {
    if (cells.has(hex)) continue;
    const plan = planStep({
      rules, hex, from, fromTerrain: from ? cells.get(from) : undefined, now: {}, seed, at, terrains,
      source: (l) => (l.toLowerCase() === key ? { kind: "flower", flower } : undefined),
      isTable: () => false,
    });
    at = plan.at;
    const t = plan.writes.find((w) => w.target.kind === "terrain")?.value;
    if (t) cells.set(hex, t);
  }
  return { cells, at };
}

/** After the map is made: the flower note (new ones), the map's keys, the party token. */
async function afterCreate(plugin: HexmakerPlugin, made: ScaleMapMade): Promise<void> {
  const map: ExploreMap | undefined = plugin.getMap(made.mapName);
  const store = flowerStoreOf(plugin);
  if (!map || !store) return;
  const terrains = plugin.getPaletteOrPresetTerrains(made.paletteName).map((t) => t.name);
  let flower = runFlower(plugin, made.options.flower, terrains, made.seed, made.paletteName);
  let path = store.get(flower.name)?.path;
  if (!path || made.options.flower === NEW_FLOWER || !made.options.flower) {
    made.onProgress("Writing the hex flower…");
    path = await store.create({ ...flower, name: plugin.mapLabel(made.mapName) });
    flower = store.get(path)?.flower ?? flower;
  }
  const whole = made.options.start === "fill";
  const { at } = startFill(flower, terrains, made.grid, plugin.settings.hexOrientation, made.seed, whole);
  const start = middleHex(made.grid);
  map.seed = made.seed;
  map.exploreWith = [formatRule({ source: path.replace(/\.md$/i, ""), target: { kind: "terrain" }, every: false })];
  map.hexFlowerAt = formatFlowerAt(new Map([...at].map(([, c]) => [flower.name, c])));
  if (made.options.reveal === "neighbours") map.exploreReveal = "neighbours";
  if (made.options.party !== "off") {
    await addPartyToken(plugin, made.mapName, start);
    map.visited = [start];
  }
  await plugin.saveSettings();
}

/** A "Party" token note on hex `hex` of map `mapName` (a free name in the tokens folder). */
async function addPartyToken(plugin: HexmakerPlugin, mapName: string, hex: string): Promise<void> {
  const vault = plugin.app.vault;
  const folder = `${normalizeFolder(plugin.settings.worldFolder) || "world"}/tokens`;
  if (!vault.getAbstractFileByPath(folder)) { try { await vault.createFolder(folder); } catch { /* made meanwhile */ } }
  let name = PARTY_TOKEN_NAME;
  for (let i = 2; vault.getAbstractFileByPath(`${folder}/${name}.md`); i++) name = `${PARTY_TOKEN_NAME} ${i}`;
  const file = await vault.create(`${folder}/${name}.md`, "");
  await applyTokenFrontmatter(plugin.app, file.path, { hex, map: mapName, visible: true, party: true });
}

/** The generator card. */
export function hexFlowerGenerator(plugin: HexmakerPlugin, { toPaths, procGrid }: GeneratorHelpers): GeneratorContribution {
  const names = () => flowerStoreOf(plugin)?.list().map((e) => e.flower.name) ?? [];
  return {
    order: 1,
    id: HEX_FLOWER_GENERATOR_ID,
    label: "Hex flower",
    description: "Starts blank: each hex the party walks into is filled from a hex flower made from this palette.",
    source: "built-in",
    everyScale: true,
    options: [flowerOption([]), FLOWER_OPTIONS.start, FLOWER_OPTIONS.party, FLOWER_OPTIONS.reveal],
    optionsFor: () => [flowerOption(names()), FLOWER_OPTIONS.start, FLOWER_OPTIONS.party, FLOWER_OPTIONS.reveal],
    fits: (terrains) => terrains.length > 0,
    generate: (req) => {
      const terrains = req.terrains.map((t) => t.name);
      const flower = runFlower(plugin, req.options.flower, terrains, req.seed);
      const { cells } = startFill(flower, terrains, req.grid, procGrid(req.grid).orientation, req.seed, req.options.start === "fill");
      return cells.size ? { ok: true, cells, paths: [], warnings: [] } : { ok: false, message: "This flower has no terrain of the palette to start on." };
    },
    afterCreate,
    toPaths,
  };
}
