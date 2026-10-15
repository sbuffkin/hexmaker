/**
 * The tables the plugin keeps for terrains and areas: each terrain's
 * description / encounters tables (made empty for new terrains, HG5; moved
 * or copied on rename), the area encounter tables, the shipped tables,
 * roller blocks, the encounter-table links in hex notes, and renaming a
 * terrain everywhere. Split from HexmakerPlugin (plan-architecture-
 * refactor L1c); the plugin keeps one-line delegations.
 */
import { Notice, TFile } from "obsidian";
import { locateRollTable, withRollerBlock } from "../random-tables/randomTable";
import { processTableNote } from "../random-tables/TableStore";
import { enabledKinds, newTerrains, terrainsForTables } from "../mapKinds";
import { registry } from "../modules";
import { normalizeFolder, makeTableTemplate } from "../utils";
import { shippedTablesToInstall } from "../random-tables/shippedTables";
import type {
  TerrainColor,
} from "../types";
import { writeJsonBackup } from "../backup";
import { getTerrainFromFile, getHexRegionFromFile } from "../frontmatter";
import { migrate as migrateFlatTerrainTables } from "../migrations/v1.0-flat-terrain-tables-to-subfolders";
import {
  addLinkToSection,
  getLinksInSection,
  removeLinkFromSection,
} from "../sections";
import type HexmakerPlugin from "../HexmakerPlugin";
import { logError } from "../log";
import { hexKey, hexXY } from "../hexKey";

/** What TerrainTablesService uses of the plugin. */
export type TerrainTablesHost = Pick<HexmakerPlugin, "app" | "ensureRegionTable" | "ensureRollerLink" | "getAllTerrains" | "hexPath" | "installShippedTables" | "manifest" | "mapStore" | "mapsOnPalette" | "paletteStore" | "refreshHexMapWithOverrides" | "refreshHexTableTerrainRename" | "renameTerrainInHexes" | "saveSettings" | "settings" | "syncHexEncounterTableLink" | "syncHexRegionTableLink" | "tableNotes" | "tableTerrains" | "terrainEncounterTable" | "terrainTableFiles">;

export class TerrainTablesService {
  constructor(private readonly plugin: TerrainTablesHost) {}

  /** Terrain names that have (or were offered) tables; new ones get theirs (HG5). */
  tableTerrainNames: Set<string> | null = null;

  /** Table creation runs one batch at a time; awaiting any call waits for those before it. */
  private terrainTablesQueue: Promise<void> = Promise.resolve();

  /**
   * Filter a list of table files using a two-tier system:
   *  1. Per-file frontmatter (`filterKey: false` excludes, `filterKey: true` forces include)
   *  2. Folder-level exclusion list (paths relative to tablesFolder)
   */
  filterTableFiles(
    files: TFile[],
    filterKey: "roll-filter" | "encounter-filter",
    excludedFolders: string[],
  ): TFile[] {
    const folder = normalizeFolder(this.plugin.settings.tablesFolder);
    const prefix = folder ? folder + "/" : "";
    return files.filter((f) => {
      const fm = this.plugin.app.metadataCache.getFileCache(f)?.frontmatter;
      if (fm != null) {
        const val: unknown = fm[filterKey];
        if (val === false) return false;
        if (val === true) return true;
      }
      const rel = prefix ? f.path.slice(prefix.length) : f.path;
      return !excludedFolders.some((exc) => rel.startsWith(exc + "/"));
    });
  }

  /** Build an embedded roller code block (path-less — reads the current file). */
  buildRollerLink(): string {
    return "```duckmage-roller\n```";
  }

