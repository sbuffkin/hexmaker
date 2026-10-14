/**
 * The hex editor's table sections (SF2): Encounters and each rolled text
 * section list the tables that apply to this hex (hex > area > terrain),
 * switch between them, roll, and pick or make another. Also the roll
 * target ("Add to this hex") every roll made in the editor uses.
 */

import { Notice, TFile } from "obsidian";
import { effectiveTerrainType } from "../../terrainTypes";
import { workModeOf } from "../../workMode";
import { normalizeFolder } from "../../utils";
import { getTerrainFromFile } from "../../frontmatter";
import { addLinkToSection, removeLinkFromSection, getLinksInSection, addBacklinkToFile, joinSectionText } from "../../sections";
import { ROLLED_TEXT_SECTIONS, TEXT_SECTIONS } from "../../types";
import { RandomTableModal, type RollHexTarget } from "../../random-tables/RandomTableModal";
import { FileLinkSuggestModal } from "../FileLinkSuggestModal";
import { TABLE_KINDS, choiceKey, initialChoice, rememberChoice, rememberedChoice, tableChoices, type TableChoiceItem, type TableKind } from "../../tableChoice";
import { TableChoice } from "../../random-tables/TableChoice";
import { groupTableFiles } from "../../random-tables/tablePickerGroups";
import { VIEW_TYPE_RANDOM_TABLES } from "../../constants";
import { contentFolder } from "../../notePickers";
import { addToPlayLog } from "../../play/playLogWriter";
import { PLAY_LOG_TARGET, rollDefaultSection } from "../../play/playLog";
import { EditorWritePart, type EditorWriteHost } from "./host";

export interface TableSectionsHost extends EditorWriteHost {
  /** The hex has a note (as last read here). */
  hexExists: boolean;
  /** Link sections' links by lower-case section key, as last read. */
  readonly allLinks: Map<string, string[]>;
  /** Text sections' text by key, as last read. */
  readonly allText: Map<string, string>;
  /** Redraws each table-choice section (by kind) from the current links. */
  readonly choiceRefreshers: Map<string, () => void>;
  /** Text boxes by section key: append a rolled result and save (P2). */
  readonly textBoxes: Map<string, (addition: string) => void>;
}

export class TableSections extends EditorWritePart<TableSectionsHost> {
  private get hexExists(): boolean {
    return this.host.hexExists;
  }
  private set hexExists(exists: boolean) {
    this.host.hexExists = exists;
  }
  private get allLinks(): Map<string, string[]> {
    return this.host.allLinks;
  }
  private get allText(): Map<string, string> {
    return this.host.allText;
  }
  private get choiceRefreshers(): Map<string, () => void> {
    return this.host.choiceRefreshers;
  }
  private get textBoxes(): Map<string, (addition: string) => void> {
    return this.host.textBoxes;
  }

  /**
   * Encounters: one section that lists the tables this hex can roll on
   * (hex > area > terrain) and switches between them (SF2).
   */
  renderEncountersSection(container: HTMLElement, path: string): void {
    const encCard = container.createDiv({ cls: "duckmage-editor-link-section duckmage-editor-link-card duckmage-editor-encounters" });
    encCard.createEl("h4", { text: this.plugin.sectionWordsFor(this.mapName)("Encounters Table").label, cls: "duckmage-link-section-title" });
    this.renderTableChoice(encCard, path, "encounters");
  }

  /** Re-read the Encounters section after a terrain change (its terrain table follows the terrain). */
  async reloadEncounterLinks(path: string): Promise<void> {
    await this.reloadKindLinks(path, TABLE_KINDS.encounters);
    this.choiceRefreshers.get("encounters")?.();
  }

  /** Re-read a kind's links from the hex note into allLinks. */
  private async reloadKindLinks(path: string, kind: TableKind): Promise<void> {
    this.hexExists = this.app.vault.getAbstractFileByPath(path) instanceof TFile;
    const links = this.hexExists ? await getLinksInSection(this.app, path, kind.hexSection) : [];
    this.allLinks.set(kind.hexSection.toLowerCase(), links);
  }

