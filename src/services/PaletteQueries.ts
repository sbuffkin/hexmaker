/**
 * The palettes as the rest of the plugin asks for them: by name (installed
 * or a preset), per map (its palette, terrains and path types), the
 * terrains of every palette, submap defaults, and installing presets or
 * the default palettes. Split from HexmakerPlugin (plan-architecture-
 * refactor L1a); the plugin keeps one-line delegations.
 */
import { Notice } from "obsidian";
import {
  DEFAULT_PATH_TYPES,
  DEFAULT_SETTINGS,
} from "../constants";
import { clonePalette, missingDefaults } from "../palettes/PaletteStore";
import { fillPalettePathTypes } from "../migrations/v1.5-palette-path-types";
import { paletteKind, type MapKind } from "../mapKinds";
import { defaultPaletteFor } from "../palettes/paletteOptions";
import {
  getPreset,
  presetToPalette,
  uniquePaletteName,
} from "../palettes/presets";
import { clonePathTypes } from "../palettes/pathTypeTable";
import type {
  MapData,
  PathType,
  SubmapDefault,
  TerrainColor,
  TerrainPalette,
} from "../types";
import type HexmakerPlugin from "../HexmakerPlugin";

/** What PaletteQueries uses of the plugin. */
export type PaletteHost = Pick<HexmakerPlugin, "ensureTablesForNewTerrains" | "getMap" | "getPaletteByName" | "getPathTypes" | "installPalettePreset" | "mapPaletteName" | "missingDefaultPalettes" | "saveSettings" | "settings" | "submapDefaultFor">;

export class PaletteQueries {
  constructor(private readonly plugin: PaletteHost) {}

  getPaletteByName(name: string): TerrainPalette | undefined {
    return this.plugin.settings.terrainPalettes.find((p) => p.name === name);
  }

  /**
   * Terrains for an installed palette, or for a built-in preset that isn't
   * installed yet (lets new-map dropdowns preview presets before install).
   */
  getPaletteOrPresetTerrains(name: string): TerrainColor[] {
    return this.plugin.getPaletteByName(name)?.terrains ?? getPreset(name)?.terrains ?? [];
  }

  /** The map type of a palette (or a preset not installed yet): see paletteKind. */
  getPaletteOrPresetKind(name: string): MapKind {
    return paletteKind(this.plugin.getPaletteByName(name) ?? getPreset(name));
  }

  /**
   * Path types maps on this palette can draw, in picker order: the palette's
   * own list (the live array, so editors can change it in place), a preset's
   * when it isn't installed, else the old plugin-wide list or Road and River.
   */
  getPathTypes(paletteName: string | undefined): PathType[] {
    const pal = paletteName ? this.plugin.getPaletteByName(paletteName) : this.plugin.settings.terrainPalettes[0];
    const fallback = this.plugin.settings.pathTypes?.length ? this.plugin.settings.pathTypes : DEFAULT_PATH_TYPES;
    if (pal) return (pal.pathTypes ??= clonePathTypes(fallback));
    return (paletteName ? getPreset(paletteName)?.pathTypes : undefined) ?? fallback;
  }

  /** The palette a map actually uses: its own when installed, else the first. */
  mapPaletteName(mapName: string | undefined): string {
    const map = mapName ? this.plugin.getMap(mapName) : undefined;
    if (map?.paletteName && this.plugin.getPaletteByName(map.paletteName)) return map.paletteName;
    return this.plugin.settings.terrainPalettes[0]?.name ?? "";
  }

  /** Path types for a map: its palette's (see getPathTypes). */
  getMapPathTypes(mapName: string | undefined): PathType[] {
    return this.plugin.getPathTypes(this.plugin.mapPaletteName(mapName));
  }

  /** Maps whose palette is `paletteName` (see mapPaletteName). */
  mapsOnPalette(paletteName: string): MapData[] {
    return this.plugin.settings.maps.filter((m) => this.plugin.mapPaletteName(m.name) === paletteName);
  }

  /**
   * Add a copy of a built-in preset as a new palette (a unique name is chosen
   * if the preset's name is taken), with the preset's path types. Saves;
   * the palette note is written by the sync that follows. Returns the new
   * palette's name.
   */
  async installPalettePreset(presetName: string, asName?: string, opts: { quiet?: boolean } = {}): Promise<string | undefined> {
    const preset = getPreset(presetName);
    if (!preset) return undefined;
    const name = uniquePaletteName(
      asName ?? preset.name,
      this.plugin.settings.terrainPalettes.map((p) => p.name),
    );
    const palette = presetToPalette(preset, name);
    this.plugin.settings.terrainPalettes.push(palette);
    await this.plugin.saveSettings();
    // Give the new terrains their description/encounters tables when the
    // vault uses terrain tables, so a submap's hexes get an encounters
    // table like the parent's (round 7: a system map installed "Space -
    // System" and its "ice planet" hex showed Encounters Table "None").
    await this.plugin.ensureTablesForNewTerrains();
    // Installed on first use by a new map: expected, so no notice (F12).
    if (!opts.quiet) new Notice(`Added palette "${name}".`);
    return name;
  }

