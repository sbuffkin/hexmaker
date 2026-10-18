/**
 * The "Hex flower" generator (plan-hex-flower, phase 6): never in a
 * generator list (HF8, owner 2026-10-18: exploring is a kind of map, not a
 * generator); New map's "Explore as you go" makes maps with it
 * (EXPLORE_MODE).
 *
 * What powers it (HF8 B2, owner 2026-10-18: "they pick which generators
 * or blends power it, not a flower built off a random palette"): the
 * generators picked in the setup (exploreSetupForm.ts), each a realm of
 * influence (realms.ts) rolled on a flower made from its terrain mix
 * (realmFlowers.ts). Advanced → "Make your own flower" rolls on a flower
 * note instead: a new one from the palette, or one of the vault's (B3).
 *
 * Options: Start (blank, filled as the party explores; or the whole map
 * now), Party token (on) and Party sees (the hex, or 1–3 rings around it),
 * all main (owner HF9, 2026-10-16); the setup's own (home, areas, startHex).
 * The map it makes has its start hex and what the party sees from it
 * filled (or every hex), a "Party" token there, and `explore-with`,
 * `explore-realms` (or the flower note), `hex-flower-at` and `seed:` in its
 * map note.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { GeneratorContribution, GeneratorHelpers, ScaleMapMade } from "../modules/types";
import type { ProcOption } from "../worldgen/procedural/common";
import type { GridSpec } from "../worldgen/generators";
import type { TerrainColor } from "../types";
import { applyTokenFrontmatter } from "../frontmatter";
import { normalizeFolder } from "../utils";
import { emptyFlower, isCell, type Flower } from "./flower";
import { fillFromPalette } from "./fromPalette";
import { classifyResult, formatFlowerAt, formatReveal, formatRule, parseReveal, planStep, readRules, startCell } from "./explore";
import { exploreOrder, ringOrder } from "./exploreOrder";
import { exploreOf, flowerStoreOf } from "./context";
import type { ExploreMap } from "./exploreFields";
import { hexXY, neighbourKeys } from "../hexKey";
import { ensureFolder } from "../vault/ensureFolder";
import { listGeneratorKinds, type TerrainGeneratorKind } from "../worldgen/registry";
import { withRecent } from "../worldgen/newMapSetup/pickerRows";
import { REALMS_RULE, REALMS_SOURCE, formatRealm, realmAt, type Geometry, type Realm } from "./realms";
import { EXPLORE_OPTION, middleOf, parseAreas, setupRealms, startHexOf } from "./exploreSetup";
import { sourceOf } from "./realmFlowers";

export const HEX_FLOWER_GENERATOR_ID = "procedural:hex-flower";
/** The Flower option's value for "New from this palette". */
export const NEW_FLOWER = "new";
/** The Flower option's value for "No: roll on the generators" (the default, HF8). */
export const FROM_GENERATORS = "generators";
/** The name of the party token a hex flower map starts with (Q5: on by default, Advanced). */
export const PARTY_TOKEN_NAME = "Party";

export const FLOWER_OPTIONS = {
  start: { key: "start", label: "Start", choices: [{ value: "blank", label: "Blank, fill as you explore" }, { value: "fill", label: "Fill the whole map now" }], default: "blank" },
  party: { key: "party", label: "Party token", choices: [{ value: "on", label: "On the start hex" }, { value: "off", label: "None" }], default: "on" },
  // What the party sees: how far a step fills (HF5 part A: "default to 1, but allow reveal and make it normal").
  reveal: {
    key: "reveal",
    label: "Party sees",
    choices: [
      { value: "entered", label: "The hex it's on" },
      { value: "1", label: "1 ring around it" },
      { value: "2", label: "2 rings around it" },
      { value: "3", label: "3 rings around it" },
    ],
    default: "1",
  },
  // The setup's own (exploreSetupForm.ts): the generators that power the map, more areas, the start hex.
  home: { key: EXPLORE_OPTION.home, label: "Powered by", choices: [], default: "", setBySetup: true },
  areas: { key: EXPLORE_OPTION.areas, label: "More areas", choices: [], default: "", setBySetup: true },
  startHex: { key: EXPLORE_OPTION.startHex, label: "Start hex", choices: [], default: "", setBySetup: true },
} as const satisfies Record<string, ProcOption>;