  /** The tables that apply to this hex for a kind, most specific first (tableChoice.ts). */
  private tableChoiceItems(path: string, kind: TableKind): TableChoiceItem[] {
    const tables = normalizeFolder(this.plugin.settings.tablesFolder ?? "");
    const inTables = (p: string) => (tables ? `${tables}/${p}` : p);
    const links = this.hexExists ? this.allLinks.get(kind.hexSection.toLowerCase()) ?? [] : [];
    const terrain = getTerrainFromFile(this.app, path);
    return tableChoices({
      noteExists: this.hexExists,
      noteLinks: links.map((link) => ({ link, path: this.app.metadataCache.getFirstLinkpathDest(link, path)?.path ?? null })),
      area: kind.areaTables ? this.plugin.areaEncounterTableFor(this.mapName, this.x, this.y)?.path : null,
      terrain: kind.terrainTables && terrain ? this.plugin.terrainEncounterTable(terrain)?.path : null,
      map: kind.mapField ? this.plugin.getMap(this.mapName)?.[kind.mapField]?.trim() || null : null,
      fallback: kind.starterFile ? inTables(kind.starterFile) : null,
      folders: { area: inTables("regions"), terrain: inTables("terrain") },
      exists: (p) => this.app.vault.getAbstractFileByPath(p) instanceof TFile,
    });
  }

  /**
   * A section's tables (SF2): the ones that apply to this hex as radio
   * buttons, most specific first, Roll, and "change…" to pick any table
   * (linked to this hex, so it's note text: allowed in Play). Switching is
   * remembered for this session and writes nothing.
   */
  renderTableChoice(host: HTMLElement, path: string, kindId: TableKind["id"]): void {
    const kind = TABLE_KINDS[kindId];
    const key = choiceKey(this.mapName, this.x, this.y, kind.id);
    const first = this.tableChoiceItems(path, kind);
    const refresh = () => {
      const items = this.tableChoiceItems(path, kind);
      choice.setItems(items, initialChoice(items, rememberedChoice(key)));
    };
    const choice = new TableChoice(host, {
      app: this.app,
      plugin: this.plugin,
      noun: kind.noun,
      items: first,
      start: initialChoice(first, rememberedChoice(key)),
      onChoose: (item) => rememberChoice(key, item.path),
      onRoll: (item) => new RandomTableModal(this.app, this.plugin, undefined, item.path, this.rollTarget(kind.rollInto)).open(),
      onOpen: (item) => this.openTableInView(item.path),
      onChange: () =>
        this.pickTableFor(path, kind, (picked) => {
          rememberChoice(key, picked);
          refresh();
        }),
      onRemove: (item) => {
        if (!item.link) return;
        const link = item.link;
        void this.saves.track(
          (async () => {
            // A noteless hex shows the tables its note will get: make the
            // note so removing one sticks.
            await this.ensureHexNote();
            await removeLinkFromSection(this.app, path, kind.hexSection, link);
            await this.reloadKindLinks(path, kind);
            refresh();
            this.onChanged();
          })(),
        );
      },
    });
    this.choiceRefreshers.set(kind.id, refresh);
  }

