import type HexmakerPlugin from "../HexmakerPlugin";
import type { TerrainColor } from "../types";
import {
  generateTerrain,
  generatorFitsPalette,
  listGenerators,
  toPathChains,
  type GridSpec,
} from "./generators";
import { findTerrain, type GenerationContext, type ProcGrid, type ProcOption } from "./procedural/common";
import { STAR_SCATTER_ID, STAR_SCATTER_OPTIONS, starScatter, starScatterOffered } from "./procedural/starScatter";
import { ORBITS_ID, ORBITS_OPTIONS, orbits, orbitsFits } from "./procedural/orbits";
import {
  PLANET_SURFACE_ID,
  OVERLAND_ID,
  OVERLAND_OPTIONS,
  PLANET_SURFACE_OPTIONS,
  REGION_DETAIL_ID,
  REGION_DETAIL_OPTIONS,
  overlandDescription,
  planetSurface,
  planetSurfaceFits,
} from "./procedural/planetSurface";
import { generatorMapKind, isGeneratorShown, type MapKind } from "../mapKinds";
import { generateConnected, type NewRegion } from "./neighbours";

/**
 * One list of terrain generators for map creation: Blank, the built-in
 * procedural generators (Star scatter, Orbits), and every learned WFC
 * generator file. Callers (setup modal, New map tab) only see this
 * interface; WFC specifics stay in generators.ts.
 */

export interface GeneratedPath {
  type: string;
  route?: string;
  hexes: string[];
}

export type GenerateOutcome =
  | {
      ok: true;
      cells: Map<string, string>;
      paths: GeneratedPath[];
      featureCells?: Set<string>;
      warnings: string[];
    }
  | { ok: false; message: string };

export interface GenerateRequest {
  terrains: TerrainColor[];
  grid: GridSpec;
  seed: number;
  options: Record<string, string>;
  /** Where the map sits in the bigger map (parent hex, neighbours). */
  context?: GenerationContext;
  /** A new region placed next to existing ones: learned generators solve
   *  against the neighbours' edges (generateConnected). */
  region?: NewRegion;
}

export interface TerrainGeneratorKind {
  id: string;
  label: string;
  description: string;
  /** Card text for a given palette, when it depends on what the palette
   *  has (Overland: no "coast" on a palette without a coast terrain).
   *  Falls back to `description`; see describeKind. */
  describe?(terrains: TerrainColor[]): string;
  source: "blank" | "built-in" | "learned";
  /** Map type that owns the generator (hidden when that type is off; see
   *  visibleKinds). Learned ones take it from their `map-kind` frontmatter. */
  mapKind?: MapKind;
  /** Only meaningful inside a parent hex (offered for submaps only). */
  needsContext?: boolean;
  /** Carries terrain on across the border of a neighbouring region it's
   *  placed next to (Overland via context edgeCells, learned generators
   *  via generateConnected). */
  continuesNeighbours?: boolean;
  options: ProcOption[];
  /** Can this generator produce terrain for a palette with these terrains? */
  fits(terrains: TerrainColor[]): boolean;
  generate(req: GenerateRequest): GenerateOutcome;
  /** For learned generators: the generator note (for "Open generator"). */
  generatorPath?: string;
  /** Turn generated paths into map path chains (drops unknown path types). */
  toChains(paths: GeneratedPath[]): { chains: { typeName: string; hexes: string[] }[]; missing: string[] };
}

export const BLANK_ID = "blank";

/**
 * The generator a submap starts on. A saved choice (the per-terrain submap
 * default) or one the user clicked stays; otherwise a submap of a hex with
 * terrain starts on the generator that zooms into that hex (Region detail)
 * instead of Blank, when it fits the palette (fresh-eyes r5).
 */
export function submapStartKind(
  fitting: Pick<TerrainGeneratorKind, "id" | "needsContext">[],
  current: string,
  opts: { parentTerrain?: string; savedGenerator?: string; picked?: boolean },
): string {
  if (current !== BLANK_ID || opts.picked || opts.savedGenerator || !opts.parentTerrain) return current;
  return fitting.find((k) => k.needsContext)?.id ?? current;
}

/** A generator card's text for this palette. */
export function describeKind(kind: TerrainGeneratorKind, terrains: TerrainColor[]): string {
  return kind.describe?.(terrains) ?? kind.description;
}

/**
 * The terrain a fresh map shows where nothing has been painted: the space
 * background on space palettes ("void" / "empty space"), otherwise none.
 */
export function suggestBaseTerrain(terrains: TerrainColor[]): string | undefined {
  return findTerrain(terrains, ["void", "empty space", "deep space"]);
}

function procGrid(plugin: HexmakerPlugin, grid: GridSpec): ProcGrid {
  return { ...grid, orientation: plugin.settings.hexOrientation };
}