/** Advanced → "Make your own flower" (B3): roll on the generators (the default), a new flower from the palette, or a vault flower. */
function flowerOption(names: readonly string[]): ProcOption {
  return {
    key: "flower",
    label: "Make your own flower",
    choices: [
      { value: FROM_GENERATORS, label: "No: roll on the generators" },
      { value: NEW_FLOWER, label: "New from this palette" },
      ...names.map((n) => ({ value: n, label: n })),
    ],
    default: FROM_GENERATORS,
  };
}

/** The middle hex of a grid ("x_y"). */
export function middleHex(grid: Pick<GridSpec, "cols" | "rows" | "offset">): string {
  return middleOf(grid);
}

/** Does a run roll on the generators (realms), not on a flower note? */
export function usesRealms(options: Readonly<Record<string, string>>): boolean {
  return (options.flower ?? FROM_GENERATORS) === FROM_GENERATORS && !!options[EXPLORE_OPTION.home]?.trim();
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
 * What a new map starts with: the start hex (default the middle) from the
 * flower's start cell (the nearest cell showing a terrain when the start
 * doesn't), then what the party sees from it (`sight` rings, HF5), or every
 * hex filled outward, each seen from where it was reached. `flower` is one
 * flower, or the flower of each hex (a map's realms).
 */
export function startFill(
  flower: Flower | ((hex: string) => Flower | undefined),
  terrains: readonly string[],
  grid: GridSpec,
  orientation: "flat" | "pointy",
  seed: number,
  whole: boolean,
  opts: { start?: string; sight?: number } = {},
): { cells: Map<string, string>; at: Map<string, number> } {
  const start = opts.start ?? middleHex(grid);
  const flowerAt = typeof flower === "function" ? flower : () => flower;
  const cells = new Map<string, string>();
  const first = flowerAt(start);
  if (!first) return { cells, at: new Map() };
  // The start hex: the start cell's terrain (or the nearest that has one).
  const ordered = [startCell(first, undefined, undefined, true), ...first.cells.map((_, i) => i + 1)];
  const cell = ordered.find((n) => isCell(n) && classifyResult(first.cells[n - 1].result, terrains, () => false)?.kind === "terrain");
  let at = new Map<string, number>(cell ? [[first.name.toLowerCase(), cell]] : []);
  if (cell) cells.set(start, classifyResult(first.cells[cell - 1].result, terrains, () => false)!.value);
  const sight = Math.max(0, opts.sight ?? 0);
  if (!whole && sight === 0) return { cells, at };
  const inGrid = (k: string) => {
    const { x, y } = hexXY(k);
    return x >= grid.offset.x && y >= grid.offset.y && x < grid.offset.x + grid.cols && y < grid.offset.y + grid.rows;
  };
  const near = (k: string) => neighbourKeys(k, orientation, grid.stagger).filter(inGrid);
  const rules = readRules([typeof flower === "function" ? REALMS_RULE : formatRule({ source: flower.name, target: { kind: "terrain" }, every: false })]);
  const order = whole ? exploreOrder(start, near) : ringOrder(start, sight, near);
  for (const { hex, from } of order) {
    if (cells.has(hex)) continue;
    const f = flowerAt(hex);
    if (!f) continue;
    const plan = planStep({
      rules, hex, from, fromTerrain: from ? cells.get(from) : undefined, now: {}, seed, at, terrains,
      source: (l) => (l.toLowerCase() === REALMS_SOURCE || l.toLowerCase() === f.name.toLowerCase() ? { kind: "flower", flower: f } : undefined),
      isTable: () => false,
    });
    at = plan.at;
    const t = plan.writes.find((w) => w.target.kind === "terrain")?.value;
    if (t) cells.set(hex, t);
  }
  return { cells, at };
}

/** The flower of each hex for realms `realms` (undefined where a realm has none); the party starts at home. */
function realmFlowerAt(plugin: HexmakerPlugin, realms: readonly Realm[], terrains: TerrainColor[], palette: string, seed: number, g: Geometry, kinds?: readonly TerrainGeneratorKind[]): (hex: string) => Flower | undefined {
  const ex = exploreOf(plugin);
  const flowers = new Map(realms.map((r) => [r.name, ex?.realmFlower(r, terrains, palette, seed, kinds)?.flower]));
  const home = realms.find((r) => r.reach === "home");
  return (hex) => {
    const r = home && hex === home.centre ? home : realmAt(hex, realms, g, { seed });
    return r ? flowers.get(r.name) : undefined;
  };
}

/** After the map is made: its realms (or the flower note), the map's keys, the party token. */
async function afterCreate(plugin: HexmakerPlugin, made: ScaleMapMade): Promise<void> {
  const map: ExploreMap | undefined = plugin.getMap(made.mapName);
  const store = flowerStoreOf(plugin);
  if (!map || !store) return;
  const start = startHexOf(made.grid, made.options[EXPLORE_OPTION.startHex]);
  const sight = parseReveal(made.options.reveal);
  const whole = made.options.start === "fill";
  map.seed = made.seed;
  const reveal = formatReveal(sight);
  if (reveal) map.exploreReveal = reveal;
  if (usesRealms(made.options)) {
    // The generators that power it, each a realm (written by id, or as a link to its note).
    const ids = [made.options[EXPLORE_OPTION.home], ...parseAreas(made.options[EXPLORE_OPTION.areas]).map((a) => a.id)];
    const kinds = await exploreOf(plugin)?.kindsFor(ids.map((ref) => ({ ref, link: false }))) ?? await listGeneratorKinds(plugin);
    const byId = new Map(kinds.map((k) => [k.id, k]));
    const g: Geometry = { orientation: plugin.settings.hexOrientation, stagger: made.grid.stagger };
    const realms = setupRealms(made.options, start, made.seed, g, (id) => byId.get(id)?.label, (id) => {
      const k = byId.get(id);
      return k ? sourceOf(k) : { ref: id, link: false, weight: 1 };
    });
    const terrainColors = plugin.getPaletteOrPresetTerrains(made.paletteName);
    const flowerAt = realmFlowerAt(plugin, realms, terrainColors, made.paletteName, made.seed, g, kinds);
    const { at } = startFill(flowerAt, terrainColors.map((t) => t.name), made.grid, g.orientation, made.seed, whole, { start, sight });
    map.exploreRealms = realms.map(formatRealm);
    map.exploreWith = [REALMS_RULE];
    map.hexFlowerAt = formatFlowerAt(at, new Map(realms.map((r) => [r.name.toLowerCase(), r.name])));
    // New map's Recent: the generator that powers it.
    plugin.settings.recentGenerators = withRecent(plugin.settings.recentGenerators, made.options[EXPLORE_OPTION.home]);
  } else {
    await writeFlowerNote(plugin, made, map, start, sight, whole);
  }
  if (made.options.party !== "off") {
    await addPartyToken(plugin, made.mapName, start);
    map.visited = [start];
  }
  await plugin.saveSettings();
}

/** "Make your own flower": the flower note (a new one from the palette, or a vault flower) and the rule that rolls on it. */
async function writeFlowerNote(plugin: HexmakerPlugin, made: ScaleMapMade, map: ExploreMap, start: string, sight: number, whole: boolean): Promise<void> {
  const store = flowerStoreOf(plugin);
  if (!store) return;
  const terrains = plugin.getPaletteOrPresetTerrains(made.paletteName).map((t) => t.name);
  let flower = runFlower(plugin, made.options.flower, terrains, made.seed, made.paletteName);
  let path = store.get(flower.name)?.path;
  if (!path || made.options.flower === NEW_FLOWER || !made.options.flower || made.options.flower === FROM_GENERATORS) {
    made.onProgress("Writing the hex flower…");
    path = await store.create({ ...flower, name: plugin.mapLabel(made.mapName) });
    flower = store.get(path)?.flower ?? flower;
  }
  const { at } = startFill(flower, terrains, made.grid, plugin.settings.hexOrientation, made.seed, whole, { start, sight });
  map.exploreWith = [formatRule({ source: path.replace(/\.md$/i, ""), target: { kind: "terrain" }, every: false })];
  map.hexFlowerAt = formatFlowerAt(new Map([...at].map(([, c]) => [flower.name, c])));
}

/** A "Party" token note on hex `hex` of map `mapName` (a free name in the tokens folder). */
export async function addPartyToken(plugin: HexmakerPlugin, mapName: string, hex: string): Promise<void> {
  const vault = plugin.app.vault;
  const folder = `${normalizeFolder(plugin.settings.worldFolder) || "world"}/tokens`;
  await ensureFolder(vault, folder);
  let name = PARTY_TOKEN_NAME;
  for (let i = 2; vault.getAbstractFileByPath(`${folder}/${name}.md`); i++) name = `${PARTY_TOKEN_NAME} ${i}`;
  const file = await vault.create(`${folder}/${name}.md`, "");
  await applyTokenFrontmatter(plugin.app, file.path, { hex, map: mapName, visible: true, party: true });
}

/** New map's "Explore as you go" (HF8 B1): a map made with the Hex flower generator. */
export const EXPLORE_MODE = {
  id: "explore",
  label: "Explore as you go",
  desc: "Starts with only the party's hex: each hex they walk into is filled as they go.",
  generatorId: HEX_FLOWER_GENERATOR_ID,
};

/** The generator. */
export function hexFlowerGenerator(plugin: HexmakerPlugin, { toPaths, procGrid }: GeneratorHelpers): GeneratorContribution {
  const names = () => flowerStoreOf(plugin)?.list().map((e) => e.flower.name) ?? [];
  return {
    order: 1,
    id: HEX_FLOWER_GENERATOR_ID,
    label: "Hex flower",
    description: "Starts blank: each hex the party walks into is filled from a hex flower made from this palette.",
    source: "built-in",
    unlisted: true,
    options: [flowerOption([]), ...Object.values(FLOWER_OPTIONS)],
    optionsFor: () => [flowerOption(names()), ...Object.values(FLOWER_OPTIONS)],
    fits: (terrains) => terrains.length > 0,
    generate: (req) => {
      const terrains = req.terrains.map((t) => t.name);
      const g: Geometry = { orientation: procGrid(req.grid).orientation, stagger: req.grid.stagger };
      const start = startHexOf(req.grid, req.options[EXPLORE_OPTION.startHex]);
      const opts = { start, sight: parseReveal(req.options.reveal) };
      const whole = req.options.start === "fill";
      if (usesRealms(req.options)) {
        // The preview: the generators New map has at hand (exploreSetupForm hands them to the service).
        const known = new Map((exploreOf(plugin)?.knownKinds() ?? []).map((k) => [k.id, k.label]));
        const realms = setupRealms(req.options, start, req.seed, g, (id) => known.get(id));
        const palette = terrains.join("\u0000");
        const { cells } = startFill(realmFlowerAt(plugin, realms, req.terrains, palette, req.seed, g), terrains, req.grid, g.orientation, req.seed, whole, opts);
        return cells.size ? { ok: true, cells, paths: [], warnings: [] } : { ok: false, message: "These generators make no terrain of this palette." };
      }
      const flower = runFlower(plugin, req.options.flower, terrains, req.seed);
      const { cells } = startFill(flower, terrains, req.grid, g.orientation, req.seed, whole, opts);
      return cells.size ? { ok: true, cells, paths: [], warnings: [] } : { ok: false, message: "This flower has no terrain of the palette to start on." };
    },
    afterCreate,
    toPaths,
  };
}
