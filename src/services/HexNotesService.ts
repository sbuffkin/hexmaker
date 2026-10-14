/**
 * Hex notes (made on use from the template, with their properties, Map
 * data callout and encounter links), hex names and aliases, the Map data
 * callouts of hex, region and faction notes, and notes that follow a map
 * or region rename. Split from HexmakerPlugin (plan-architecture-refactor
 * L1a); the plugin keeps one-line delegations.
 */
import { Notice, TFile, TFolder } from "obsidian";
import { worldMaps } from "../modules/runtime";
import { normalizeFolder } from "../utils";
import { tokenMapValue } from "../frontmatter";
import { withMapLink } from "../maps/mapNote";
import { mapDataLines, mapDataSyncMessage, setMapData, shownValues, type HexMapDataView } from "../hexMapData";
import { syncHexMapData as syncHexMapDataWith, type CalloutSyncResult } from "../maps/calloutSync";
import { hasRegionMapData, regionUse, renameRegionInStore, renamedTokenMap, setRegionMapData, type RegionMapDataView } from "../regionMapData";
import { cleanHexName, coordAlias, swapMapCoordAliases, syncHexAliases } from "../maps/hexNames";
import {
  insertLinkInSection,
  appendSectionText,
} from "../sections";
import type HexmakerPlugin from "../HexmakerPlugin";

/** What HexNotesService uses of the plugin. */
export type HexNotesHost = HexmakerPlugin;

export class HexNotesService {
  constructor(private readonly plugin: HexNotesHost) {}

  /**
   * Check whether a TFile is a hex note (lives under the configured hex
   * folder, basename matches the `x_y` coord pattern). Used to gate the
   * structured hex export command.
   */
  isHexFile(file: TFile): boolean {
    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
    if (hexFolder && !file.path.startsWith(hexFolder + "/")) return false;
    return /^-?\d+_-?\d+$/.test(file.basename);
  }

  hexPath(x: number, y: number, mapName: string): string {
    const folder = normalizeFolder(this.plugin.settings.hexFolder);
    return folder
      ? `${folder}/${mapName}/${x}_${y}.md`
      : `${mapName}/${x}_${y}.md`;
  }

  /**
   * Name (or rename, or with "" unname) a hex. The name lives in the map
   * note; a hex that has a note also gets it as an alias, replacing the
   * previous name's alias and keeping any the user added.
   */
  async setHexName(mapName: string, x: number, y: number, raw: string): Promise<void> {
    const key = `${x}_${y}`;
    const name = cleanHexName(raw);
    const old = this.plugin.mapStore.get(mapName, key)?.name;
    if ((old ?? "") === name) return;
    this.plugin.mapStore.set(mapName, key, { name: name || null }, "edit-note");
    // The "<map> x, y" alias rides along (added if the note lacks it).
    const coord = this.plugin.hexCoordAlias(mapName, x, y);
    await syncHexAliases(this.plugin.app, this.plugin.hexPath(x, y, mapName), [
      { from: old, to: name },
      { from: coord, to: coord },
    ]);
  }

  /** A hex note's "<map display name> x, y" alias (NM2). */
  hexCoordAlias(mapName: string, x: number | string, y: number | string): string {
    return coordAlias(this.plugin.mapLabel(mapName), x, y);
  }

  /** A map's display name changed from `oldLabel`: swap the "<map> x, y" alias on its hex notes (hexNames.ts). */
  async syncMapCoordAliases(mapName: string, oldLabel: string): Promise<void> {
    await swapMapCoordAliases(this.plugin.app, this.plugin.mapStore.mapFolder(mapName), oldLabel, this.plugin.mapLabel(mapName));
  }

