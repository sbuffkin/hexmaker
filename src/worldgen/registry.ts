import type HexmakerPlugin from "../HexmakerPlugin";
import type { TerrainColor } from "../types";
import {
  generateTerrain,
  generatorFitsPalette,
  listGenerators,
  toPathChains,
  type GridSpec,
} from "./generators";
import { findTerrain, type ProcGrid, type ProcOption } from "./procedural/common";
import { STAR_SCATTER_ID, STAR_SCATTER_OPTIONS, starScatter, starScatterFits } from "./procedural/starScatter";
import { ORBITS_ID, ORBITS_OPTIONS, orbits, orbitsFits } from "./procedural/orbits";
import {
  PLANET_SURFACE_ID,
  PLANET_SURFACE_OPTIONS,
  planetSurface,
  planetSurfaceFits,
} from "./procedural/planetSurface";
import { isKindEnabled, type MapKind } from "../mapKinds";

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
}

export interface TerrainGeneratorKind {
  id: string;
  label: string;
  description: string;
  source: "blank" | "built-in" | "learned";
  /** Map type that owns a built-in generator (hidden when that type is off). */
  mapKind?: MapKind;
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
      fits: starScatterFits,
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
        const r = orbits(req.terrains, procGrid(plugin, req.grid), req.seed, req.options, orbitPath);
        return r.cells.size ? { ok: true, ...r } : { ok: false, message: r.warnings[0] ?? "Nothing generated." };
      },
      toChains,
    },
    {
      id: PLANET_SURFACE_ID,
      label: "Planet surface",
      mapKind: "world",
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
  const kinds = builtIn.filter((k) => isKindEnabled(plugin.settings, k.mapKind));

  for (const g of await listGenerators(plugin)) {
    kinds.push({
      id: `wfc:${g.file.path}`,
      label: g.file.basename,
      description: "Learned from a painted map.",
      source: "learned",
      options: [],
      generatorPath: g.file.path,
      fits: (terrains) => generatorFitsPalette(g.model, terrains.map((t) => t.name)),
      generate: (req) => {
        const res = generateTerrain(plugin, g.model, req.terrains.map((t) => t.name), req.grid, req.seed);
        if (!res.ok) return { ok: false, message: res.message };
        return { ok: true, cells: res.cells, paths: res.paths, featureCells: res.featureCells, warnings: res.warnings };
      },
      toChains: (paths) => toPathChains(plugin, paths, g.model),
    });
  }
  return kinds;
}

/** Generators usable with a palette, Blank first. */
export function kindsForPalette(kinds: TerrainGeneratorKind[], terrains: TerrainColor[]): TerrainGeneratorKind[] {
  return kinds.filter((k) => k.fits(terrains));
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
