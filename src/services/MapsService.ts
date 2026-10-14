/**
 * The map list and the links between maps: finding, creating, naming,
 * restoring and removing maps, submap / region links and what a map
 * inherits from the maps above it. Split from HexmakerPlugin (plan-
 * architecture-refactor L1a); the plugin keeps one-line delegations.
 */
import { Notice, TFile, TFolder } from "obsidian";
import { noticeUpgrade } from "../ui/notify";
import { HexMapView } from "../hex-map/HexMapView";
import {
  DEFAULT_PALETTE_NAME,
  VIEW_TYPE_HEX_MAP,
} from "../constants";
import { defaultPaletteFor } from "../palettes/paletteOptions";
import { normalizeFolder, slugify } from "../utils";
import type {
  MapData,
} from "../types";
import { pluginVersion } from "../compat";
import { workModeOf, type ModeAction, type WorkMode } from "../workMode";
import { inheritedRoleTables, type RoleTablePick } from "../worldgen/tableSources";
import { NAMES_ROLE, type RoleId } from "../worldgen/tableRoles";
import { rollMapName } from "../maps/mapNames";
import { effectiveTerrainType } from "../terrainTypes";
import type { FiredEvent } from "../arrival/eventsLedger";
import { effectiveArrivalMode, type ArrivalMode } from "../arrival/arrival";
import {
  addLocationPatch,
  applyRegionSettingsEdit,
  hexChildMaps,
  regionMapAt,
  regionsLocked,
  removeMapPatch,
  renameMapPatch,
  setRegionPatch,
} from "../maps/submaps";
import type { RegionSettings } from "../types";
import { displayNameFor, mapLabel } from "../maps/mapTree";
import type HexmakerPlugin from "../HexmakerPlugin";

/** What MapsService uses of the plugin. */
export type MapsHost = Pick<HexmakerPlugin, "app" | "manifest" | "ensureOverworldBiomes" | "ensurePaletteInstalled" | "events" | "getMap" | "getMapPalette" | "mapLabel" | "mapStore" | "parentOf" | "refreshHexMap" | "roleTablesFor" | "saveSettings" | "settings" | "syncMapCoordAliases" | "tableNotes" | "undoBook">;

/** What a new map is made with (createNewMap). */
export interface NewMapOptions {
  /** The name as typed (the folder is its slug, unless `slug`). */
  name: string;
  cols: number;
  rows: number;
  /** Its palette (installed from the presets on first use). */
  palette: string;
  /** Grid offset (default 0, 0). */
  offset?: { x: number; y: number };
  stagger?: "odd" | "even";
  onProgress?: (done: number, total: number) => void;
  /** Optional generated terrain per hex, keyed "x_y". */
  terrain?: Map<string, string>;
  /** Terrain shown on unpainted hexes. Cells equal to it aren't
   *  written to the map note. Hex notes are created on use either way. */
  baseTerrain?: string;
  parent?: { map: string; hex: string };
  /** Silence the "generated N notes" notice (caller reports instead). */
  quiet?: boolean;
  /** Folder name (slug) to use instead of one made from the name (NAV2). */
  slug?: string;
  /** Hexes left to roll on arrival ("x_y" → table link), for the On arrival column. */
  arrivals?: Map<string, string>;
  /** Once rows the generator fired (SP6), written to the Events ledgers once the map exists. */
  events?: FiredEvent[];
}

export class MapsService {
  constructor(private readonly plugin: MapsHost) {}