  /** Create a hex note from the configured template (or the built-in default). */
  async createHexNote(
    x: number,
    y: number,
    mapName: string,
    preloadedTemplate?: string,
    terrain?: string,
  ): Promise<TFile | null> {
    const path = this.plugin.hexPath(x, y, mapName);
    let content: string;

    if (preloadedTemplate !== undefined) {
      content = preloadedTemplate;
    } else {
      content = await this.plugin.loadHexTemplate();
    }

    content = content
      .replace(/\{\{x\}\}/g, String(x))
      .replace(/\{\{y\}\}/g, String(y))
      .replace(/\{\{title\}\}/g, `Hex ${x}, ${y}`)
      .replace(/\{\{map\}\}/g, mapName);
    // Map data lives in the map note: the hex note links there instead of
    // carrying (possibly stale) terrain/region fields.
    content = withMapLink(content, mapName);
    if (terrain) this.plugin.mapStore.set(mapName, `${x}_${y}`, { terrain });
    // Its terrain, area, icon and name as properties (MG4).
    content = this.plugin.hexProps.withProps(content, mapName, x, y, path);
    // The template's Map data callout shows what the map has for this hex.
    const mapDataView = this.plugin.hexMapDataView(mapName, x, y);
    const withMapData = setMapData(content, mapDataView);
    // Remember what it shows, so a later hand edit is told from a stale copy.
    if (withMapData !== content) this.plugin.calloutMemory.set(path, shownValues(mapDataLines(mapDataView)));
    content = withMapData;
    // The hex's terrain (just set, or painted before it had a note) gets
    // its encounter-table link now rather than patched in later.
    const encounterLink = this.plugin.terrainEncounterLinkFor(mapName, x, y, path);
    if (encounterLink) {
      content = insertLinkInSection(content, "Encounters Table", `[[${encounterLink}]]`);
    }
    // Likewise its area's table (painted before the hex had a note), so the
    // hex editor's Encounters list doesn't lose it when the note is made.
    const areaTable = this.plugin.areaEncounterTableFor(mapName, x, y);
    if (areaTable) {
      content = insertLinkInSection(content, "Encounters Table", `[[${this.plugin.app.metadataCache.fileToLinktext(areaTable, path)}]]`);
    }

    const hexBase = normalizeFolder(this.plugin.settings.hexFolder);
    const mapFolder = hexBase ? `${hexBase}/${mapName}` : mapName;
    if (!this.plugin.app.vault.getAbstractFileByPath(mapFolder)) {
      // Wrap in try/catch: a concurrent worker may have already created the folder.
      try {
        await this.plugin.app.vault.createFolder(mapFolder);
      } catch {
        /* exists */
      }
    }

    try {
      const file = await this.plugin.app.vault.create(path, content);
      // A named hex's note gets its name as an alias (X4), and every hex
      // note gets "<map> x, y" (NM2).
      const name = this.plugin.mapStore.get(mapName, `${x}_${y}`)?.name;
      await syncHexAliases(this.plugin.app, path, [
        { from: undefined, to: name },
        { from: undefined, to: this.plugin.hexCoordAlias(mapName, x, y) },
      ]);
      return file;
    } catch {
      // A concurrent worker may have created this file between our existence check and
      // this create call.  If the file now exists, use it rather than treating it as an error.
      const existing = this.plugin.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) return existing;
      new Notice("Could not create note at " + path);
      return null;
    }
  }

  /**
   * Append text to a section of a hex's note, creating the note first if
   * the hex has none (P2 "Add to this hex").
   */
  async appendToHexSection(x: number, y: number, mapName: string, section: string, text: string): Promise<void> {
    const path = this.plugin.hexPath(x, y, mapName);
    let file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) file = await this.plugin.createHexNote(x, y, mapName);
    if (!(file instanceof TFile)) throw new Error(`Could not create the note for hex ${x}, ${y}`);
    await this.plugin.app.vault.process(file, (content) => appendSectionText(content, section, text));
  }

  /** What the map has for a hex, for its note's Map data callout (src/hexMapData.ts). */
  hexMapDataView(mapName: string, x: number, y: number): HexMapDataView {
    const h = this.plugin.mapStore.get(mapName, `${x}_${y}`) ?? {};
    const ref = (m: string) => ({ map: m, label: this.plugin.mapLabel(m) });
    return {
      map: mapName, mapLabel: this.plugin.mapLabel(mapName), x, y, terrain: h.terrain, region: h.region, name: h.name,
      regionMap: h.regionMap ? ref(h.regionMap) : undefined,
      locations: h.locations?.length ? h.locations.map(ref) : undefined,
      biome: this.hexBiomeRef(mapName, `${x}_${y}`),
    };
  }

  /** An overworld hex's biome for its Map data callout (World maps), else nothing. */
  private hexBiomeRef(mapName: string, key: string): { label: string; note?: string } | undefined {
    return worldMaps()?.hexBiomeRef(this.plugin, mapName, key);
  }

  /**
   * Bring a hex note's Map data callout up to date with the map (or add one
   * when `insert`). Hand edits made inside the callout go to the map first
   * (phase 2, see `syncHexMapData`). Only writes when something changed; a
   * note without a callout is left alone unless `insert`. Returns whether
   * it wrote.
   */
  async refreshHexMapData(mapName: string, x: number, y: number, insert = false): Promise<boolean> {
    return (await this.plugin.syncHexMapData(mapName, x, y, { insert })).wrote;
  }

  /**
   * A hex note's Map data callout, both ways (phase 2): hand edits to
   * Terrain, Region or Name made since the plugin last wrote it go to the
   * map (through the work-mode gate, as one undo step), unless the map has
   * changed them since (the map is newer); then the callout is rewritten
   * to show the map. Edits that weren't applied stay in the callout as
   * "Not applied:" lines and lines it can't read as "Not read:" lines, and
   * a notice says so (unless `quiet`).
   */
  async syncHexMapData(
    mapName: string, x: number, y: number, opts: { insert?: boolean; quiet?: boolean } = {},
  ): Promise<CalloutSyncResult> {
    return syncHexMapDataWith(this.plugin, mapName, x, y, opts);
  }

  /** Add (or update) the Map data callout in every hex note of a map. Returns how many notes changed. */
  async addMapDataToHexNotes(mapName: string): Promise<number> {
    const hexBase = normalizeFolder(this.plugin.settings.hexFolder);
    const folder = this.plugin.app.vault.getAbstractFileByPath(hexBase ? `${hexBase}/${mapName}` : mapName);
    if (!(folder instanceof TFolder)) return 0;
    let n = 0;
    const totals = { applied: [] as string[], notApplied: [] as string[], unreadable: [] as string[] };
    for (const f of folder.children) {
      if (!(f instanceof TFile)) continue;
      const m = /^(-?\d+)_(-?\d+)\.md$/.exec(f.name);
      if (!m) continue;
      const r = await this.plugin.syncHexMapData(mapName, Number(m[1]), Number(m[2]), { insert: true, quiet: true });
      if (r.wrote) n++;
      totals.applied.push(...r.applied);
      totals.notApplied.push(...r.notApplied);
      totals.unreadable.push(...r.unreadable);
    }
    const msg = mapDataSyncMessage(this.plugin.mapLabel(mapName), totals);
    if (msg) new Notice(msg, 8000);
    return n;
  }

  // ── Region and faction notes (R1, R2) ────────────────────────────────────

  /** "region" / "faction" for a note in the regions / factions folder ("_" notes aren't). */
  regionOrFactionKind(file: TFile): "region" | "faction" | null {
    if (file.extension !== "md" || file.basename.startsWith("_")) return null;
    const inFolder = (setting: string) => {
      const folder = normalizeFolder(setting ?? "");
      return !!folder && file.path.startsWith(folder + "/");
    };
    if (inFolder(this.plugin.settings.regionsFolder)) return "region";
    if (inFolder(this.plugin.settings.factionsFolder)) return "faction";
    return null;
  }

  /** Every region and faction note. */
  regionAndFactionNotes(): TFile[] {
    return this.plugin.app.vault.getMarkdownFiles().filter((f) => this.plugin.regionOrFactionKind(f) !== null);
  }

  /** The maps that use a region or faction note, for its Map data callout. */
  regionMapDataView(file: TFile, kind: "region" | "faction"): RegionMapDataView {
    const maps = this.plugin.settings.maps.map((m) => ({ name: m.name, label: this.plugin.mapLabel(m.name) }));
    if (kind === "region") {
      const folder = normalizeFolder(this.plugin.settings.tablesFolder);
      const table = this.plugin.app.vault.getAbstractFileByPath(`${folder ? `${folder}/` : ""}regions/${file.basename}.md`);
      return {
        kind,
        maps: regionUse(file.basename, maps, (m) => this.plugin.mapStore.all(m).values()),
        encounterTable: table instanceof TFile ? this.plugin.app.metadataCache.fileToLinktext(table, file.path) : undefined,
      };
    }
    // Factions: hex notes that link the faction note, per map.
    const counts = new Map<string, number>();
    for (const [source, targets] of Object.entries(this.plugin.app.metadataCache.resolvedLinks)) {
      if (!targets[file.path]) continue;
      const loc = this.plugin.mapStore.resolve(source);
      if (loc) counts.set(loc.map, (counts.get(loc.map) ?? 0) + 1);
    }
    return {
      kind,
      maps: maps
        .filter((m, i) => counts.get(m.name) && maps.findIndex((o) => o.name === m.name) === i)
        .map((m) => ({ map: m.name, label: m.label, hexes: counts.get(m.name) ?? 0 })),
    };
  }

  /**
   * Bring a region or faction note's Map data callout up to date (or add
   * one when `insert`). Only writes when something changed. Returns
   * whether it wrote.
   */
  async refreshRegionMapData(file: TFile, insert = false): Promise<boolean> {
    const kind = this.plugin.regionOrFactionKind(file);
    if (!kind || !this.plugin.mapStore.isReady()) return false;
    const current = await this.plugin.app.vault.read(file);
    if (!insert && !hasRegionMapData(current)) return false;
    const view = this.plugin.regionMapDataView(file, kind);
    // Read first: most notes need nothing, and a no-op process() still writes.
    if (setRegionMapData(current, view, insert) === current) return false;
    let wrote = false;
    await this.plugin.app.vault.process(file, (content) => {
      const next = setRegionMapData(content, view, insert);
      wrote = next !== content;
      return next;
    });
    return wrote;
  }

  /** Add or update the Map data callout in every region and faction note. Returns how many changed. */
  async updateRegionFactionMapData(): Promise<number> {
    await this.plugin.mapStore.flush();
    let n = 0;
    for (const f of this.plugin.regionAndFactionNotes()) {
      if (await this.plugin.refreshRegionMapData(f, true)) n++;
    }
    return n;
  }

  /**
   * A region note was renamed: hexes whose Region named it follow, through
   * the map store (the map notes are rewritten from it). Returns how many
   * hexes changed.
   */
  renameRegionInMaps(oldName: string, newName: string): number {
    return renameRegionInStore(this.plugin.mapStore, this.plugin.settings.maps.map((m) => m.name), oldName, newName);
  }

  /** A map was renamed: tokens placed on it (`token-map`) follow. Returns how many notes changed. */
  async updateTokenMapReferences(oldName: string, newName: string): Promise<number> {
    let n = 0;
    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      if (file.basename.startsWith("_")) continue;
      const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || renamedTokenMap(fm["token-map"], oldName, newName) === null) continue;
      await this.plugin.app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
        const next = renamedTokenMap(front["token-map"], oldName, newName);
        // An old plain name becomes a link to the map note (NF3); a link keeps its form.
        if (next !== null) front["token-map"] = next === newName ? tokenMapValue(newName) : next;
      });
      n++;
    }
    return n;
  }

  /**
   * Set terrain for specific hexes ("x_y" → terrain). With map notes this
   * writes map data only — hex notes are created when a hex gets content —
   * so it returns 0 notes created. Falls back to creating notes only if the
   * map store isn't ready yet.
   */
  async generateHexNotesAt(
    mapName: string,
    cells: [string, string][],
    onProgress?: (done: number) => void,
  ): Promise<number> {
    if (this.plugin.mapStore.isReady()) {
      this.plugin.mapStore.setMany(mapName, cells.filter(([, t]) => t).map(([k, t]) => [k, { terrain: t }]));
      onProgress?.(cells.length);
      await this.plugin.mapStore.flush();
      return 0;
    }
    const template = await this.plugin.loadHexTemplate();
    if (template === null) return 0;
    let created = 0;
    let done = 0;
    const CHUNK = 20;
    for (let i = 0; i < cells.length; i += CHUNK) {
      await Promise.all(
        cells.slice(i, i + CHUNK).map(async ([key, terrain]) => {
          const [x, y] = key.split("_").map(Number);
          if (!this.plugin.app.vault.getAbstractFileByPath(this.plugin.hexPath(x, y, mapName))) {
            if (await this.plugin.createHexNote(x, y, mapName, template, terrain)) created++;
          }
          done++;
        }),
      );
      onProgress?.(done);
    }
    return created;
  }

  async generateHexNotes(
    mapName: string,
    xs: number[],
    ys: number[],
    onProgress?: (done: number) => void,
    terrainAt?: Map<string, string>,
  ): Promise<number> {
    if (this.plugin.mapStore.isReady()) {
      const cells: [string, string][] = [];
      for (const x of xs) for (const y of ys) {
        const t = terrainAt?.get(`${x}_${y}`);
        if (t) cells.push([`${x}_${y}`, t]);
      }
      if (cells.length) return this.plugin.generateHexNotesAt(mapName, cells);
      onProgress?.(xs.length * ys.length);
      return 0;
    }
    // Read template once — avoids N vault reads for the same file
    const template = await this.plugin.loadHexTemplate();
    if (template === null) return 0;

    let created = 0;
    let done = 0;
    const CHUNK = 20;
    const pairs: [number, number][] = [];
    for (const x of xs) for (const y of ys) pairs.push([x, y]);
    for (let i = 0; i < pairs.length; i += CHUNK) {
      await Promise.all(
        pairs.slice(i, i + CHUNK).map(async ([x, y]) => {
          const path = this.plugin.hexPath(x, y, mapName);
          if (!this.plugin.app.vault.getAbstractFileByPath(path)) {
            const terrain = terrainAt?.get(`${x}_${y}`);
            // createHexNote writes the terrain and its encounter link in one go.
            if (await this.plugin.createHexNote(x, y, mapName, template, terrain)) created++;
          }
          done++;
        }),
      );
      onProgress?.(done);
    }
    return created;
  }

  /**
   * How a back-link to a hex note reads: the hex's name, else
   * "<map> x, y" (round 6 S2). Paths outside the hex folder fall back to
   * the note's name.
   */
  hexLinkAlias(hexPath: string): string {
    const folder = normalizeFolder(this.plugin.settings.hexFolder);
    const rel = folder && hexPath.startsWith(folder + "/") ? hexPath.slice(folder.length + 1) : hexPath;
    const m = /^(.+)\/(-?\d+)_(-?\d+)\.md$/.exec(rel);
    if (!m) return rel.replace(/^.*\//, "").replace(/\.md$/i, "");
    const [, map, x, y] = m;
    const name = this.plugin.mapStore.get(map, `${x}_${y}`)?.name?.trim();
    return name || `${this.plugin.mapLabel(map)} ${x}, ${y}`;
  }
}