export async function listGeneratorKinds(plugin: HexmakerPlugin): Promise<TerrainGeneratorKind[]> {
  const toChains = (paths: GeneratedPath[]) => toPathChains(plugin, paths);
  // Path types for generated routes/orbits. Fall back to the preset names:
  // the Space presets add these path types when they are installed, which
  // happens during map creation — before the paths are turned into chains.
  const pathTypeNamed = (re: RegExp, fallback: string) =>
    (plugin.settings.pathTypes ?? []).find((t) => re.test(t.name))?.name ?? fallback;
  const jumpRoute = pathTypeNamed(/jump route/i, "Jump route");
  const orbitPath = pathTypeNamed(/^orbit$/i, "Orbit");

  const builtIn: TerrainGeneratorKind[] = [
    {
      id: BLANK_ID,
      label: "Blank",
      description: "An empty map to paint by hand.",
      source: "blank",
      options: [],
      fits: () => true,
      generate: () => ({ ok: true, cells: new Map(), paths: [], warnings: [] }),
      toChains,
    },
    {
      id: STAR_SCATTER_ID,
      label: "Star scatter",
      mapKind: "space",
      description: "Sector chart: each hex rolls for a star system, typed by its main world; nebulae and jump routes.",
      source: "built-in",
      options: STAR_SCATTER_OPTIONS,
      fits: starScatterOffered,
      generate: (req) => {
        const r = starScatter(req.terrains, procGrid(plugin, req.grid), req.seed, req.options, jumpRoute);
        return r.cells.size ? { ok: true, ...r } : { ok: false, message: r.warnings[0] ?? "Nothing generated." };
      },
      toChains,
    },
    {
      id: ORBITS_ID,
      label: "Orbits",
      mapKind: "space",
      description: "Star system: a star at the centre, planets on rings by zone, belts, moons, starport and jump point.",
      source: "built-in",
      options: ORBITS_OPTIONS,
      fits: orbitsFits,
      generate: (req) => {
        const r = orbits(req.terrains, procGrid(plugin, req.grid), req.seed, req.options, orbitPath, req.context);
        return r.cells.size ? { ok: true, ...r } : { ok: false, message: r.warnings[0] ?? "Nothing generated." };
      },
      toChains,
    },
    {
      id: REGION_DETAIL_ID,
      label: "Region detail",
      mapKind: "world",
      needsContext: true,
      description: "Zoom into the parent hex: its terrain fills the map, and each neighbour shapes its edge (sea to the east → coast on the east).",
      source: "built-in",
      options: REGION_DETAIL_OPTIONS,
      fits: planetSurfaceFits,
      generate: (req) => {
        const r = planetSurface(req.terrains, procGrid(plugin, req.grid), req.seed, req.options, req.context ?? {});
        return r.cells.size ? { ok: true, ...r } : { ok: false, message: r.warnings[0] ?? "Nothing generated." };
      },
      toChains,
    },
    {
      id: OVERLAND_ID,
      label: "Overland",
      // Planet surface's noise generator under a world name, so world-only
      // users get a procedural map without seeing space options.
      mapKind: "world",
      description: "A region from noise: sea, land and high ground from whatever terrains your palette has. One climate across the map; set water %, climate and which side the sea is on. Next to another map, it carries on from that map's edge.",
      describe: overlandDescription,
      source: "built-in",
      continuesNeighbours: true,
      options: OVERLAND_OPTIONS,
      fits: planetSurfaceFits,
      generate: (req) => {
        // Only a neighbouring region's border (edgeCells) is used, not a parent hex.
        const edge = req.context?.edgeCells?.size ? { edgeCells: req.context.edgeCells } : undefined;
        const r = planetSurface(req.terrains, procGrid(plugin, req.grid), req.seed, req.options, edge, "overland");
        return r.cells.size ? { ok: true, ...r } : { ok: false, message: r.warnings[0] ?? "Nothing generated." };
      },
      toChains,
    },
    {
      id: PLANET_SURFACE_ID,
      label: "Planet surface",
      // Space: made for the planets of a star system (System palette submap
      // defaults). Offered there — and to space users — but not on a plain
      // fantasy map, where Region detail / learned generators fit better.
      mapKind: "space",
      description: "Region map from noise: seas, coasts, plains, forests, hills, mountains, deserts, ice. Set water % and climate.",
      source: "built-in",
      options: PLANET_SURFACE_OPTIONS,
      fits: planetSurfaceFits,
      generate: (req) => {
        const r = planetSurface(req.terrains, procGrid(plugin, req.grid), req.seed, req.options);
        return r.cells.size ? { ok: true, ...r } : { ok: false, message: r.warnings[0] ?? "Nothing generated." };
      },
      toChains,
    },
  ];
  // Every generator, tagged with its map type: callers filter with
  // visibleKinds (they know the palette, the parent map and the current choice).
  const kinds = [...builtIn];

  for (const g of await listGenerators(plugin)) {
    kinds.push({
      id: `wfc:${g.file.path}`,
      label: g.file.basename,
      description: "Learned from a painted map.",
      source: "learned",
      mapKind: generatorMapKind(g.model.meta),
      options: [],
      generatorPath: g.file.path,
      continuesNeighbours: true,
      fits: (terrains) => generatorFitsPalette(g.model, terrains.map((t) => t.name)),
      generate: (req) => {
        const names = req.terrains.map((t) => t.name);
        const res = req.region
          ? generateConnected(plugin, g.model, names, req.region, req.seed)
          : generateTerrain(plugin, g.model, names, req.grid, req.seed);
        if (!res.ok) return { ok: false, message: res.message };
        return { ok: true, cells: res.cells, paths: res.paths, featureCells: res.featureCells, warnings: res.warnings };
      },
      toChains: (paths) => toPathChains(plugin, paths, g.model),
    });
  }
  return kinds;
}

