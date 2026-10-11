/**
 * Arriving somewhere new (plan-tables-everywhere phase 4: SP4, SP5, GM4, T5).
 *
 * - resolveHex: a hex's On arrival table is rolled with a seed; what comes
 *   up becomes the hex's terrain on its own map (discovery is raised to the
 *   parent: the sector learns what the system is) and the cell is cleared,
 *   so a second visit never rolls again.
 * - arrive: when the world is set to make places (`on-arrival: make
 *   places`), going into a hex with no map makes its map at once: no form
 *   and no preview (SP4), seeded from the parent map's seed, set up from the
 *   rolled row, then the palette's Submap defaults, then the engine's. It is
 *   linked as the hex's location and opened in the parent's mode, with a
 *   plain-text "## Arrival" write-up in its note.
 * - reroll / lock (GM4): a place made on arrival can be made again in any
 *   mode until it's locked (`arrival: locked` in its note); after that only
 *   in God.
 *
 * A world that isn't set to make places never gets here: nothing changes.
 */

import { Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { randomSeed } from "../../packages/hex-wfc/src/rng";
import { chainLabel, resolveRoll, type ResolvedOdds, type TableLookup } from "../random-tables/resolve";
import { hexChildMaps } from "../maps/submaps";
import { defaultSubmapLabel, uniqueMapSlug } from "../hex-map/submapNav";
import { buildSubmapContext } from "../worldgen/submapContext";
import { addGeneratedPaths } from "../worldgen/generators";
import {
  BLANK_ID,
  kindsForPalette,
  listGeneratorKinds,
  optionsWithDefaults,
  runGenerator,
  submapStartKind,
  suggestBaseTerrain,
  visibleKinds,
  type TerrainGeneratorKind,
} from "../worldgen/registry";
import { attrsForTerrain } from "../worldgen/tableSources";
import { canRerollPlace, REROLL_PLACE_LOCKED_HINT, workModeOf, type ModeAction } from "../workMode";
import {
  arrivalLines,
  arrivalSeed,
  arrivalSummary,
  placeSetup,
  restateArrival,
  withArrivalSection,
  type ArrivalReport,
  type PlaceSetup,
} from "./arrival";

/** What a hex's On arrival roll gave. */
export interface HexResolution {
  /** The table rolled (as the cell had it). */
  table: string;
  kind: ResolvedOdds["kind"];
  /** The terrain, text, note… ("(nothing)" for a nothing row). */
  value: string;
  attrs: Record<string, string>;
  chain: string;
}

/** The submap size when nothing else says (SUBMAP_SIZE_PRESETS' Medium). */
const DEFAULT_PLACE_SIZE = { cols: 13, rows: 13 };

const keyOf = (x: number, y: number) => `${x}_${y}`;
const hexText = (key: string) => key.replace("_", ", ");

export class ArrivalService {
  constructor(private plugin: HexmakerPlugin) {}

  /** Why hex (x, y) of `mapName` can't be arrived at (null: it can). "off" when the world doesn't make places. */
  blocker(mapName: string, x: number, y: number): string | null {
    const { plugin } = this;
    if (!plugin.getMap(mapName)) return "No such map.";
    if (plugin.arrivalModeFor(mapName).mode !== "make") return "off";
    const h = plugin.mapStore.get(mapName, keyOf(x, y));
    if (h?.locked) return "This hex is locked.";
    if (hexChildMaps(h).some((m) => !!plugin.getMap(m))) return "This hex already has a map.";
    return null;
  }

  /** Whether "Go there" makes a place at hex (x, y). */
  canArrive(mapName: string, x: number, y: number): boolean {
    return this.blocker(mapName, x, y) === null;
  }

  /** The map's seed, given one now if it has none (saved with the next settings save). */
  private seedOf(mapName: string): number {
    const map = this.plugin.getMap(mapName);
    if (!map) return 0;
    if (typeof map.seed !== "number" || !Number.isFinite(map.seed)) map.seed = randomSeed();
    return map.seed >>> 0;
  }

  /** Tables for rolls on `mapName`: its generator tables (Map properties → Tables, World types), then any table note. */
  private lookupFor(mapName: string): { lookup: TableLookup; terrains: string[] } {
    const { plugin } = this;
    const terrains = plugin.getMapPalette(mapName).map((t) => t.name);
    const source = plugin.worldTypeStore.sourceFor(undefined, terrains, mapName).source;
    const notes = plugin.tableNotes.lookup();
    if (!source) return { lookup: notes, terrains };
    return {
      terrains,
      lookup: {
        table: (link) => source.lookup.table(link) ?? notes.table(link),
        kindOf: (link) => {
          const k = source.lookup.kindOf?.(link);
          return k && k !== "missing" ? k : notes.kindOf?.(link) ?? "missing";
        },
      },
    };
  }

  /**
   * Roll hex (x, y)'s On arrival table (seeded by the map's seed and the
   * hex) and write what came up onto the hex: a terrain replaces the shown
   * one, (nothing) clears it; the cell is cleared either way. Null when the
   * hex has nothing to roll or the write was refused.
   */
  resolveHex(mapName: string, x: number, y: number, action: ModeAction): HexResolution | null {
    const { plugin } = this;
    const key = keyOf(x, y);
    const cell = plugin.mapStore.get(mapName, key)?.onArrival;
    if (!cell) return null;
    const seed = arrivalSeed(this.seedOf(mapName), key, "arrival", 0);
    const { lookup, terrains } = this.lookupFor(mapName);
    const r = resolveRoll(cell, lookup, { seed, terrains });
    const patch: { onArrival: null; terrain?: string | null } = { onArrival: null };
    if (r.kind === "terrain") patch.terrain = r.value;
    else if (r.kind === "nothing") patch.terrain = null;
    if (!plugin.mapStore.set(mapName, key, patch, action)) return null;
    return {
      table: cell,
      kind: r.kind,
      value: r.kind === "nothing" ? "(nothing)" : r.kind === "empty" ? `nothing to roll on ${cell}` : r.value,
      attrs: r.attrs,
      chain: chainLabel(r),
    };
  }

  /** The place's setup and the generator to run, for hex (x, y) of `mapName` (SP4's chain). */
  private async plan(mapName: string, x: number, y: number, terrain: string | undefined, attrs: Record<string, string> | undefined, seed: number) {
    const { plugin } = this;
    const kinds = await listGeneratorKinds(plugin);
    const space = plugin.isSpaceMap(mapName);
    const fittingFor = (palette: string) => {
      const terrains = plugin.getPaletteOrPresetTerrains(palette);
      const spaceHere = space || plugin.getPaletteOrPresetKind(palette) === "space";
      return { terrains, fitting: kindsForPalette(visibleKinds(kinds, plugin.settings, spaceHere), terrains, true) };
    };
    const setup = placeSetup(attrs, plugin.submapDefaultFor(mapName, terrain), {
      palette: plugin.childPaletteFor(mapName),
      ...DEFAULT_PLACE_SIZE,
      generatorFor: (palette) => submapStartKind(fittingFor(palette).fitting, BLANK_ID, { parentTerrain: terrain }),
      baseFor: (palette) => suggestBaseTerrain(plugin.getPaletteOrPresetTerrains(palette)),
    }, seed);
    return { setup, ...this.kindFor(kinds, setup, fittingFor(setup.palette), terrain) };
  }

  /** The generator to run: the setup's, when it exists and fits the palette, else the engine's pick. */
  private kindFor(kinds: TerrainGeneratorKind[], setup: PlaceSetup, here: { terrains: ReturnType<HexmakerPlugin["getPaletteOrPresetTerrains"]>; fitting: TerrainGeneratorKind[] }, terrain: string | undefined) {
    const wanted = kinds.find((k) => k.id === setup.generator);
    if (wanted && wanted.fits(here.terrains)) return { kind: wanted, terrains: here.terrains, note: undefined as string | undefined };
    const fallback = kinds.find((k) => k.id === submapStartKind(here.fitting, BLANK_ID, { parentTerrain: terrain })) ?? kinds.find((k) => k.id === BLANK_ID)!;
    return { kind: fallback, terrains: here.terrains, note: `The generator ${setup.generator} isn't there or doesn't fit ${setup.palette}, so ${fallback.label} was used.` };
  }

  /**
   * Arrive at hex (x, y) of `mapName`: roll its On arrival table, make its
   * map from the result (no form, no preview), link and return it. Null
   * when the world doesn't make places, the hex has a map already, or
   * nothing is there.
   */
  async arrive(mapName: string, x: number, y: number): Promise<string | null> {
    const { plugin } = this;
    const why = this.blocker(mapName, x, y);
    if (why) {
      if (why !== "off") new Notice(why);
      return null;
    }
    const parent = plugin.getMap(mapName)!;
    const key = keyOf(x, y);
    const pseed = this.seedOf(mapName);
    const resolution = this.resolveHex(mapName, x, y, "discover");
    if (resolution?.kind === "nothing") {
      await plugin.saveSettings();
      new Notice(`Nothing at ${hexText(key)}: empty space.`);
      plugin.refreshHexMap();
      return null;
    }
    const terrain = plugin.mapStore.get(mapName, key)?.terrain ?? parent.baseTerrain;
    const source = plugin.worldTypeStore.sourceFor(undefined, plugin.getMapPalette(mapName).map((t) => t.name), mapName).source;
    const attrs = resolution?.kind === "terrain" ? resolution.attrs : terrain ? attrsForTerrain(source, terrain) : undefined;
    const seed = arrivalSeed(pseed, key, "submap", 0);
    const { setup, kind, terrains, note } = await this.plan(mapName, x, y, terrain, attrs, seed);

    const stagger = parent.staggerOffset ?? plugin.settings.staggerOffset ?? "odd";
    const outcome = runGenerator(plugin.settings.hexOrientation, kind, {
      terrains,
      grid: { cols: setup.cols, rows: setup.rows, offset: { x: 0, y: 0 }, stagger },
      seed,
      options: optionsWithDefaults(kind, setup.options),
      context: buildSubmapContext(plugin, mapName, x, y),
      pathTypes: plugin.getPathTypes(setup.palette),
      tablesFrom: mapName,
    });
    if (!outcome.ok) {
      await plugin.saveSettings();
      new Notice(`Couldn't make the place: ${outcome.message}`);
      plugin.refreshHexMap();
      return null;
    }

    const label = defaultSubmapLabel(plugin.mapStore.get(mapName, key)?.name, plugin.mapLabel(mapName), x, y, {
      terrain,
      taken: plugin.settings.maps.map((m) => plugin.mapLabel(m.name)),
    });
    const made = await plugin.createNewMap(label, setup.cols, setup.rows, setup.palette, 0, 0, stagger, undefined, outcome.cells, {
      baseTerrain: setup.baseTerrain,
      parent: { map: mapName, hex: key },
      quiet: true,
      slug: uniqueMapSlug(label, plugin.settings.maps.map((m) => m.name)),
      ...(outcome.arrivals ? { arrivals: outcome.arrivals } : {}),
    });
    if ("error" in made) {
      await plugin.saveSettings();
      new Notice(made.error);
      return null;
    }
    const { paths } = kind.toPaths(outcome.paths, made.name);
    if (paths.length) addGeneratedPaths(plugin, made.name, paths);
    await plugin.linkSubmap(mapName, x, y, made.name, "discover");
    const child = plugin.getMap(made.name);
    if (child) {
      child.seed = arrivalSeed(pseed, key, "place", 0);
      child.arrival = "open";
      // The new place opens in the mode the player was in.
      if (parent.workMode) child.workMode = workModeOf(parent);
    }
    await plugin.saveSettings();
    await plugin.mapStore.flush();

    const report: ArrivalReport = {
      date: new Date().toISOString().slice(0, 10),
      parentNote: `_${mapName}`,
      hex: hexText(key),
      ...(resolution ? { rolled: { table: resolution.table, result: resolution.value, chain: resolution.chain } } : {}),
      ...(terrain ? { terrain } : {}),
      made: { generator: kind.label, palette: setup.palette, cols: setup.cols, rows: setup.rows, seed },
      ...(note ? { extra: [note] } : {}),
    };
    await plugin.mapStore.editNoteText(made.name, (c) => withArrivalSection(c, arrivalLines(report)));
    new Notice(arrivalSummary(plugin.mapLabel(made.name), report), 8000);
    return made.name;
  }

  /**
   * Make a place made on arrival again (GM4): same palette, size and
   * generator, the next seed. Allowed in any mode until the place is
   * locked; then only in God. Its terrain and paths are replaced.
   */
  async reroll(mapName: string): Promise<boolean> {
    const { plugin } = this;
    const map = plugin.getMap(mapName);
    if (!map?.arrival || !map.parent || !plugin.getMap(map.parent.map)) return false;
    if (!canRerollPlace(map)) { new Notice(REROLL_PLACE_LOCKED_HINT); return false; }
    const { map: parentName, hex } = map.parent;
    const [x, y] = hex.split("_").map(Number);
    const n = (map.arrivalRerolls ?? 0) + 1;
    const seed = arrivalSeed(this.seedOf(parentName), hex, "submap", n);
    const terrain = plugin.mapStore.get(parentName, hex)?.terrain ?? plugin.getMap(parentName)?.baseTerrain;
    const source = plugin.worldTypeStore.sourceFor(undefined, plugin.getMapPalette(parentName).map((t) => t.name), parentName).source;
    const attrs = terrain ? attrsForTerrain(source, terrain) : undefined;
    const planned = await this.plan(parentName, x, y, terrain, attrs, seed);
    // The place keeps its palette and size; only the landscape is made again.
    const kinds = await listGeneratorKinds(plugin);
    const setup: PlaceSetup = { ...planned.setup, palette: map.paletteName, cols: map.gridSize.cols, rows: map.gridSize.rows };
    if (map.baseTerrain) setup.baseTerrain = map.baseTerrain;
    const terrains = plugin.getPaletteOrPresetTerrains(map.paletteName);
    const fitting = kindsForPalette(visibleKinds(kinds, plugin.settings, plugin.isSpaceMap(parentName)), terrains, true);
    const { kind } = this.kindFor(kinds, setup, { terrains, fitting }, terrain);
    const outcome = runGenerator(plugin.settings.hexOrientation, kind, {
      terrains,
      grid: { cols: map.gridSize.cols, rows: map.gridSize.rows, offset: { ...map.gridOffset }, stagger: map.staggerOffset ?? plugin.settings.staggerOffset ?? "odd" },
      seed,
      options: optionsWithDefaults(kind, setup.options),
      context: buildSubmapContext(plugin, parentName, x, y),
      pathTypes: plugin.getPathTypes(map.paletteName),
      tablesFrom: parentName,
    });
    if (!outcome.ok) { new Notice(`Couldn't reroll: ${outcome.message}`); return false; }

    // Every hex loses its old terrain and On arrival roll, then takes the new.
    const cells = new Map<string, { terrain?: string; onArrival?: string }>();
    for (const k of plugin.mapStore.all(mapName).keys()) cells.set(k, { terrain: undefined, onArrival: undefined });
    for (const [k, t] of outcome.cells) if (t && t !== map.baseTerrain) cells.set(k, { ...(cells.get(k) ?? {}), terrain: t });
    for (const [k, table] of outcome.arrivals ?? []) cells.set(k, { ...(cells.get(k) ?? {}), onArrival: table });
    plugin.mapStore.setMany(mapName, cells);
    plugin.mapStore.setPaths(mapName, kind.toPaths(outcome.paths, mapName).paths);
    map.arrivalRerolls = n;
    await plugin.saveSettings();
    await plugin.mapStore.flush();
    await plugin.mapStore.editNoteText(mapName, (c) => restateArrival(c, {
      made: { generator: kind.label, palette: map.paletteName, cols: map.gridSize.cols, rows: map.gridSize.rows, seed },
      rerolls: n,
      locked: map.arrival === "locked",
    }));
    plugin.refreshHexMap();
    new Notice(`Rerolled ${plugin.mapLabel(mapName)}.`);
    return true;
  }

  /** Lock a place made on arrival (GM4): from now on only God may reroll it. */
  async lock(mapName: string): Promise<void> {
    const { plugin } = this;
    const map = plugin.getMap(mapName);
    if (!map?.arrival || map.arrival === "locked") return;
    map.arrival = "locked";
    await plugin.saveSettings();
    await plugin.mapStore.flush();
    await plugin.mapStore.editNoteText(mapName, (c) => restateArrival(c, { rerolls: map.arrivalRerolls ?? 0, locked: true }));
    plugin.refreshHexMap();
    new Notice(`Locked ${plugin.mapLabel(mapName)}. Rerolling it now needs God mode.`);
  }
}