  /**
   * "change…": any table in the tables folder, the user's own first (F2:
   * 124 terrain tables were listed before the user's), or a new one. A
   * table already listed for this hex is just chosen; another is linked
   * into the hex's section for the kind.
   */
  private pickTableFor(path: string, kind: TableKind, chosen: (tablePath: string) => void): void {
    const use = (file: TFile) =>
      void this.saves.track(
        (async () => {
          if (!this.tableChoiceItems(path, kind).some((it) => it.path === file.path)) {
            const note = await this.ensureHexNote();
            if (!note) throw new Error("Could not create the hex note");
            await addLinkToSection(this.app, path, kind.hexSection, `[[${this.app.metadataCache.fileToLinktext(file, path)}]]`);
            if (kind.id === "encounters") void addBacklinkToFile(this.app, file.path, path, this.plugin.hexLinkAlias(path));
            await this.reloadKindLinks(path, kind);
            this.onChanged();
          }
          chosen(file.path);
        })(),
      );
    const folder = contentFolder(this.plugin.settings, "tablesFolder");
    const create = (name: string) =>
      void (async () => {
        const dir = normalizeFolder(folder);
        const newPath = dir ? `${dir}/${name}.md` : `${name}.md`;
        let file = this.app.vault.getAbstractFileByPath(newPath);
        try {
          if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
          if (!(file instanceof TFile)) file = await this.app.vault.create(newPath, await this.plugin.newLinkedNoteContent("Encounters Table", name));
        } catch (err) {
          new Notice(`Could not create ${newPath}: ${String(err)}`);
          return;
        }
        if (file instanceof TFile) use(file);
      })();
    const picker = new FileLinkSuggestModal(this.app, this.plugin, use, folder, ["md"], "link", {
      order: (files) => {
        const shown = kind.id === "encounters"
          ? this.plugin.filterTableFiles(files, "encounter-filter", this.plugin.settings.encounterTableExcludedFolders)
          : files;
        const { own, mapMade } = groupTableFiles(this.app, shown);
        return [...own, ...mapMade];
      },
      onCreate: create,
      createNoun: "table",
    });
    picker.setPlaceholder(`Pick a ${kind.noun} table for this hex…`);
    picker.open();
  }

  /** Show a table in the random tables view. */
  private openTableInView(tablePath: string): void {
    void (async () => {
      interface WithOpenTable {
        openTable?(path: string): void;
      }
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RANDOM_TABLES);
      if (leaves.length > 0) {
        void this.app.workspace.revealLeaf(leaves[0]);
        (leaves[0].view as unknown as WithOpenTable).openTable?.(tablePath);
      } else {
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.setViewState({ type: VIEW_TYPE_RANDOM_TABLES });
        (leaf.view as unknown as WithOpenTable).openTable?.(tablePath);
      }
      this.close();
    })();
  }

  /**
   * "Add to this hex" for a roll made here (P2): the play log, then every
   * text section. `defaultSection` is picked first, except in Play, where
   * the play log is (SF3: what happened goes to the log, not Description).
   */
  rollTarget(defaultSection: string): RollHexTarget {
    const hx = this.x;
    const hy = this.y;
    // The hex's terrain and its type: When context for the roll (hexRoll.ts).
    const terrain = getTerrainFromFile(this.app, this.plugin.hexPath(hx, hy, this.mapName)) ?? undefined;
    const entry = terrain ? this.plugin.getMapPalette(this.mapName).find((t) => t.name === terrain) : undefined;
    const type = entry ? effectiveTerrainType(entry) : undefined;
    return {
      label: `hex ${hx}, ${hy}`,
      context: { ...(terrain ? { terrain } : {}), ...(type ? { type } : {}) },
      sections: [{ key: PLAY_LOG_TARGET, label: "Play log" }, ...TEXT_SECTIONS, ...ROLLED_TEXT_SECTIONS],
      defaultSection: rollDefaultSection(workModeOf(this.plugin.getMap(this.mapName)), defaultSection),
      add: async (key, text) => {
        if (key === PLAY_LOG_TARGET) { await addToPlayLog(this.plugin, this.mapName, hx, hy, text); return; }
        // Still on this hex with the box showing: add through the box.
        const box = hx === this.x && hy === this.y ? this.textBoxes.get(key) : undefined;
        if (box) { box(text); return; }
        await this.plugin.appendToHexSection(hx, hy, this.mapName, key, text);
        if (hx === this.x && hy === this.y) this.allText.set(key, joinSectionText(this.allText.get(key) ?? "", text));
        this.onChanged();
      },
    };
  }
}