  /**
   * Give a table note the roller block, replacing an old
   * obsidian://duckmage-roll link. Never touches "_" notes or notes with no
   * roll table. Returns true when the note changed.
   */
  async ensureRollerLink(filePath: string): Promise<boolean> {
    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile) || file.basename.startsWith("_")) return false;
    let changed = false;
    await processTableNote(this.plugin.app, file, (content) => {
      if (!locateRollTable(content)?.recognized) return content;
      const next = withRollerBlock(content);
      changed = next !== content;
      return next;
    });
    return changed;
  }

  /**
   * Write the shipped table notes of the modules of `kinds` (default: the
   * map types that are on) that the tables folder doesn't have yet
   * (plan-tables-everywhere phase 6). A note that's there, edited or not,
   * is never touched; nothing is written when every one is there.
   * Returns the paths written.
   */
  async installShippedTables(kinds: readonly string[] = [...enabledKinds(this.plugin.settings)]): Promise<string[]> {
    const plan = shippedTablesToInstall(registry.shippedTables(kinds), normalizeFolder(this.plugin.settings.tablesFolder), (p) => !!this.plugin.app.vault.getAbstractFileByPath(p));
    const written: string[] = [];
    for (const t of plan) {
      const parts = t.path.split("/").slice(0, -1);
      for (let i = 1; i <= parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        if (!this.plugin.app.vault.getAbstractFileByPath(dir)) {
          try { await this.plugin.app.vault.createFolder(dir); } catch { /* made meanwhile */ }
        }
      }
      try {
        await this.plugin.app.vault.create(t.path, t.text);
        this.plugin.tableNotes.put(t.path, t.text);
        written.push(t.path);
      } catch {
        /* made meanwhile */
      }
    }
    return written;
  }

  /** Add roller blocks to the table notes in the tables folder that lack one. */
  async ensureAllRollerLinks(): Promise<void> {
    const folder = normalizeFolder(this.plugin.settings.tablesFolder);
    const prefix = folder ? folder + "/" : "";
    const files = this.plugin.app.vault
      .getMarkdownFiles()
      .filter((f) => !prefix || f.path.startsWith(prefix));

    let count = 0;
    for (const file of files) {
      if (await this.plugin.ensureRollerLink(file.path)) count++;
    }
    // Nothing to report when every table already had its link (the setup
    // wizard runs this right after creating tables that include one).
    if (count > 0)
      new Notice(
        `Added roller links to ${count} table${count !== 1 ? "s" : ""}.`,
      );
  }

  /**
   * Create missing description/encounters table files for every terrain
   * (`terrains`, default: those of the enabled map types — a Space-only
   * vault gets none for the fantasy palettes; see terrainsForTables).
   */
  async ensureTerrainTables(
    terrains: TerrainColor[] = terrainsForTables(this.plugin.settings.terrainPalettes, enabledKinds(this.plugin.settings)),
    kinds: Iterable<string> = enabledKinds(this.plugin.settings),
  ): Promise<void> {
    const folder = normalizeFolder(this.plugin.settings.tablesFolder);

    // Generic section tables (landmark, hidden, secret) at the root of the tables folder
    for (const sectionType of ["landmark", "hidden", "secret"] as const) {
      const path = folder ? `${folder}/${sectionType}.md` : `${sectionType}.md`;
      if (!this.plugin.app.vault.getAbstractFileByPath(path)) {
        if (folder && !this.plugin.app.vault.getAbstractFileByPath(folder)) {
          try {
            await this.plugin.app.vault.createFolder(folder);
          } catch {
            /* may already exist */
          }
        }
        try {
          await this.plugin.app.vault.create(
            path,
            makeTableTemplate(
              this.plugin.settings.defaultTableDice,
              {
                "table-type": sectionType,
                "roll-filter": false,
                "encounter-filter": false,
              },
              this.buildRollerLink(),
            ),
          );
        } catch {
          /* ignore */
        }
      }
    }

    // The modules' shipped tables: the starter weather and rumours tables
    // (E2, rolled from the hex editor when the map and hex don't name their
    // own) and the space generators' optional role tables. Data, never
    // written over a note that's there.
    await this.plugin.installShippedTables([...kinds]);

    // Terrain-specific tables
    const subfolder = folder ? `${folder}/terrain` : "terrain";
    if (!this.plugin.app.vault.getAbstractFileByPath(subfolder)) {
      try {
        await this.plugin.app.vault.createFolder(subfolder);
      } catch {
        /* may already exist */
      }
    }

    // Ensure type subfolders exist
    for (const tableType of ["description", "encounters"] as const) {
      const typeSubfolder = `${subfolder}/${tableType}`;
      if (!this.plugin.app.vault.getAbstractFileByPath(typeSubfolder)) {
        try {
          await this.plugin.app.vault.createFolder(typeSubfolder);
        } catch {
          /* may already exist */
        }
      }
    }

    // Old flat-named tables ({name} - {type}.md) move into the type folders.
    await migrateFlatTerrainTables(this.plugin.app, subfolder, this.plugin.getAllTerrains().map((t) => t.name));

    // Create any still-missing table files
    await this.createTerrainTableFiles(terrains);
  }

  /**
   * Terrains whose description / encounter tables the vault keeps: those of
   * the enabled map types' palettes (terrainsForTables), plus every palette
   * a map uses.
   */
  tableTerrains(): TerrainColor[] {
    const inUse = this.plugin.settings.maps.map((m) => m.paletteName).filter((n): n is string => !!n);
    return terrainsForTables(this.plugin.settings.terrainPalettes, enabledKinds(this.plugin.settings), inUse);
  }

  /**
   * Give terrains created since the last check their tables (HG5): a new
   * terrain in any palette in use, from any editor, an imported palette or
   * a palette note edited by hand. The tables start empty (the usual
   * template, no rows). Only when the vault keeps tables (the tables folder
   * exists). Awaiting it waits for the files.
   */
  ensureTablesForNewTerrains(): Promise<void> {
    // A name a terrain was just renamed to by hand waits for the answer to
    // "Rename everywhere" (its old tables may move to it), and names typed
    // on the way there ("w", "wo"…) never get tables.
    const held = this.plugin.paletteStore?.heldTerrainNames() ?? new Set<string>();
    const terrains = this.plugin.tableTerrains().filter((t) => !held.has(t.name));
    const known = this.tableTerrainNames;
    this.tableTerrainNames = new Set(terrains.map((t) => t.name));
    const added = known ? newTerrains(known, terrains) : [];
    if (added.length) {
      this.terrainTablesQueue = this.terrainTablesQueue.then(async () => {
        const folder = normalizeFolder(this.plugin.settings.tablesFolder);
        if (folder && !this.plugin.app.vault.getAbstractFileByPath(folder)) return;
        await this.createTerrainTableFiles(added);
      }).catch((e) => logError("terrain tables", e));
    }
    return this.terrainTablesQueue;
  }

  /** Create each terrain's missing description / encounter table (empty). */
  private async createTerrainTableFiles(terrains: readonly TerrainColor[]): Promise<void> {
    if (!terrains.length) return;
    const folder = normalizeFolder(this.plugin.settings.tablesFolder);
    const subfolder = folder ? `${folder}/terrain` : "terrain";
    for (const dir of [subfolder, `${subfolder}/description`, `${subfolder}/encounters`]) {
      if (this.plugin.app.vault.getAbstractFileByPath(dir)) continue;
      try {
        await this.plugin.app.vault.createFolder(dir);
      } catch {
        /* may already exist */
      }
    }
    for (const entry of terrains) {
      for (const tableType of ["description", "encounters"] as const) {
        const path = this.terrainTablePath(entry.name, tableType);
        if (this.plugin.app.vault.getAbstractFileByPath(path)) continue;
        try {
          await this.plugin.app.vault.create(
            path,
            makeTableTemplate(
              this.plugin.settings.defaultTableDice,
              // No `terrain:` key (T2): the table's path
              // ({tables}/terrain/{type}/{terrain}.md) links it to its terrain.
              {
                "table-type": tableType,
                "roll-filter": false,
                "encounter-filter": false,
              },
              this.buildRollerLink(),
            ),
          );
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * For every hex note that has a terrain set, link its terrain's encounters table into
   * the hex's "Encounters Table" section (if not already linked).
   */
  async backfillTerrainLinks(): Promise<void> {
    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
    const tablesFolder = normalizeFolder(this.plugin.settings.tablesFolder);
    const subfolder = tablesFolder ? `${tablesFolder}/terrain` : "terrain";

    const hexFiles = this.plugin.app.vault.getMarkdownFiles().filter((f) => {
      if (hexFolder && !f.path.startsWith(hexFolder + "/")) return false;
      return /^(-?\d+)_(-?\d+)\.md$/.test(f.name);
    });

    let linked = 0;
    for (const file of hexFiles) {
      const terrain = getTerrainFromFile(this.plugin.app, file.path);
      if (!terrain) continue;
      const tablePath = `${subfolder}/encounters/${terrain}.md`;
      const tableFile = this.plugin.app.vault.getAbstractFileByPath(tablePath);
      if (!(tableFile instanceof TFile)) continue;

      const target = this.plugin.app.metadataCache.fileToLinktext(
        tableFile,
        file.path,
      );
      const linkText = `[[${target}]]`;
      const existing = await getLinksInSection(
        this.plugin.app,
        file.path,
        "Encounters Table",
      );
      if (existing.includes(target)) continue;

      await addLinkToSection(this.plugin.app, file.path, "Encounters Table", linkText);
      linked++;
    }
    new Notice(
      `Linked encounter tables for ${linked} hex${linked !== 1 ? "es" : ""}.`,
    );
  }

  /**
   * Replace the terrain encounters-table link in a single hex's "Encounters Table" section.
   * Removes any existing link that resolves to a file in the terrain subfolder, then adds
   * the correct link for the new terrain (if non-null and the table file exists).
   */
  /** Whether `{tablesFolder}/terrain/encounters/{terrain}.md` exists. */
  hasTerrainEncounterTable(terrain: string): boolean {
    return this.plugin.terrainEncounterTable(terrain) !== null;
  }

  /** The terrain's encounters table file, if it has one. */
  terrainEncounterTable(terrain: string): TFile | null {
    const tablesFolder = normalizeFolder(this.plugin.settings.tablesFolder);
    const subfolder = tablesFolder ? `${tablesFolder}/terrain` : "terrain";
    const file = this.plugin.app.vault.getAbstractFileByPath(`${subfolder}/encounters/${terrain}.md`);
    return file instanceof TFile ? file : null;
  }

  /**
   * Link text (relative to `sourcePath`) of the encounters table for the
   * hex's own terrain in the map note, or null. createHexNote links exactly
   * this, and views show it for hexes that have no note yet
   * (see displayedEncounterLinks).
   */
  terrainEncounterLinkFor(mapName: string, x: number, y: number, sourcePath: string): string | null {
    const terrain = this.plugin.mapStore.get(mapName, hexKey(x, y))?.terrain;
    const table = terrain ? this.plugin.terrainEncounterTable(terrain) : null;
    return table ? this.plugin.app.metadataCache.fileToLinktext(table, sourcePath) : null;
  }

  /** The encounters table of the area hex (x, y) is in (`{tables}/regions/<area>.md`), if it has one. */
  areaEncounterTableFor(mapName: string, x: number, y: number): TFile | null {
    const area = this.plugin.mapStore.get(mapName, hexKey(x, y))?.region;
    if (!area) return null;
    const folder = normalizeFolder(this.plugin.settings.tablesFolder);
    const file = this.plugin.app.vault.getAbstractFileByPath(`${folder ? `${folder}/` : ""}regions/${area}.md`);
    return file instanceof TFile ? file : null;
  }

  async syncHexEncounterTableLink(
    hexFilePath: string,
    terrain: string | null,
  ): Promise<void> {
    // The link lives in the hex note's body; a hex without a note gets it
    // when its note is created (createHexNote adds it).
    if (!(this.plugin.app.vault.getAbstractFileByPath(hexFilePath) instanceof TFile)) return;
    const tablesFolder = normalizeFolder(this.plugin.settings.tablesFolder);
    const subfolder = tablesFolder ? `${tablesFolder}/terrain` : "terrain";

    // Remove any links that point to a terrain encounters table
    const existing = await getLinksInSection(
      this.plugin.app,
      hexFilePath,
      "Encounters Table",
    );
    for (const linkTarget of existing) {
      const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(
        linkTarget,
        hexFilePath,
      );
      if (resolved && resolved.path.startsWith(subfolder + "/encounters/")) {
        await removeLinkFromSection(
          this.plugin.app,
          hexFilePath,
          "Encounters Table",
          linkTarget,
        );
      }
    }

    if (!terrain) return;

    const tablePath = `${subfolder}/encounters/${terrain}.md`;
    const tableFile = this.plugin.app.vault.getAbstractFileByPath(tablePath);
    if (!(tableFile instanceof TFile)) return;
    const linkText = `[[${this.plugin.app.metadataCache.fileToLinktext(tableFile, hexFilePath)}]]`;
    await addLinkToSection(this.plugin.app, hexFilePath, "Encounters Table", linkText);
  }

  /**
   * For every hex note on the map, replace its terrain encounters-table link with the
   * one matching its current terrain.  Intended as a one-shot repair tool.
   */
  async refreshAllTerrainEncounterLinks(): Promise<void> {
    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);
    const hexFiles = this.plugin.app.vault.getMarkdownFiles().filter((f) => {
      if (hexFolder && !f.path.startsWith(hexFolder + "/")) return false;
      return /^(-?\d+)_(-?\d+)\.md$/.test(f.name);
    });

    for (const file of hexFiles) {
      const terrain = getTerrainFromFile(this.plugin.app, file.path) ?? null;
      await this.plugin.syncHexEncounterTableLink(file.path, terrain);
    }
    new Notice(
      `Refreshed encounter links for ${hexFiles.length} hex${hexFiles.length !== 1 ? "es" : ""}.`,
    );
  }

  // ── Region encounter tables ────────────────────────────────────────────────

  /** Create a region encounters table file if it does not already exist. */
  async ensureRegionTable(regionName: string): Promise<void> {
    const folder = normalizeFolder(this.plugin.settings.tablesFolder);
    const subfolder = folder ? `${folder}/regions` : "regions";

    if (!this.plugin.app.vault.getAbstractFileByPath(subfolder)) {
      try {
        await this.plugin.app.vault.createFolder(subfolder);
      } catch {
        /* may already exist */
      }
    }

    const path = `${subfolder}/${regionName}.md`;
    if (!this.plugin.app.vault.getAbstractFileByPath(path)) {
      try {
        await this.plugin.app.vault.create(
          path,
          makeTableTemplate(
            this.plugin.settings.defaultTableDice,
            {
              region: regionName,
              "table-type": "encounters",
              "roll-filter": false,
              "encounter-filter": false,
            },
            this.buildRollerLink(),
          ),
        );
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Add the region's encounters table link to a hex's "Encounters Table" section,
   * or remove it when regionName is null (hex removed from region).
   * Any existing link pointing into the regions subfolder is replaced.
   */
  async syncHexRegionTableLink(
    hexFilePath: string,
    regionName: string | null,
  ): Promise<void> {
    const tablesFolder = normalizeFolder(this.plugin.settings.tablesFolder);
    const subfolder = tablesFolder ? `${tablesFolder}/regions` : "regions";

    // Remove any existing region table link
    const existing = await getLinksInSection(
      this.plugin.app,
      hexFilePath,
      "Encounters Table",
    );
    for (const linkTarget of existing) {
      const resolved = this.plugin.app.metadataCache.getFirstLinkpathDest(
        linkTarget,
        hexFilePath,
      );
      if (resolved && resolved.path.startsWith(subfolder + "/")) {
        await removeLinkFromSection(
          this.plugin.app,
          hexFilePath,
          "Encounters Table",
          linkTarget,
        );
      }
    }

    if (!regionName) return;

    const tablePath = `${subfolder}/${regionName}.md`;
    const tableFile = this.plugin.app.vault.getAbstractFileByPath(tablePath);
    if (!(tableFile instanceof TFile)) return;

    const linkText = `[[${this.plugin.app.metadataCache.fileToLinktext(tableFile, hexFilePath)}]]`;
    await addLinkToSection(this.plugin.app, hexFilePath, "Encounters Table", linkText);
  }

  /**
   * For every region note in the regions folder, ensure its encounters table exists.
   * For every hex note that has a `region` frontmatter key, ensure the region table
   * link is present in its "Encounters Table" section.
   */
  async backfillRegionLinks(): Promise<void> {
    const regionsFolder = normalizeFolder(this.plugin.settings.regionsFolder);
    const hexFolder = normalizeFolder(this.plugin.settings.hexFolder);

    // Ensure tables for all region notes (even unpainted ones)
    if (regionsFolder) {
      const regionFiles = this.plugin.app.vault
        .getMarkdownFiles()
        .filter(
          (f) =>
            !f.basename.startsWith("_") &&
            f.path.startsWith(regionsFolder + "/"),
        );
      for (const f of regionFiles) {
        await this.plugin.ensureRegionTable(f.basename);
      }
    }

    // Sync hex → region table links
    const hexFiles = this.plugin.app.vault.getMarkdownFiles().filter((f) => {
      if (hexFolder && !f.path.startsWith(hexFolder + "/")) return false;
      return /^(-?\d+)_(-?\d+)\.md$/.test(f.name);
    });

    let linked = 0;
    for (const file of hexFiles) {
      const region = getHexRegionFromFile(this.plugin.app, file.path);
      if (!region) continue;
      await this.plugin.syncHexRegionTableLink(file.path, region);
      linked++;
    }

    new Notice(
      `Linked area encounter tables for ${linked} hex${linked !== 1 ? "es" : ""}.`,
    );
  }

  /** Update every hex note whose terrain matches oldName to newName.
   *  Reads file content directly (not the metadata cache) so successive renames
   *  don't miss hexes whose cache entry hasn't refreshed yet.
   *  Returns a Map of filePath → newName for use as terrain overrides when re-rendering. */
  async renameTerrainInHexes(
    oldName: string,
    newName: string,
    paletteName?: string,
  ): Promise<Map<string, string>> {
    // Terrain lives in map notes: rename it there (in memory now, notes
    // follow). Hex notes no longer carry terrain. Only maps drawn with
    // `paletteName` (when given): another palette's terrain of the same
    // name is a different terrain.
    const overrides = new Map<string, string>();
    for (const m of paletteName === undefined ? this.plugin.settings.maps : this.plugin.mapsOnPalette(paletteName)) {
      for (const [key, h] of this.plugin.mapStore.all(m.name)) {
        if (h.terrain !== oldName) continue;
        this.plugin.mapStore.set(m.name, key, { terrain: newName });
        const { x, y } = hexXY(key);
        overrides.set(this.plugin.hexPath(x, y, m.name), newName);
      }
      if (m.baseTerrain === oldName) m.baseTerrain = newName;
    }
    await this.plugin.mapStore.flush();
    return overrides;
  }

  /** Re-render all open hex map views, passing terrain overrides to bypass the stale metadata cache. */
  /**
   * Rename a palette terrain everywhere: hex notes using it, its terrain
   * table files, then the entry itself (saved). Used by the terrain entry
   * editor and the palette editor page.
   */
  async renameTerrain(entry: TerrainColor, newName: string): Promise<void> {
    const oldName = entry.name;
    if (!newName || newName === oldName) return;
    // The palette the entry is in (an entry in none, e.g. a stray copy,
    // renames on every map as before).
    const palette = this.plugin.settings.terrainPalettes.find((p) => p.terrains.includes(entry))?.name;
    const overrides = await this.plugin.renameTerrainInHexes(oldName, newName, palette);
    // Another palette still has a terrain of the old name: its tables stay
    // and the renamed one gets a copy.
    const shared = this.plugin.settings.terrainPalettes.some((p) => p.terrains.some((t) => t !== entry && t.name === oldName));
    await this.renameTerrainTables(oldName, newName, shared);
    entry.name = newName;
    await this.plugin.saveSettings();
    this.plugin.refreshHexMapWithOverrides(overrides);
    this.plugin.refreshHexTableTerrainRename(oldName, newName);
  }

  /** The terrain table files of a name that exist (description, encounters). */
  terrainTableFiles(name: string): TFile[] {
    return (["description", "encounters"] as const)
      .map((type) => this.plugin.app.vault.getAbstractFileByPath(this.terrainTablePath(name, type)))
      .filter((f): f is TFile => f instanceof TFile);
  }

  /**
   * "Rename everywhere" for a terrain already renamed in its palette (by
   * hand in the palette note): the hexes and base terrains of that
   * palette's maps, and the terrain's tables, follow it. The map notes and
   * tables it changes are backed up first; nothing changes when the backup
   * can't be saved. Returns the backup path, or null when it failed.
   */
  async renameTerrainEverywhere(paletteName: string, oldName: string, newName: string): Promise<string | null> {
    const maps = this.plugin.mapsOnPalette(paletteName);
    const notes: Record<string, string> = {};
    let where: string;
    try {
      for (const m of maps) {
        const text = await this.plugin.mapStore.readNoteText(m.name);
        if (text !== null) notes[this.plugin.mapStore.notePath(m.name)] = text;
      }
      for (const f of this.plugin.terrainTableFiles(oldName)) notes[f.path] = await this.plugin.app.vault.read(f);
      const dir = `${this.plugin.manifest.dir}/backups/terrain-rename-${new Date().toISOString().slice(0, 10)}`;
      const json = JSON.stringify({ kind: "terrain-rename", palette: paletteName, from: oldName, to: newName, savedAt: new Date().toISOString(), notes });
      where = await writeJsonBackup(this.plugin.app.vault.adapter, dir, "before-rename", json);
    } catch (e) {
      console.error("Hexmap World Creator: couldn't back up before renaming a terrain; nothing was changed", e);
      new Notice(`Couldn't save a backup, so "${oldName}" wasn't renamed. Nothing was changed.`, 10000);
      return null;
    }
    const overrides = await this.plugin.renameTerrainInHexes(oldName, newName, paletteName);
    // A palette that still has a terrain of the old name keeps its tables
    // (the renamed one gets a copy); otherwise they move.
    const shared = this.plugin.settings.terrainPalettes.some((p) => p.terrains.some((t) => t.name === oldName));
    await this.renameTerrainTables(oldName, newName, shared);
    await this.plugin.saveSettings();
    this.plugin.refreshHexMapWithOverrides(overrides);
    this.plugin.refreshHexTableTerrainRename(oldName, newName);
    return where;
  }

  private terrainTablePath(name: string, type: "description" | "encounters"): string {
    const folder = normalizeFolder(this.plugin.settings.tablesFolder);
    const sub = folder ? `${folder}/terrain` : "terrain";
    return `${sub}/${type}/${name}.md`;
  }

  /**
   * A renamed terrain's tables follow it (HG5): moved when no other terrain
   * has the old name (links to them are updated), copied when one does.
   * When there are none, the new name gets empty ones (via the save).
   */
  private async renameTerrainTables(oldName: string, newName: string, keepOld = true): Promise<void> {
    // Tables still being made for the old name (a just-added terrain) first.
    await this.terrainTablesQueue;
    for (const type of ["description", "encounters"] as const) {
      const oldPath = this.terrainTablePath(oldName, type);
      const newPath = this.terrainTablePath(newName, type);
      // Don't overwrite if the new terrain already has its own tables
      if (this.plugin.app.vault.getAbstractFileByPath(newPath)) continue;
      const oldFile = this.plugin.app.vault.getAbstractFileByPath(oldPath);
      if (!(oldFile instanceof TFile)) continue;
      if (!keepOld) {
        try {
          await this.plugin.app.fileManager.renameFile(oldFile, newPath);
          await this.plugin.app.vault.process(oldFile, (content) =>
            content
              .replace(/^terrain:[ \t].+$/m, `terrain: ${newName}`)
              .replace(/^.*obsidian:\/\/duckmage-roll.*$\n?/m, ""),
          );
          await this.plugin.ensureRollerLink(newPath);
        } catch { /* ignore */ }
        continue;
      }
      try {
        let content = await this.plugin.app.vault.read(oldFile);
        // Update the terrain frontmatter property to the new name
        content = content.replace(/^terrain:[ \t].+$/m, `terrain: ${newName}`);
        // Strip the old roller link so ensureRollerLink can add one with the correct path
        content = content.replace(/^.*obsidian:\/\/duckmage-roll.*$\n?/m, "");
        await this.plugin.app.vault.create(newPath, content);
        await this.plugin.ensureRollerLink(newPath);
      } catch { /* ignore */ }
    }
  }
}
