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
   * The type a palette counts as when none of its terrain types belong to
   * another type and it declares none (exactly one type says so).
   */
  fallback?: boolean;
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
  /** Generator path roles: role id → option label ("routes" → "Path type for routes"). */
  pathRoles?: Readonly<Record<string, string>>;
  /** Data the module owns (release slicing derives its lists from these). */
  owns: {
    settingsKeys: readonly string[];
    mapNoteKeys: readonly string[];
    commands: readonly string[];
  };
}