/**
 * Generators to offer: those whose map type is on, space ones on a space
 * map (`spaceContext`), and the current/saved choice (`selectedId`).
 */
export function visibleKinds(
  kinds: TerrainGeneratorKind[],
  settings: { mapKinds?: string[] },
  spaceContext: boolean,
  selectedId?: string,
): TerrainGeneratorKind[] {
  return kinds.filter((k) => isGeneratorShown(settings, k.mapKind, { spaceContext, selected: k.id === selectedId }));
}

/**
 * Generator a first map starts with (setup wizard): Overland for world
 * users, Star scatter for space-only users — whichever of the two fits the
 * palette, in that order of preference — else Blank.
 */
export function firstMapGenerator(fitting: { id: string }[], mapKinds: Iterable<string>): string {
  const kinds = new Set(mapKinds);
  const prefs = kinds.has("world") ? [OVERLAND_ID, STAR_SCATTER_ID] : [STAR_SCATTER_ID, OVERLAND_ID];
  return prefs.find((id) => fitting.some((k) => k.id === id)) ?? BLANK_ID;
}

/**
 * Everything a generator run depends on, as one string: when a preview's
 * key matches the create-time key, the previewed outcome is what gets
 * created (no second run that could differ). Option order doesn't matter.
 */
export function generationKey(req: {
  generatorId: string;
  options: Record<string, string>;
  seed: number;
  cols: number;
  rows: number;
  orientation: string;
  stagger: string;
  palette: string;
  /** Anything else the run reads (neighbour, parent hex…). */
  extra?: string;
}): string {
  const opts = Object.keys(req.options).sort().map((k) => [k, req.options[k]]);
  return JSON.stringify([req.generatorId, opts, req.seed, req.cols, req.rows, req.orientation, req.stagger, req.palette, req.extra ?? ""]);
}

/**
 * Generators usable with a palette, Blank first. Parent-hex-only ones
 * (Region detail: "zoom into the parent hex") need `hasParentHex` — a
 * submap. A map placed next to a neighbour has context too, but no parent
 * hex, so they're not offered there.
 */
export function kindsForPalette(
  kinds: TerrainGeneratorKind[],
  terrains: TerrainColor[],
  hasParentHex = false,
): TerrainGeneratorKind[] {
  return kinds.filter((k) => k.fits(terrains) && (hasParentHex || !k.needsContext));
}

/**
 * Order generators for a map placed next to a neighbour: Blank, then those
 * that carry on from its edge (built-in first), then the rest. Stable.
 */
export function neighbourFirst<K extends Pick<TerrainGeneratorKind, "id" | "source" | "continuesNeighbours">>(kinds: K[]): K[] {
  const rank = (k: K) => (k.id === BLANK_ID ? 0 : k.continuesNeighbours ? (k.source === "built-in" ? 1 : 2) : 3);
  return kinds.map((k, i) => ({ k, i })).sort((a, b) => rank(a.k) - rank(b.k) || a.i - b.i).map(({ k }) => k);
}

/**
 * The generator a new map / submap starts on, from those offered: a submap
 * zooms into its parent hex (Region detail); a map next to a neighbour
 * carries on from its edge; otherwise the first built-in one; else Blank.
 */
export function defaultGeneratorFor(
  fitting: Pick<TerrainGeneratorKind, "id" | "source" | "needsContext" | "continuesNeighbours">[],
  where: { parentHex?: boolean; neighbour?: boolean },
): string {
  if (where.parentHex) {
    const zoom = fitting.find((k) => k.needsContext);
    if (zoom) return zoom.id;
  }
  if (where.neighbour) {
    const cont = neighbourFirst(fitting.filter((k) => k.id !== BLANK_ID && k.continuesNeighbours))[0];
    if (cont) return cont.id;
  }
  return fitting.find((k) => k.source === "built-in")?.id ?? BLANK_ID;
}

/**
 * Notes-on-use: should a generated or painted terrain create/update the hex
 * note? Not when it's the map's base terrain and the hex has no note yet —
 * an absent note already renders as the base terrain.
 */
export function shouldWriteCell(plugin: HexmakerPlugin, mapName: string, key: string, terrain: string): boolean {
  const base = plugin.getMap(mapName)?.baseTerrain;
  if (!base || terrain !== base) return true;
  const [x, y] = key.split("_").map(Number);
  return plugin.app.vault.getAbstractFileByPath(plugin.hexPath(x, y, mapName)) !== null;
}
