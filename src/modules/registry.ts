/**
 * The module registry: the questions the core asks instead of branching
 * on a module by name ("which map types are there?", "which icon packs?",
 * "which terrain types does this add?"). Answers come from the modules'
 * data, in registry order (the order of MODULES in src/modules/index.ts).
 *
 * Pure: no Obsidian imports, and no imports of core runtime code (the
 * registry sits under terrainTypes.ts, presets.ts and mapKinds.ts).
 */

import type {
  EngineDef,
  EngineRoleDef,
  HexmakerModule,
  IconPackDef,
  MapScaleDef,
  KindId,
  KindInfo,
  TableConditionDef,
  TerrainGroupDef,
  TerrainTypeDef,
} from "./types";
import type { PalettePreset } from "../palettes/presets";

export class ModuleRegistry {
  private readonly byKind = new Map<KindId, HexmakerModule>();

  constructor(readonly modules: readonly HexmakerModule[]) {
    const ids = new Set<string>();
    for (const m of modules) {
      if (ids.has(m.id)) throw new Error(`Hexmaker: module "${m.id}" registered twice`);
      ids.add(m.id);
      if (m.kind) {
        if (this.byKind.has(m.kind.id)) throw new Error(`Hexmaker: map type "${m.kind.id}" registered twice`);
        this.byKind.set(m.kind.id, m);
      }
    }
  }

  /** A module by id. */
  module(id: string): HexmakerModule | undefined {
    return this.modules.find((m) => m.id === id);
  }

  /** Every map type, in registry order. */
  kinds(): KindInfo[] {
    return this.modules.flatMap((m) => (m.kind ? [m.kind] : []));
  }

  kindIds(): KindId[] {
    return this.kinds().map((k) => k.id);
  }

  kindInfo(id: KindId | undefined): KindInfo | undefined {
    return id ? this.byKind.get(id)?.kind : undefined;
  }

  /** The module that provides map type `id`. */
  moduleOfKind(id: KindId | undefined): HexmakerModule | undefined {
    return id ? this.byKind.get(id) : undefined;
  }

  /** The map type a raw name means: an id or one of its aliases, any case ("Planet" → space). */
  kindId(raw: string | undefined): KindId | undefined {
    const v = raw?.trim().toLowerCase();
    if (!v) return undefined;
    return this.kinds().find((k) => k.id === v || (k.aliases ?? []).includes(v))?.id;
  }

  /** The map type palettes fall back to (none of their types belong to another, none declared). */
  fallbackKind(): KindId | undefined {
    return (this.kinds().find((k) => k.fallback) ?? this.kinds()[0])?.id;
  }

  /** Terrain types the modules add, in registry order. */
  terrainTypes(): TerrainTypeDef[] {
    return this.modules.flatMap((m) => [...(m.terrainTypes ?? [])]);
  }

  /**
   * The map type a module's terrain type belongs to (Space: "star" → space).
   * The core's land and water types belong to no module: they are shared
   * (CM5), so they never say which type a map is.
   */
  moduleTypeKind(typeId: string | undefined): KindId | undefined {
    return typeId ? this.terrainTypes().find((t) => t.id === typeId)?.kind : undefined;
  }

  /** Map types whose modules bring engine table roles. */
  kindsWithTableRoles(): KindId[] {
    return this.modules.flatMap((m) => (m.kind && m.tableRoles?.length ? [m.kind.id] : []));
  }

  /** Each module's one-time terrain type refinement, in registry order. */
  terrainTypeRefinements(): ((t: { name: string; type?: string }) => string | undefined)[] {
    return this.modules.flatMap((m) => (m.refineTerrainType ? [m.refineTerrainType] : []));
  }

  terrainGroups(): TerrainGroupDef[] {
    return this.modules.flatMap((m) => [...(m.terrainGroups ?? [])]);
  }

  /** Icon packs, with the map type whose module brings each (undefined: not a map type). */
  iconPacks(): (IconPackDef & { kind?: KindId })[] {
    return this.modules.flatMap((m) => (m.iconPack ? [{ ...m.iconPack, kind: m.kind?.id }] : []));
  }

  /** The pack an icon file belongs to, by prefix. */
  iconPackOf(icon: string): (IconPackDef & { kind?: KindId }) | undefined {
    return this.iconPacks().find((p) => icon.startsWith(p.prefix));
  }

  palettes(): PalettePreset[] {
    return this.modules.flatMap((m) => [...(m.palettes ?? [])]);
  }

  tableRoles(): EngineRoleDef[] {
    return this.modules.flatMap((m) => [...(m.tableRoles ?? [])]);
  }

  /** Engines the modules' generators run, in registry order. */
  engines(): (EngineDef & { module: string })[] {
    return this.modules.flatMap((m) => (m.engines ?? []).map((e) => ({ ...e, module: m.id })));
  }

  tableConditions(): TableConditionDef[] {
    return this.modules.flatMap((m) => [...(m.tableConditions ?? [])]);
  }

  /** Every module's map scales, in registry order. */
  mapScales(): MapScaleDef[] {
    return this.modules.flatMap((m) => [...(m.mapScales ?? [])]);
  }

  pathRoles(): Record<string, string> {
    return Object.assign({}, ...this.modules.map((m) => m.pathRoles ?? {})) as Record<string, string>;
  }
}
