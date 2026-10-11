/**
 * Modules (owner call CM1): pieces of Hexmaker that build on the core and
 * stay loosely coupled to it. A module hands the core what it adds as data
 * and callbacks; the core asks the registry (src/modules/registry.ts)
 * instead of branching on a module by name. Only src/modules/index.ts and
 * src/modules/runtime.ts import a module (tests/moduleBoundary.test.ts).
 *
 * A module is split in two so the import graph has no cycles:
 * - HexmakerModule (this file, `index.ts` of each module): plain data
 *   (map type, terrain types, icon pack, palettes, table roles). It imports
 *   types and pure data only, so any core file may read the registry.
 * - ModuleRuntime (`runtime.ts` of each module): what needs the plugin
 *   (generators, stores, settings, commands, one-time upgrades). Only the
 *   plugin and a few host-level services read it.
 *
 * Types only: no runtime code here.
 */

import type { PalettePreset } from "../palettes/presets";
import type { SubmapKind } from "../types";
import type { RowType } from "../random-tables/randomTable";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { GeneratedPath, TerrainGeneratorKind } from "../worldgen/registry";
import type { GridSpec } from "../worldgen/generators";
import type { ProcGrid } from "../worldgen/procedural/common";
import type { MapPath } from "../types";

/** A map type id ("world", "space"). Stable, never reused. */
export type KindId = string;

/**
 * What a link section is called on screen: the plural (headings, columns,
 * legend), one item ("Town: Gullmouth") and the noun for "Search or create
 * a town…".
 */
export interface SectionWords {
  label: string;
  one: string;
  noun: string;
}

export interface KindInfo {
  id: KindId;
  label: string;
  description: string;
  /**
   * Display names for link sections on maps of this type (G4b), keyed by
   * the section's heading ("Towns"). Display only.
   */
  sectionWords?: Partial<Record<string, SectionWords>>;
  /** The Region / Location card text on maps of this type (F10). */
  childKindText?: Record<SubmapKind, { title: string; desc: string }>;
  /** Other names a generator note's `map-kind:` may use for this type ("planet"). */
  aliases?: string[];
  /**
   * Its generators are offered on its own maps even while the type is off
   * (a planet submap of a star system still gets planet generators).
   */
  offerInContext?: boolean;
  /**
   * Generator-note tags (`map-kind:` values) offered only from a map made
   * by a generator with the same tag (Space: "planet" generators only on a
   * planet, when walking into a new region).
   */
  contextOnlyTags?: string[];
  /**
   * The type a palette counts as when none of its terrain types belong to
   * another type and it declares none (exactly one type says so).
   */
  fallback?: boolean;
  /**
   * Generators on this type's palettes carry a parent hex's or neighbour's
   * paths across the new map (default true). Space: false (a jump route
   * through a sector hex isn't a lane in the system).
   */
  carryContextPaths?: boolean;
  /** Terrain types a fresh map of this type shows where nothing is painted (Space: void). */
  baseTerrainTypes?: string[];
  /** Generator ids a first map of this type starts on, in order of preference. */
  firstGenerators?: string[];
  /** Icon pickers open on this type's icon pack when it's the only type on. */
  iconPackFirst?: boolean;
}

/** A terrain type a module adds to the core's land and water types. */
export interface TerrainTypeDef {
  id: string;
  label: string;
  kind: KindId;
  /** Type group (see terrainTypes.ts TERRAIN_GROUPS). */
  group: string;
  keywords: string[];
}

export interface TerrainGroupDef {
  id: string;
  label: string;
}

/** A bundled icon pack: a tab in icon pickers. */
export interface IconPackDef {
  id: string;
  label: string;
  /** Every icon file in the pack starts with this ("space-"). */
  prefix: string;
  /** [file name, data URL] in pack order. */
  icons: readonly (readonly [string, string])[];
  /** Keep the pack's own order when sorting icons (else by name). */
  keepOrder?: boolean;
  /** Sub-groups shown as chips in the picker, in order: [id, label]. */
  subgroups?: readonly (readonly [string, string])[];
  /** The sub-group of each icon in the pack. */
  subgroupOf?: ReadonlyMap<string, string>;
}

/** Engine table roles (plan-tables-everywhere §2.4); see worldgen/tableRoles.ts. */
export interface EngineRoleDef {
  id: string;
  /** The generator id that rolls on it. */
  engine: string;
  name: string;
  rows: RowType;
  terrainTypes: readonly string[];
  help: string;
  fallback: string;
}

/**
 * A key a random table's When column may use (plan-tables-everywhere §2.8):
 * how a module reads its value, checks it against what the roller knows,
 * and writes it back. The core keeps type and terrain.
 */
export interface TableConditionDef {
  /** The key, singular and lower case ("zone"). */
  key: string;
  /** Other words for it ("orbit"). */
  aliases?: string[];
  /** The cell's value read; undefined when it can't be (the row never fires). */
  read(value: string): unknown;
  /** Whether the read value fits what the roller knows for this key (only asked when it knows something). */
  fits(read: unknown, known: unknown): boolean;
  /** The read value back as text. */
  format(read: unknown): string;
}

/** An engine a module's generators run: its generator id and name. */
export interface EngineDef {
  id: string;
  label: string;
}

export interface HexmakerModule {
  /** Stable id: "world", "world-maps", "space". Never reused. */
  id: string;
  /** Release slice (release-slices.json); one module is one slice. */
  slice: string;
  /** Present: the module is a map type (Settings → Map types, the setup wizard). */
  kind?: KindInfo;
  terrainTypes?: readonly TerrainTypeDef[];
  terrainGroups?: readonly TerrainGroupDef[];
  iconPack?: IconPackDef;
  /** Palette presets (until content packs replace them). */
  palettes?: readonly PalettePreset[];
  /** Table roles of the engines this module's generators run. */
  tableRoles?: readonly EngineRoleDef[];
  /** Keys a random table's When column may use. */
  tableConditions?: readonly TableConditionDef[];
  /** Engines this module's generators run (the recipe `engine:` vocabulary). */
  engines?: readonly EngineDef[];
  /** Generator path roles: role id → option label ("routes" → "Path type for routes"). */
  pathRoles?: Readonly<Record<string, string>>;
  /** Data the module owns (release slicing derives its lists from these). */
  owns: {
    settingsKeys: readonly string[];
    mapNoteKeys: readonly string[];
    commands: readonly string[];
  };
}

// ── Runtime: what a module adds that needs the plugin ─────────────────────

/** What the core lends a module's generators. */
export interface GeneratorHelpers {
  /** Generated paths → anchored paths on the new map (generators.ts toMapPaths). */
  toPaths: (paths: GeneratedPath[], mapName: string, taken?: Iterable<string>) => { paths: MapPath[]; missing: string[] };
  /** The grid with the vault's hex orientation. */
  procGrid: (grid: GridSpec) => ProcGrid;
}

/** A built-in generator a module adds; `order` places it in the list (lower first). */
export interface GeneratorContribution extends TerrainGeneratorKind {
  order: number;
}

/**
 * The runtime half of a module (see the top of this file): host-bound
 * pieces, read only by the plugin and its services (src/modules/runtime.ts).
 */
export interface ModuleRuntime {
  /** The module's id (HexmakerModule.id). */
  id: string;
  /** Built-in generators (Star scatter, Overland…). */
  generators?(plugin: HexmakerPlugin, helpers: GeneratorHelpers): GeneratorContribution[];
}