  /** Show a map in the hex map view, opening the view if it isn't open. */
  async showMap(name: string): Promise<void> {
    let leaf = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP)[0];
    if (!leaf) {
      leaf = this.plugin.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE_HEX_MAP, active: true });
    }
    await this.plugin.app.workspace.revealLeaf(leaf);
    // Revealing loads a deferred tab, so this is the map view by now.
    if (leaf.view instanceof HexMapView) leaf.view.switchMapFromModal(name);
  }

  /**
   * Switch a map's work mode (saved as `mode:` in its map note). An open map
   * view showing it switches through its own setWorkMode (puts a locked tool
   * down, refreshes its bars); otherwise the map is just saved.
   */
  setMapWorkMode(mapName: string, mode: WorkMode): void {
    const map = this.plugin.getMap(mapName);
    if (!map) return;
    let viaView = false;
    for (const leaf of this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP)) {
      if (leaf.view instanceof HexMapView && leaf.view.activeMapName === mapName) {
        leaf.view.setWorkMode(mode);
        viaView = true;
      }
    }
    if (viaView || workModeOf(map) === mode) return;
    map.workMode = mode;
    void this.plugin.saveSettings();
  }

  async autoRegisterMapsFromVault(): Promise<void> {
    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
    if (!hexFolder) return;
    const root = this.plugin.app.vault.getAbstractFileByPath(hexFolder);
    if (!(root instanceof TFolder)) return;

    const registered = new Set(this.plugin.settings.maps.map((m) => m.name));
    const added: string[] = [];

    for (const child of root.children) {
      if (!(child instanceof TFolder)) continue;
      if (registered.has(child.name)) continue;

      // Infer grid bounds from hex note filenames (pattern: x_y.md)
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (const file of child.children) {
        if (!(file instanceof TFile)) continue;
        const m = file.basename.match(/^(-?\d+)_(-?\d+)$/);
        if (!m) continue;
        const x = parseInt(m[1]), y = parseInt(m[2]);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      const cols = isFinite(maxX) ? maxX - minX + 1 : 20;
      const rows = isFinite(maxY) ? maxY - minY + 1 : 16;
      const offsetX = isFinite(minX) ? minX : 0;
      const offsetY = isFinite(minY) ? minY : 0;
      const paletteName =
        this.plugin.settings.terrainPalettes[0]?.name ?? DEFAULT_PALETTE_NAME;

      this.plugin.settings.maps.push({
        name: child.name,
        paletteName,
        gridSize: { cols, rows },
        gridOffset: { x: offsetX, y: offsetY },
        pathChains: [],
      });
      added.push(child.name);
    }

    if (added.length === 0) return;

    if (!this.plugin.settings.defaultMap || !registered.has(this.plugin.settings.defaultMap)) {
      this.plugin.settings.defaultMap = added[0];
    }
    await this.plugin.saveSettings();
    noticeUpgrade(
      `auto-registered ${added.length} map${added.length > 1 ? "s" : ""} from vault: ${added.join(", ")}`,
    );
  }

  /** A map was renamed: every hex's Region map / Locations link to it follows. */
  async updateSubmapReferences(oldName: string, newName: string): Promise<void> {
    for (const m of this.plugin.settings.maps) {
      for (const [key, h] of [...this.plugin.mapStore.all(m.name)]) {
        const patch = renameMapPatch(h, oldName, newName);
        if (patch) this.plugin.mapStore.set(m.name, key, patch);
      }
    }
    this.noParentMaps.clear();
    // Children of the renamed map keep their breadcrumb.
    for (const m of this.plugin.settings.maps) {
      if (m.parent?.map === oldName) m.parent.map = newName;
    }
  }

  /**
   * Create hex notes for every (x, y) in the cartesian product of xs × ys,
   * skipping any that already exist on disk.  Returns the number of notes created.
   */
  /**
   * Restore a missing map (SM-DEL): its note is written back from the last
   * saved copy (see MapStore.restoreMissing). Says what it did.
   */
  async restoreMissingMap(name: string): Promise<boolean> {
    const r = await this.plugin.mapStore.restoreMissing(name);
    if ("error" in r) {
      new Notice(r.error);
      return false;
    }
    const how = r.source === "settings" ? " from its settings (no saved copy of its hexes was found)" : r.source === "note" ? " (its note was back)" : "";
    new Notice(`Restored map "${this.plugin.mapLabel(name)}"${how}.`);
    this.plugin.refreshHexMap();
    return true;
  }

  /**
   * Remove a map from the map list without touching files (a missing map's
   * folder is already gone). Links to it in other maps are dropped and its
   * regions and locations become top-level maps, as when deleting a map.
   */
  async removeMapEntry(name: string): Promise<void> {
    this.plugin.settings.maps = this.plugin.settings.maps.filter((m) => m.name !== name);
    if (this.plugin.settings.defaultMap === name) this.plugin.settings.defaultMap = this.plugin.settings.maps[0]?.name ?? "";
    this.plugin.mapStore.forgetMap(name);
    this.plugin.undoBook.forgetMap(name);
    for (const m of this.plugin.settings.maps) {
      for (const [key, h] of [...this.plugin.mapStore.all(m.name)]) {
        const patch = removeMapPatch(h, name);
        if (Object.keys(patch).length) this.plugin.mapStore.set(m.name, key, patch);
      }
      if (m.parent?.map === name) {
        delete m.parent;
        delete m.submapKind;
      }
    }
    for (const leaf of this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP)) {
      if (leaf.view instanceof HexMapView && leaf.view.activeMapName === name) leaf.view.activeMapName = this.plugin.settings.maps[0]?.name ?? "";
    }
    await this.plugin.saveSettings();
    this.plugin.refreshHexMap();
  }

  async createNewMap(opts: NewMapOptions): Promise<{ name: string } | { error: string }> {
    const { name: rawName, cols, rows, palette: paletteName, stagger: staggerOffset, onProgress, terrain: terrainAt } = opts;
    const initialX = opts.offset?.x ?? 0;
    const initialY = opts.offset?.y ?? 0;
    if (!rawName.trim()) return { error: "Enter a map name." };
    const name = slugify(opts.slug?.trim() || rawName);
    if (!name) return { error: opts.slug ? "Enter a folder name." : "Enter a map name." };
    if (this.plugin.settings.maps.some((r) => r.name === name))
      return { error: `Map "${name}" already exists.` };

    await this.plugin.ensurePaletteInstalled(paletteName);

    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
    const folderPath = hexFolder ? `${hexFolder}/${name}` : name;
    if (!this.plugin.app.vault.getAbstractFileByPath(folderPath)) {
      try {
        await this.plugin.app.vault.createFolder(folderPath);
      } catch { /* already exists */ }
    }

    // The slug names the folder; the name as typed is what the UI shows.
    const displayName = displayNameFor(rawName, name);
    this.plugin.settings.maps.push({
      name,
      ...(displayName ? { displayName } : {}),
      paletteName,
      gridSize: { cols, rows },
      gridOffset: { x: initialX, y: initialY },
      pathChains: [],
      staggerOffset,
      createdWith: pluginVersion(this.plugin),
      // The GM layer starts off on a new map (round 6 S7: it was on for a
      // tester who never turned it on). Maps without the key keep the old
      // "on" default, so existing maps don't change.
      showGmLayer: false,
      ...(opts.baseTerrain ? { baseTerrain: opts.baseTerrain } : {}),
      ...(opts.parent ? { parent: opts.parent } : {}),
    });
    await this.plugin.saveSettings();

    // Notes on use: a new map writes no hex notes — terrain goes into the
    // map note, and a hex note appears when the hex first gets content.
    const cells: [string, { terrain?: string; onArrival?: string }][] = [...(terrainAt ?? new Map<string, string>())]
      .filter(([, t]) => t && t !== opts.baseTerrain)
      .map(([k, t]): [string, { terrain?: string; onArrival?: string }] => [k, { terrain: t }]);
    for (const [k, table] of opts.arrivals ?? []) {
      const c = cells.find(([key]) => key === k);
      if (c) c[1].onArrival = table;
      else cells.push([k, { onArrival: table }]);
    }
    this.plugin.mapStore.setMany(name, cells);
    onProgress?.(cols * rows, cols * rows);
    await this.plugin.mapStore.flush();
    await this.plugin.events.record(name, opts.events);
    if (!opts.quiet) new Notice(`Created map "${displayName ?? name}".`);

    return { name };
  }

  getMap(name: string): MapData | undefined {
    return this.plugin.settings.maps.find((r) => r.name === name);
  }

  /** A map's name for the UI: its display name, else its slug (or `name` itself if unknown). */
  mapLabel(name: string): string {
    return mapLabel(this.plugin.getMap(name), name);
  }

  /**
   * Rename a map for display only: the folder, map note and every
   * reference keep the slug. Blank (or the slug itself) clears it.
   */
  async setMapDisplayName(name: string, typed: string): Promise<void> {
    const map = this.plugin.getMap(name);
    if (!map) return;
    const oldLabel = this.plugin.mapLabel(name);
    map.displayName = displayNameFor(typed, name);
    await this.plugin.saveSettings();
    await this.plugin.syncMapCoordAliases(name, oldLabel);
  }

  /**
   * Add `childMap` to the Locations of hex (x, y) on `parentMap` (K7: any
   * number per hex) and record the parent on the child map (first link
   * wins, so linking a shared map from a second hex doesn't move its
   * breadcrumb).
   */
  async linkSubmap(parentMap: string, x: number, y: number, childMap: string, action: ModeAction = "link-map"): Promise<void> {
    if (childMap === parentMap) return;
    const key = `${x}_${y}`;
    const patch = addLocationPatch(this.plugin.mapStore.get(parentMap, key), childMap);
    if (patch.locations && !this.plugin.mapStore.set(parentMap, key, patch, action)) return;
    this.noParentMaps.clear();
    const child = this.plugin.getMap(childMap);
    if (child && !child.parent) {
      child.parent = { map: parentMap, hex: key };
      child.submapKind = "location";
      await this.plugin.saveSettings();
    }
  }

  /**
   * Make `childMap` the Region map of hex (x, y) on `parentMap`: the child
   * becomes a region of it (its record is the truth; the hex mirrors it).
   * Refused when the hex already has another region (one per hex).
   */
  async linkRegion(parentMap: string, x: number, y: number, childMap: string): Promise<boolean> {
    const key = `${x}_${y}`;
    const other = regionMapAt(this.plugin.settings.maps, parentMap, key);
    if (childMap === parentMap || (other && other.name !== childMap)) return false;
    const child = this.plugin.getMap(childMap);
    if (!child) return false;
    child.parent = { map: parentMap, hex: key };
    child.submapKind = "region";
    this.plugin.mapStore.set(parentMap, key, setRegionPatch(this.plugin.mapStore.get(parentMap, key), childMap));
    this.noParentMaps.clear();
    await this.plugin.saveSettings();
    return true;
  }

  /**
   * Unlink `childMap` (or, without one, every map) from hex (x, y): its
   * region and/or locations. A child whose parent was this hex loses it.
   */
  async unlinkSubmap(parentMap: string, x: number, y: number, childMap?: string): Promise<void> {
    const key = `${x}_${y}`;
    const h = this.plugin.mapStore.get(parentMap, key);
    const names = childMap ? [childMap] : hexChildMaps(h);
    let changed = false;
    for (const n of names) {
      const patch = removeMapPatch(this.plugin.mapStore.get(parentMap, key), n);
      if (Object.keys(patch).length && !this.plugin.mapStore.set(parentMap, key, patch, "link-map")) continue;
      const child = this.plugin.getMap(n);
      if (child?.parent?.map === parentMap && child.parent.hex === key) {
        delete child.parent;
        // A region without its hex is just a map (it keeps its world slot).
        delete child.submapKind;
        changed = true;
      }
    }
    this.noParentMaps.clear();
    if (changed) await this.plugin.saveSettings();
  }

  /** Reorder the Locations of hex (x, y). */
  setHexLocations(parentMap: string, x: number, y: number, locations: string[]): void {
    this.plugin.mapStore.set(parentMap, `${x}_${y}`, { locations: locations.length ? locations : null }, "link-map");
  }

  /** Save region settings on `mapName` (fixed fields stay put while it has regions). */
  async setRegionSettings(mapName: string, next: RegionSettings): Promise<void> {
    const map = this.plugin.getMap(mapName);
    if (!map) return;
    const locked = regionsLocked(this.plugin.settings.maps, mapName);
    const first = !map.regions;
    map.regions = map.regions ? applyRegionSettingsEdit(map.regions, next, locked) : next;
    await this.plugin.saveSettings();
    // The first overworld: its biomes need the shipped biome notes (DJ-Q4).
    if (first) await this.plugin.ensureOverworldBiomes();
  }

  /**
   * The map `mapName` was opened from (as a region or location). Uses the
   * stored parent; for maps linked before parents were stored, scans the
   * hexes' Region map and Locations for it and remembers the first hit.
   */
  parentOf(mapName: string): { map: string; hex: string } | undefined {
    const map = this.plugin.getMap(mapName);
    if (!map) return undefined;
    if (map.parent && this.plugin.getMap(map.parent.map)) return map.parent;
    // Root maps have no parent; don't rescan the hex notes on every switch.
    if (this.noParentMaps.has(mapName)) return undefined;
    for (const m of this.plugin.settings.maps) {
      if (m.name === mapName) continue;
      for (const [key, h] of this.plugin.mapStore.all(m.name)) {
        if (h.regionMap !== mapName && !h.locations?.includes(mapName)) continue;
        map.parent = { map: m.name, hex: key };
        void this.plugin.saveSettings();
        return map.parent;
      }
    }
    this.noParentMaps.add(mapName);
    return undefined;
  }

  /**
   * Each generator role's table set on `mapName` or the nearest map above
   * it (Map properties → Tables, T11), with the map that set it.
   */
  roleTablesFor(mapName: string): Partial<Record<RoleId, RoleTablePick>> {
    return inheritedRoleTables(mapName, (m) => this.plugin.getMap(m)?.roleTables, (m) => this.plugin.parentOf(m)?.map);
  }

  /**
   * A name for a map made from hex `hexKey` of `parentMap`, rolled on the
   * Names table set there or on a map above it (the Names role), with the
   * hex's terrain and type as When context. Undefined with no table (the
   * caller uses the hex's terrain and coordinates). Seeded with `seed`.
   */
  rolledMapName(parentMap: string, hexKey: string, seed?: number): string | undefined {
    const link = this.plugin.roleTablesFor(parentMap)[NAMES_ROLE.id]?.link;
    if (!link) return undefined;
    const terrain = this.plugin.mapStore.get(parentMap, hexKey)?.terrain ?? this.plugin.getMap(parentMap)?.baseTerrain;
    const entry = terrain ? this.plugin.getMapPalette(parentMap).find((t) => t.name === terrain) : undefined;
    const type = entry ? effectiveTerrainType(entry) : undefined;
    return rollMapName(link, this.plugin.tableNotes.lookup(), {
      ...(terrain ? { terrain } : {}),
      ...(type ? { type } : {}),
      ...(seed !== undefined ? { seed } : {}),
    });
  }

  /** "When you arrive somewhere new" for `mapName`: its own setting, else the nearest map above it's, else off. */
  arrivalModeFor(mapName: string): { mode: ArrivalMode; from?: string } {
    return effectiveArrivalMode(mapName, (m) => this.plugin.getMap(m)?.arrivalMode, (m) => this.plugin.parentOf(m)?.map);
  }

  /** Maps whose parent scan came up empty this session (cleared on any link change). */
  private noParentMaps = new Set<string>();

  getOrCreateMap(name: string): MapData {
    let r = this.plugin.getMap(name);
    if (!r) {
      r = {
        name,
        paletteName: defaultPaletteFor(this.plugin.settings),
        gridSize: { cols: 20, rows: 16 },
        gridOffset: { x: 0, y: 0 },
        pathChains: [],
      };
      this.plugin.settings.maps.push(r);
    }
    return r;
  }
}