  /**
   * Palette to pre-select for a new submap of `parentMap`: the parent
   * palette's `childPalette` (its note's `child-palette`; the preset's only
   * while that preset isn't installed), else the parent's own palette, else
   * the palette for new maps. An installed palette is never topped up from
   * a same-named preset: clearing its child palette means none.
   */
  childPaletteFor(parentMap: string): string {
    const parentPaletteName = this.plugin.getMap(parentMap)?.paletteName;
    const parentPalette = parentPaletteName ? this.plugin.getPaletteByName(parentPaletteName) : undefined;
    const child = parentPalette
      ? parentPalette.childPalette
      : parentPaletteName ? getPreset(parentPaletteName)?.childPalette : undefined;
    if (child && (this.plugin.getPaletteByName(child) || getPreset(child))) return child;
    if (parentPalette) return parentPalette.name;
    return defaultPaletteFor(this.plugin.settings);
  }

  /**
   * Saved setup for a new submap made from a `terrain` hex on `parentMap`:
   * the parent palette's Submap defaults row for that terrain (from its
   * note). Only a preset that isn't installed answers from its own rows;
   * palettes installed before their preset gained defaults got the rows
   * copied in once (PaletteStore, `paletteDataUpgraded`), so a row the user
   * deletes stays deleted.
   */
  submapDefaultFor(parentMap: string, terrain: string | null | undefined): SubmapDefault | undefined {
    if (!terrain) return undefined;
    const paletteName = this.plugin.getMap(parentMap)?.paletteName;
    if (!paletteName) return undefined;
    const pal = this.plugin.getPaletteByName(paletteName);
    if (pal) return pal.submapDefaults?.[terrain];
    return getPreset(paletteName)?.submapDefaults?.[terrain];
  }

  /**
   * Remember (or forget) choices for new submaps of `terrain` on the parent
   * map's palette. `set` fields are stored; `clear` fields are removed.
   * Saved into the palette note's Submap defaults table by the sync.
   */
  async saveSubmapDefault(
    parentMap: string,
    terrain: string,
    set: SubmapDefault,
    clear: (keyof SubmapDefault)[],
  ): Promise<void> {
    const paletteName = this.plugin.getMap(parentMap)?.paletteName;
    const pal = paletteName ? this.plugin.getPaletteByName(paletteName) : undefined;
    if (!pal) return;
    // Start from what the user currently sees (see submapDefaultFor).
    const current: SubmapDefault = { ...(this.plugin.submapDefaultFor(parentMap, terrain) ?? {}) };
    for (const k of clear) delete current[k];
    Object.assign(current, set);
    const defaults = { ...(pal.submapDefaults ?? {}) };
    if (Object.keys(current).length) defaults[terrain] = current;
    else delete defaults[terrain];
    if (Object.keys(defaults).length) pal.submapDefaults = defaults;
    else delete pal.submapDefaults;
    await this.plugin.saveSettings();
  }

  /** The built-in default palettes (a fresh install's) that aren't in the palette list. */
  missingDefaultPalettes(): string[] {
    return missingDefaults(this.plugin.settings.terrainPalettes, DEFAULT_SETTINGS.terrainPalettes).map((p) => p.name);
  }

  /**
   * Put back the default palettes that aren't there (only ever on request:
   * palettes the user deleted stay deleted). Returns the names added.
   */
  async addDefaultPalettes(): Promise<string[]> {
    const add = this.plugin.missingDefaultPalettes();
    for (const p of missingDefaults(this.plugin.settings.terrainPalettes, DEFAULT_SETTINGS.terrainPalettes)) {
      this.plugin.settings.terrainPalettes.push(clonePalette(p));
    }
    if (!add.length) return add;
    // Same as a fresh install's: path types from the shipped list.
    fillPalettePathTypes(this.plugin.settings.terrainPalettes, this.plugin.settings.pathTypes);
    await this.plugin.saveSettings();
    await this.plugin.ensureTablesForNewTerrains();
    new Notice(`Added ${add.join(" and ")}.`);
    return add;
  }

  /** Install `name` from the presets if no palette by that name exists yet. */
  async ensurePaletteInstalled(name: string): Promise<void> {
    if (this.plugin.getPaletteByName(name) || !getPreset(name)) return;
    // A new map installing its palette is expected: no notice (F12).
    await this.plugin.installPalettePreset(name, undefined, { quiet: true });
  }

  getMapPalette(mapName: string): TerrainColor[] {
    const map = this.plugin.getMap(mapName);
    return (
      this.plugin.getPaletteByName(map?.paletteName ?? "")?.terrains ??
      this.plugin.settings.terrainPalettes[0]?.terrains ??
      []
    );
  }

  getAllTerrains(): TerrainColor[] {
    const seen = new Set<string>();
    const result: TerrainColor[] = [];
    for (const pal of this.plugin.settings.terrainPalettes) {
      for (const t of pal.terrains) {
        if (!seen.has(t.name)) {
          seen.add(t.name);
          result.push(t);
        }
      }
    }
    return result;
  }
}
