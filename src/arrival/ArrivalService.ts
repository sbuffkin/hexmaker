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
 * - On an overworld (a map whose regions join up), going to a hex with no
 *   region makes its region, seeded and with no form, from the hex's biome
 *   through the same path as the Biome painter and walking into new land
 *   (createRegion). Same Reroll/Lock rules (GM4: "a new planet, new
 *   region").
 * - Once-only rows (SP6): every roll here leaves out rows the Events
 *   ledgers hold, and writes the ones it lands on (EventsService).
 *
 * A world that isn't set to make places never gets here: nothing changes.
 */

import { Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { randomSeed } from "../../packages/hex-wfc/src/rng";
import { chainLabel, resolveRoll, type ResolvedOdds, type TableLookup } from "../random-tables/resolve";
import { hexChildMaps, regionMapAt } from "../maps/submaps";
import { OnceTracker, type FiredEvent } from "./eventsLedger";
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
import { moduleArrivalTables, worldMaps } from "../modules/runtime";
import { canRerollPlace, REROLL_PLACE_LOCKED_HINT, workModeOf, type ModeAction } from "../workMode";
import { lockedNotice } from "../hex-map/godOffer";
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
  /** Once-only rows it landed on (written to the Events ledgers). */
  events: FiredEvent[];
}

/** "Found the Silent Fleet (once per world)." lines for the write-up. */
function eventLines(events: readonly FiredEvent[]): string[] {
  return events.map((e) => `Found ${e.link ? `[[${e.result.replace(/^.*\//, "")}]]` : e.result} (once per ${e.scope}; in the Events list).`);
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
    const key = keyOf(x, y);
    const h = plugin.mapStore.get(mapName, key);
    if (h?.locked) return "This hex is locked.";
    const wm = worldMaps();
    if (wm && this.isOverworld(mapName)) {
      // An overworld's hexes are regions: arriving makes the region.
      if (regionMapAt(plugin.settings.maps, mapName, key)) return "This hex already has a region.";
      if (!wm.inOverworldGrid(plugin.getMap(mapName)!, x, y)) return "This hex is off the map.";
      if (!h?.onArrival && !wm.hexBiomeAt(plugin, mapName, key)) return "This hex has no biome yet.";
      return null;
    }
    if (hexChildMaps(h).some((m) => !!plugin.getMap(m))) return "This hex already has a map.";
    return null;
  }

  /** A map whose regions join up (an overworld): arrival makes regions there. */
  isOverworld(mapName: string): boolean {
    return !!worldMaps()?.overworldOf(this.plugin, mapName);
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
    const source = moduleArrivalTables(plugin, terrains, mapName);
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
   * one, (nothing) clears it; the cell is cleared either way. Once-only
   * rows in the Events ledgers are left out, and the ones it lands on are
   * written there. Null when the hex has nothing to roll or the write was
   * refused.
   */
  async resolveHex(mapName: string, x: number, y: number, action: ModeAction): Promise<HexResolution | null> {
    const { plugin } = this;
    const key = keyOf(x, y);
    const cell = plugin.mapStore.get(mapName, key)?.onArrival;
    if (!cell) return null;
    const seed = arrivalSeed(this.seedOf(mapName), key, "arrival", 0);
    const { lookup, terrains } = this.lookupFor(mapName);
    const once = new OnceTracker(await plugin.events.ledgersFor({ map: mapName }));
    // The cell may have been resolved while the ledgers were read.
    if (plugin.mapStore.get(mapName, key)?.onArrival !== cell) return null;
    const r = resolveRoll(cell, lookup, { seed, terrains, isUsed: once.isUsed });
    const patch: { onArrival: null; terrain?: string | null } = { onArrival: null };
    if (r.kind === "terrain") patch.terrain = r.value;
    else if (r.kind === "nothing") patch.terrain = null;
    if (!plugin.mapStore.set(mapName, key, patch, action)) return null;
    once.fire(r.onces, key);
    await plugin.events.record(mapName, once.fired);
    return {
      table: cell,
      kind: r.kind,
      value: r.kind === "nothing" ? "(nothing)" : r.kind === "empty" ? `nothing to roll on ${cell}` : r.value,
      attrs: r.attrs,
      chain: chainLabel(r),
      events: once.fired,
    };
  }

  /** The place's setup and the generator to run, for hex (x, y) of `mapName` (SP4's chain). */
  private async plan(mapName: string, x: number, y: number, terrain: string | undefined, attrs: Record<string, string> | undefined, seed: number) {
    const { plugin } = this;
    const kinds = await listGeneratorKinds(plugin);
    const context = plugin.contextKinds(mapName);
    const fittingFor = (palette: string) => {
      const terrains = plugin.getPaletteOrPresetTerrains(palette);
      const here = new Set([...context, plugin.getPaletteOrPresetKind(palette)]);
      return { terrains, fitting: kindsForPalette(visibleKinds(kinds, plugin.settings, here), terrains, true) };
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
    if (this.isOverworld(mapName)) return this.arriveRegion(mapName, x, y);
    const parent = plugin.getMap(mapName)!;
    const key = keyOf(x, y);
    const pseed = this.seedOf(mapName);
    const resolution = await this.resolveHex(mapName, x, y, "discover");
    if (resolution?.kind === "nothing") {
      await plugin.saveSettings();
      new Notice(`Nothing at ${hexText(key)}: empty space.`);
      plugin.refreshHexMap();
      return null;
    }
    const terrain = plugin.mapStore.get(mapName, key)?.terrain ?? parent.baseTerrain;
    const source = moduleArrivalTables(plugin, plugin.getMapPalette(mapName).map((t) => t.name), mapName);
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
      ledgers: await plugin.events.ledgersFor({ parent: mapName }),
    });
    if (!outcome.ok) {
      await plugin.saveSettings();
      new Notice(`Couldn't make the place: ${outcome.message}`);
      plugin.refreshHexMap();
      return null;
    }

    // The hex's own name, else one rolled on the Names table (seeded), else terrain and coordinates.
    const named = plugin.mapStore.get(mapName, key)?.name?.trim() || plugin.rolledMapName(mapName, key, arrivalSeed(pseed, key, "name", 0));
    const label = defaultSubmapLabel(named, plugin.mapLabel(mapName), x, y, {
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
    await plugin.events.record(made.name, outcome.events);

    const extra = [...(note ? [note] : []), ...eventLines([...(resolution?.events ?? []), ...(outcome.events ?? [])])];
    const report: ArrivalReport = {
      date: new Date().toISOString().slice(0, 10),
      parentNote: `_${mapName}`,
      hex: hexText(key),
      ...(resolution ? { rolled: { table: resolution.table, result: resolution.value, chain: resolution.chain } } : {}),
      ...(terrain ? { terrain } : {}),
      made: { generator: kind.label, palette: setup.palette, cols: setup.cols, rows: setup.rows, seed },
      ...(extra.length ? { extra } : {}),
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
    // Locked (God only): the Notice offers to switch the map to God.
    if (!canRerollPlace(map)) { lockedNotice(plugin, mapName, REROLL_PLACE_LOCKED_HINT); return false; }
    if (map.submapKind === "region") return this.rerollRegion(mapName);
    const { map: parentName, hex } = map.parent;
    const [x, y] = hex.split("_").map(Number);
    const n = (map.arrivalRerolls ?? 0) + 1;
    const seed = arrivalSeed(this.seedOf(parentName), hex, "submap", n);
    // The old landscape's once-only events go with it.
    await plugin.events.forgetMap(mapName);
    const terrain = plugin.mapStore.get(parentName, hex)?.terrain ?? plugin.getMap(parentName)?.baseTerrain;
    const source = moduleArrivalTables(plugin, plugin.getMapPalette(parentName).map((t) => t.name), parentName);
    const attrs = terrain ? attrsForTerrain(source, terrain) : undefined;
    const planned = await this.plan(parentName, x, y, terrain, attrs, seed);
    // The place keeps its palette and size; only the landscape is made again.
    const kinds = await listGeneratorKinds(plugin);
    const setup: PlaceSetup = { ...planned.setup, palette: map.paletteName, cols: map.gridSize.cols, rows: map.gridSize.rows };
    if (map.baseTerrain) setup.baseTerrain = map.baseTerrain;
    const terrains = plugin.getPaletteOrPresetTerrains(map.paletteName);
    const fitting = kindsForPalette(visibleKinds(kinds, plugin.settings, plugin.contextKinds(parentName)), terrains, true);
    const { kind } = this.kindFor(kinds, setup, { terrains, fitting }, terrain);
    const outcome = runGenerator(plugin.settings.hexOrientation, kind, {
      terrains,
      grid: { cols: map.gridSize.cols, rows: map.gridSize.rows, offset: { ...map.gridOffset }, stagger: map.staggerOffset ?? plugin.settings.staggerOffset ?? "odd" },
      seed,
      options: optionsWithDefaults(kind, setup.options),
      context: buildSubmapContext(plugin, parentName, x, y),
      pathTypes: plugin.getPathTypes(map.paletteName),
      tablesFrom: parentName,
      ledgers: await plugin.events.ledgersFor({ map: mapName }),
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
    await plugin.events.record(mapName, outcome.events);
    await plugin.mapStore.editNoteText(mapName, (c) => restateArrival(c, {
      made: { generator: kind.label, palette: map.paletteName, cols: map.gridSize.cols, rows: map.gridSize.rows, seed },
      rerolls: n,
      locked: map.arrival === "locked",
    }));
    plugin.refreshHexMap();
    new Notice(`Rerolled ${plugin.mapLabel(mapName)}.`);
    return true;
  }

  // ── regions on an overworld (GM4: "a new region") ─────────────────────

  /** A biome's name as written. */
  private biomeText(id: string): string {
    return worldMaps()?.biomeNoteOf(id)?.label ?? id;
  }

  /**
   * Arrive at overworld hex (x, y): roll its On arrival table if it has
   * one, then make its region from the hex's biome, seeded from the
   * overworld's seed, with no form (the Biome painter's path). Opens in the
   * overworld's mode, open for rerolls until locked.
   */
  private async arriveRegion(mapName: string, x: number, y: number): Promise<string | null> {
    const { plugin } = this;
    const wm = worldMaps();
    if (!wm) return null;
    const parent = plugin.getMap(mapName)!;
    const key = keyOf(x, y);
    const pseed = this.seedOf(mapName);
    const resolution = await this.resolveHex(mapName, x, y, "discover");
    if (resolution?.kind === "nothing") {
      await plugin.saveSettings();
      new Notice(`Nothing at ${hexText(key)}.`);
      plugin.refreshHexMap();
      return null;
    }
    const biome = wm.hexBiomeAt(plugin, mapName, key);
    if (!biome) {
      await plugin.saveSettings();
      new Notice(`Nothing to make at ${hexText(key)}: the hex has no biome.`);
      plugin.refreshHexMap();
      return null;
    }
    const seed = arrivalSeed(pseed, key, "submap", 0);
    const res = await wm.createRegion(plugin, mapName, x, y, { fill: "match", biome, seed, arrival: true });
    if ("error" in res) {
      await plugin.saveSettings();
      new Notice(res.error);
      return null;
    }
    const child = plugin.getMap(res.name);
    if (child) {
      child.arrival = "open";
      if (parent.workMode) child.workMode = workModeOf(parent);
    }
    await plugin.saveSettings();
    await plugin.mapStore.flush();
    const terrain = plugin.mapStore.get(mapName, key)?.terrain;
    const extra = eventLines(resolution?.events ?? []);
    const report: ArrivalReport = {
      date: new Date().toISOString().slice(0, 10),
      parentNote: `_${mapName}`,
      hex: hexText(key),
      ...(resolution ? { rolled: { table: resolution.table, result: resolution.value, chain: resolution.chain } } : {}),
      ...(terrain ? { terrain } : {}),
      made: { generator: `the ${this.biomeText(biome)} biome`, palette: child?.paletteName ?? "", cols: child?.gridSize.cols ?? 0, rows: child?.gridSize.rows ?? 0, seed },
      ...(extra.length ? { extra } : {}),
    };
    await plugin.mapStore.editNoteText(res.name, (c) => withArrivalSection(c, arrivalLines(report)));
    new Notice(arrivalSummary(plugin.mapLabel(res.name), report), 8000);
    return res.name;
  }

  /** Make a region made on arrival again: the next seed, its biome as the overworld has it now. Locked cells stay. */
  private async rerollRegion(mapName: string): Promise<boolean> {
    const { plugin } = this;
    const wm = worldMaps();
    if (!wm) return false;
    const map = plugin.getMap(mapName)!;
    const { map: parentName, hex } = map.parent!;
    const n = (map.arrivalRerolls ?? 0) + 1;
    const seed = arrivalSeed(this.seedOf(parentName), hex, "submap", n);
    await plugin.events.forgetMap(mapName);
    await wm.regenerateRegion(plugin, mapName, { seed, arrival: true });
    map.arrivalRerolls = n;
    await plugin.saveSettings();
    await plugin.mapStore.flush();
    const biome = wm.hexBiomeAt(plugin, parentName, hex);
    await plugin.mapStore.editNoteText(mapName, (c) => restateArrival(c, {
      made: { generator: `the ${biome ? this.biomeText(biome) : "region's"} biome`, palette: map.paletteName, cols: map.gridSize.cols, rows: map.gridSize.rows, seed },
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
