import { handRollLabel } from "../arrival/eventsLedger";
import {
  ItemView,
  MarkdownRenderer,
  Menu,
  Notice,
  TFile,
  TFolder,
  ViewStateResult,
  WorkspaceLeaf,
} from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { VIEW_TYPE_RANDOM_TABLES } from "../constants";
import { normalizeFolder, makeTableTemplate } from "../utils";
import { RandomTableEditorModal } from "./RandomTableEditorModal";
import { WorkflowEditorModal } from "./WorkflowEditorModal";
import { WorkflowWizardModal } from "./WorkflowWizardModal";
import {
  parseRandomTable,
  parseRandomTableWithReport,
  rollTable,
  resolveTable,
  rowOdds,
  rowInfoOf,
  dieLabel,
  dieFaces,
  setDiceInFrontmatter,
  syncLinkedRows,
  writeRollTable,
  withRollerBlock,
  parseMarkdownListItems,
  type RandomTable,
  type ResolvedTable,
  type TableReport,
} from "./randomTable";
import { planTableMigration } from "../migrations/v1.5-table-roll-ranges";
import { processTableNote } from "./TableStore";
import { groupTableFiles } from "./tablePickerGroups";
import { MAP_MADE_GROUP_LABEL } from "./resolve";
import { parseWorkflow, generateDefaultTemplate } from "./workflow";
import { resolveWorkflowTemplate } from "./workflowFiles";
import { Frontmatter } from "../frontmatter";
import { buildTree, renderFolderTree, type TreeNode } from "./FolderTree";
import {
  exportRandomTableAsPdf,
  exportRandomTableAsMarkdown,
} from "../export/exporters/randomTable";
import { Disclosure } from "../ui/disclosure";
import { isDebugMode } from "../ui/debugMode";
import { PlacedMenu } from "../ui/placedMenu";
import { DETAIL_REFRESH_MS, LIST_REFRESH_MS, ListSignatures, listSignature, touchesList, type ListFolders } from "./listRefresh";
import { tableTitle } from "../encounterLinks";
import { renderEmptyTableState, setRollEnabled } from "./emptyTable";

/** Collapse key (and key prefix) of the tree's "Made by the map" section. */
const MAP_MADE_KEY = "map-made:";

export const DIE_OPTIONS = [
  { label: "— no die —", value: 0 },
  { label: "d4", value: 4 },
  { label: "d6", value: 6 },
  { label: "d8", value: 8 },
  { label: "d10", value: 10 },
  { label: "d12", value: 12 },
  { label: "d20", value: 20 },
  { label: "d66", value: 66 },
  { label: "d100", value: 100 },
  { label: "d200", value: 200 },
  { label: "d500", value: 500 },
  { label: "d1000", value: 1000 },
];

export class RandomTableView extends ItemView {
  private listEl: HTMLElement | null = null;
  private detailEl: HTMLElement | null = null;
  private activeFile: TFile | null = null;
  private rollHistory: string[] = [];
  private collapsedFolders: Set<string> = new Set();
  private filterQuery = "";
  private treeInitialized = false;
  private linkedFolderMap: Map<string, string> = new Map(); // folder path → table file path
  private workflowMap: Map<string, string[]> = new Map(); // table path (no .md) → workflow file paths
  private listRefreshTimer: number | null = null;
  private detailRefreshTimer: number | null = null;
  private viewMode: "tables" | "workflows" = "tables";
  private tablesBtn: HTMLButtonElement | null = null;
  private workflowsBtn: HTMLButtonElement | null = null;
  private tableFooterEl: HTMLElement | null = null;
  private workflowFooterEl: HTMLElement | null = null;
  /** Each listed note's list inputs, so metadata changes redraw only when they matter. */
  private listSigs = new ListSignatures();

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: HexmakerPlugin,
  ) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_RANDOM_TABLES;
  }
  getDisplayText() {
    return this.activeFile
      ? `Random tables · ${tableTitle(this.activeFile.path)}`
      : "Random tables";
  }
  getIcon() {
    return "dice";
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const s = state as { viewMode?: string; filePath?: string } | null;
    if (
      s?.viewMode &&
      (s.viewMode === "tables" || s.viewMode === "workflows")
    ) {
      if (s.viewMode !== this.viewMode) this.setViewMode(s.viewMode);
    }
    if (s?.filePath) {
      const file = this.app.vault.getAbstractFileByPath(s.filePath);
      if (file instanceof TFile) {
        if (this.isInWorkflowsFolder(file.path)) {
          this.viewMode = "workflows";
          this.markModeTabs("workflows");
          this.loadList();
          await this.loadWorkflow(file);
        } else {
          this.loadList();
          void this.loadTable(file);
        }
      }
    }
  }

  onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-rt-container");

    // ── Left column: table list ──────────────────────────────────────────
    const leftCol = contentEl.createDiv({ cls: "duckmage-rt-left" });

    const listHeader = leftCol.createDiv({ cls: "duckmage-rt-list-header" });
    listHeader.createSpan({
      text: "Tables",
      cls: "duckmage-rt-list-title",
    });

    // ── Mode toggle tabs ─────────────────────────────────────────────────
    const modeTabs = leftCol.createDiv({ cls: "duckmage-rt-mode-tabs" });
    this.tablesBtn = modeTabs.createEl("button", {
      text: "Tables",
      cls: "duckmage-rt-mode-tab",
    });
    this.workflowsBtn = modeTabs.createEl("button", {
      text: "Workflows",
      cls: "duckmage-rt-mode-tab",
    });
    this.markModeTabs(this.viewMode);
    this.tablesBtn.addEventListener("click", () => this.setViewMode("tables"));
    this.workflowsBtn.addEventListener("click", () =>
      this.setViewMode("workflows"),
    );

    // Middle-click mode tabs → open view in new tab at that mode
    this.tablesBtn.addEventListener("auxclick", (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const leaf = this.app.workspace.getLeaf("tab");
      void leaf.setViewState({
        type: VIEW_TYPE_RANDOM_TABLES,
        active: true,
        state: { viewMode: "tables" },
      });
      void this.app.workspace.revealLeaf(leaf);
    });
    this.workflowsBtn.addEventListener("auxclick", (e: MouseEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const leaf = this.app.workspace.getLeaf("tab");
      void leaf.setViewState({
        type: VIEW_TYPE_RANDOM_TABLES,
        active: true,
        state: { viewMode: "workflows" },
      });
      void this.app.workspace.revealLeaf(leaf);
    });

    const searchInput = leftCol.createEl("input", {
      type: "search",
      cls: "duckmage-rt-search",
    });
    searchInput.placeholder = "Filter tables…";
    searchInput.addEventListener("input", () => {
      this.filterQuery = searchInput.value.toLowerCase().trim();
      void this.loadList();
    });

    this.listEl = leftCol.createDiv({ cls: "duckmage-rt-list" });

    // Root drop zone: drag a table file onto the list background to move it to the top-level tables folder
    let listDragCounter = 0;
    this.listEl.addEventListener("dragenter", (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("text/plain")) return;
      listDragCounter++;
      this.listEl!.addClass("is-drag-over-root");
    });
    this.listEl.addEventListener("dragleave", () => {
      if (--listDragCounter <= 0) {
        listDragCounter = 0;
        this.listEl!.removeClass("is-drag-over-root");
      }
    });
    this.listEl.addEventListener("dragover", (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("text/plain")) return;
      e.preventDefault();
    });
    this.listEl.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      listDragCounter = 0;
      this.listEl!.removeClass("is-drag-over-root");
      const srcPath = e.dataTransfer?.getData("text/plain") ?? "";
      void this.moveFileTo(
        srcPath,
        normalizeFolder(this.plugin.settings.tablesFolder),
      );
    });

    const listFooter = leftCol.createDiv({ cls: "duckmage-rt-list-footer" });
    // The list's Advanced dropdown (and Debug inside it), at the end of the tables footer.
    const listDisclosure = new Disclosure(this.app, "RTView.list", () => this.tableFooterEl ?? listFooter);

    // ── Workflow footer (shown in workflows mode) ──────────────────────────
    this.workflowFooterEl = listFooter.createDiv();
    this.workflowFooterEl.hide();
    const newWfFooterBtn = this.workflowFooterEl.createEl("button", {
      text: "+ new workflow",
      cls: "duckmage-rt-new-btn",
    });
    newWfFooterBtn.addEventListener("click", () => void this.createWorkflow());

    // ── Table footer (shown in tables mode) ───────────────────────────────
    this.tableFooterEl = listFooter.createDiv();
    const newRow = this.tableFooterEl.createDiv({ cls: "duckmage-rt-new-row" });
    const newInput = newRow.createEl("input", {
      type: "text",
      cls: "duckmage-rt-new-input",
    });
    newInput.placeholder = "New table name…";
    newInput.addEventListener("input", () => {
      const name = newInput.value.trim();
      if (!name) {
        newInput.removeClass("duckmage-input-error");
        newInput.title = "";
        return;
      }
      const folder = normalizeFolder(this.plugin.settings.tablesFolder);
      const checkPath = folder ? `${folder}/${name}.md` : `${name}.md`;
      const exists =
        this.app.vault.getAbstractFileByPath(checkPath) instanceof TFile;
      if (exists) {
        newInput.addClass("duckmage-input-error");
        newInput.title = `"${name}" already exists.`;
      } else {
        newInput.removeClass("duckmage-input-error");
        newInput.title = "";
      }
    });
    const newBtn = newRow.createEl("button", {
      text: "+ new",
      cls: "duckmage-rt-new-btn",
    });
    // "Generate from folder or file": Advanced (or not built at all).
    const fromFolderHost = listDisclosure.target("RTView.generateFromFolder", this.tableFooterEl);
    const fromFolderWrap = fromFolderHost ?? createDiv();
    const fromFolderDatalistId =
      "duckmage-rt-folders-" + Math.random().toString(36).slice(2);
    const fromFolderDatalist = fromFolderWrap.createEl("datalist");
    fromFolderDatalist.id = fromFolderDatalistId;
    const seenFromFolders = new Set<string>();
    // Add configured settings folders first (excluding hexFolder)
    for (const raw of [
      this.plugin.settings.townsFolder,
      this.plugin.settings.dungeonsFolder,
      this.plugin.settings.questsFolder,
      this.plugin.settings.featuresFolder,
      this.plugin.settings.factionsFolder,
      this.plugin.settings.tablesFolder,
      this.plugin.settings.workflowsFolder,
    ]) {
      const p = normalizeFolder(raw);
      if (p && !seenFromFolders.has(p)) {
        seenFromFolders.add(p);
        fromFolderDatalist.createEl("option", { value: p });
      }
    }
    // Add all vault subfolders under worldFolder or any settings folder
    const ps = this.plugin.settings;
    const fromFolderRoots = [
      ps.worldFolder,
      ps.townsFolder,
      ps.dungeonsFolder,
      ps.questsFolder,
      ps.featuresFolder,
      ps.factionsFolder,
      ps.tablesFolder,
      ps.workflowsFolder,
    ].map(normalizeFolder).filter(Boolean);
    for (const f of this.app.vault.getAllFolders()) {
      const p = normalizeFolder(f.path);
      if (!p) continue;
      const underRoot = fromFolderRoots.some(
        (r) => p === r || p.startsWith(r + "/"),
      );
      if (!underRoot) continue;
      if (!seenFromFolders.has(p)) {
        seenFromFolders.add(p);
        fromFolderDatalist.createEl("option", { value: p });
      }
    }
    // Also add markdown files under the same roots so file paths autocomplete
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (f.basename.startsWith("_")) continue;
      const underRoot = fromFolderRoots.some(
        (r) => f.path.startsWith(r + "/"),
      );
      if (!underRoot) continue;
      const pathNoExt = f.path.slice(0, -3);
      if (!seenFromFolders.has(pathNoExt)) {
        seenFromFolders.add(pathNoExt);
        fromFolderDatalist.createEl("option", { value: pathNoExt });
      }
    }
    const fromFolderInput = fromFolderWrap.createEl("input", {
      type: "text",
      cls: "duckmage-rt-from-folder-input",
      attr: { placeholder: "Generate from folder or file (optional)…" },
    });
    fromFolderInput.setAttribute("list", fromFolderDatalistId);

    const createTable = async () => {
      const name = newInput.value.trim();
      if (!name || newInput.hasClass("duckmage-input-error")) return;
      const folder = normalizeFolder(this.plugin.settings.tablesFolder);
      const newPath = folder ? `${folder}/${name}.md` : `${name}.md`;
      let file = this.app.vault.getAbstractFileByPath(newPath);
      let srcFolder = "";
      if (!(file instanceof TFile)) {
        try {
          if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder);
          }
          const fromValue = fromFolderInput.value.trim();
          let srcFile: TFile | null = null;
          if (fromValue) {
            const norm = normalizeFolder(fromValue);
            const candidate =
              this.app.vault.getAbstractFileByPath(norm) ??
              this.app.vault.getAbstractFileByPath(norm + ".md");
            if (candidate instanceof TFile) {
              srcFile = candidate;
            } else {
              srcFolder = norm;
            }
          }
          let content: string;
          if (srcFile) {
            const rawContent = await this.app.vault.read(srcFile);
            const items = parseMarkdownListItems(rawContent);
            content = makeTableTemplate(
              this.plugin.settings.defaultTableDice,
              undefined,
              this.plugin.buildRollerLink(),
              items.map((item) => [item, 1] as const),
            );
          } else if (srcFolder) {
            const folderFiles = this.app.vault
              .getMarkdownFiles()
              .filter(
                (f) =>
                  f.parent?.path === srcFolder && !f.basename.startsWith("_"),
              )
              .sort((a, b) => a.basename.localeCompare(b.basename));
            content = makeTableTemplate(
              this.plugin.settings.defaultTableDice,
              { linkedFolder: `"[[${srcFolder}]]"` },
              this.plugin.buildRollerLink(),
              folderFiles.map((f) => [`[[${f.basename}]]`, 1] as const),
            );
          } else {
            const rollerLink = this.plugin.buildRollerLink();
            content = makeTableTemplate(
              this.plugin.settings.defaultTableDice,
              undefined,
              rollerLink,
            );
          }
          file = await this.app.vault.create(newPath, content);
        } catch (err) {
          new Notice(`Could not create ${newPath}: ${String(err)}`);
          return;
        }
      }
      newInput.value = "";
      newInput.removeClass("duckmage-input-error");
      newInput.title = "";
      fromFolderInput.value = "";
      this.loadList();
      if (file instanceof TFile) await this.loadTable(file);
      // Re-render after vault I/O settles to ensure linkedFolder link styling is applied
      if (srcFolder) await this.renderDetail();
    };

    newBtn.addEventListener("click", () => {
      void createTable();
    });

    // "↺ Refresh list" is Debug: the list redraws on its own (see listRefresh.ts).
    const debugEl = listDisclosure.target("RTView.refreshList", listFooter);
    if (debugEl) {
      const refreshBtn = debugEl.createEl("button", { text: "Refresh list", cls: "duckmage-rt-icon-btn" });
      refreshBtn.addEventListener("click", () => void this.loadList());
    }
    listDisclosure.toEnd();
    newInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") void createTable();
    });

    // ── Right column: table detail ───────────────────────────────────────
    this.detailEl = contentEl.createDiv({ cls: "duckmage-rt-detail" });
    this.detailEl.createDiv({
      cls: "duckmage-rt-placeholder",
      text: "Select a table to view and roll.",
    });

    this.loadList();

    // ── The list redraws on its own (listRefresh.ts): notes and folders
    // added, removed or moved in the tables or workflows folder, and
    // changes to what it shows from their metadata. ─────────────────────
    const clearIfActive = (path: string) => {
      if (this.activeFile?.path !== path) return;
      this.activeFile = null;
      this.detailEl?.empty();
    };
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (touchesList(file.path, this.listFolders())) this.scheduleListRefresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!touchesList(file.path, this.listFolders())) return;
        clearIfActive(file.path);
        this.listSigs.forget(file.path);
        this.scheduleListRefresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        const f = this.listFolders();
        if (!touchesList(oldPath, f) && !touchesList(file.path, f)) return;
        if (file instanceof TFile && this.activeFile?.path === oldPath) this.activeFile = file;
        this.listSigs.rename(oldPath, file.path);
        this.scheduleListRefresh();
      }),
    );
    this.registerEvent(
      this.app.metadataCache.on("changed", (file, _data, cache) => {
        if (!touchesList(file.path, this.listFolders()) || file.basename.startsWith("_")) return;
        const sig = listSignature(this.isInWorkflowsFolder(file.path), cache);
        if (!this.listSigs.changed(file.path, sig, true)) return;
        this.scheduleListRefresh();
        // The open table's linked folder changed: bring its rows in line now.
        if (file === this.activeFile && this.viewMode === "tables") {
          void this.autoSyncLinkedFolder(file).then(() => this.scheduleDetailRefresh());
        }
      }),
    );
    // Frontmatter may not be cached yet when the view opens at startup.
    this.registerEvent(this.app.metadataCache.on("resolved", () => this.scheduleListRefresh()));
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file === this.activeFile)
          this.scheduleDetailRefresh();
      }),
    );

    // ── Auto-sync: note renamed/deleted in a linked folder → update its row ──
    const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
    const dirOf = (path: string) => normalizeFolder(path.slice(0, Math.max(0, path.lastIndexOf("/"))));
    const syncFolderTable = async (dir: string, change?: { removed?: string; renamed?: [string, string] }) => {
      const tableFilePath = this.linkedFolderMap.get(dir);
      if (!tableFilePath) return;
      const tableFile = this.app.vault.getAbstractFileByPath(tableFilePath);
      if (tableFile instanceof TFile) await this.autoSyncLinkedFolder(tableFile, change);
    };
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        const oldDir = dirOf(oldPath);
        const newDir = normalizeFolder(file.parent?.path ?? "");
        if (oldDir === newDir) {
          // Renamed in place: the row keeps its weight (a "_" name retires it).
          await syncFolderTable(newDir, { renamed: [baseOf(oldPath), file.basename] });
          return;
        }
        await syncFolderTable(oldDir, { removed: baseOf(oldPath) });
        await syncFolderTable(newDir);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", async (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        await syncFolderTable(dirOf(file.path), { removed: file.basename });
      }),
    );

    // ── Live sync: note created in a linked folder → add entry to table ──
    this.registerEvent(
      this.app.vault.on("create", async (createdFile) => {
        if (
          !(createdFile instanceof TFile) ||
          createdFile.extension !== "md" ||
          createdFile.basename.startsWith("_")
        )
          return;
        const dir = normalizeFolder(createdFile.parent?.path ?? "");
        const tableFilePath = this.linkedFolderMap.get(dir);
        if (!tableFilePath) return;
        await syncFolderTable(dir);
        this.scheduleListRefresh();
        if (this.activeFile?.path === tableFilePath) await this.renderDetail();
      }),
    );
    return Promise.resolve();
  }

  onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }

  // ── Public: open a specific table (called from hex editor / protocol handler) ──
  openTable(filePath: string): void {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      if (this.viewMode !== "tables") this.setViewMode("tables");
      // Expand ancestor folders so the target item is visible in the list
      let parent = file.parent;
      const tablesFolder = normalizeFolder(this.plugin.settings.tablesFolder);
      while (parent && parent.path !== tablesFolder && parent.path !== "/") {
        this.collapsedFolders.delete(parent.path);
        parent = parent.parent;
      }
      this.loadList();
      void this.loadTable(file);
    }
  }

  // ── Public: open a specific workflow (called from protocol handler) ──
  async openWorkflow(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      if (this.viewMode !== "workflows") {
        this.setViewMode("workflows");
        this.loadList();
      }
      await this.loadWorkflow(file);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private listFolders(): ListFolders {
    return {
      tables: normalizeFolder(this.plugin.settings.tablesFolder),
      workflows: normalizeFolder(this.plugin.settings.workflowsFolder),
    };
  }

  private isInWorkflowsFolder(filePath: string): boolean {
    const folder = normalizeFolder(this.plugin.settings.workflowsFolder);
    return !!folder && filePath.startsWith(folder + "/");
  }

  /** The shown mode's tab is the selected one (is-active + aria-pressed). */
  private markModeTabs(mode: "tables" | "workflows"): void {
    for (const [btn, m] of [[this.tablesBtn, "tables"], [this.workflowsBtn, "workflows"]] as const) {
      btn?.toggleClass("is-active", mode === m);
      btn?.setAttr("aria-pressed", String(mode === m));
    }
  }

  private setViewMode(mode: "tables" | "workflows"): void {
    this.viewMode = mode;
    this.markModeTabs(mode);
    if (this.tableFooterEl) {
      if (mode === "tables") this.tableFooterEl.show();
      else this.tableFooterEl.hide();
    }
    if (this.workflowFooterEl) {
      if (mode === "workflows") this.workflowFooterEl.show();
      else this.workflowFooterEl.hide();
    }
    this.filterQuery = "";
    this.activeFile = null;
    this.app.workspace.trigger("layout-change");
    this.detailEl?.empty();
    this.detailEl?.createDiv({
      cls: "duckmage-rt-placeholder",
      text:
        mode === "workflows"
          ? "Select a workflow to view."
          : "Select a table to view and roll.",
    });
    void this.loadList();
  }

  private scheduleListRefresh(): void {
    if (this.listRefreshTimer !== null) window.clearTimeout(this.listRefreshTimer);
    this.listRefreshTimer = window.setTimeout(() => {
      this.listRefreshTimer = null;
      void this.loadList();
    }, LIST_REFRESH_MS);
  }

  private scheduleDetailRefresh(): void {
    if (this.detailRefreshTimer !== null) window.clearTimeout(this.detailRefreshTimer);
    this.detailRefreshTimer = window.setTimeout(() => {
      this.detailRefreshTimer = null;
      if (this.viewMode === "workflows") {
        void this.renderWorkflowDetail();
      } else {
        void this.renderDetail();
      }
    }, DETAIL_REFRESH_MS);
  }

  // ── List ─────────────────────────────────────────────────────────────────

  private loadList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    if (this.viewMode === "workflows") {
      this.loadWorkflowList();
      return;
    }

    const folder = normalizeFolder(this.plugin.settings.tablesFolder);
    const prefix = folder ? folder + "/" : "";

    const allFiles = this.app.vault.getMarkdownFiles();
    let files = allFiles
      .filter(
        (f) =>
          (!prefix || f.path.startsWith(prefix)) && !f.basename.startsWith("_"),
      )
      .sort((a, b) => a.path.localeCompare(b.path));

    if (this.filterQuery) {
      files = files.filter((f) => {
        const rel = prefix ? f.path.slice(prefix.length) : f.path;
        return rel.toLowerCase().includes(this.filterQuery);
      });
    }

    // Rebuild linked folder map
    this.linkedFolderMap.clear();
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      this.listSigs.changed(file.path, listSignature(false, cache));
      const fm: Frontmatter | undefined = cache?.frontmatter;
      const lf: unknown = fm?.["linkedFolder"] ?? fm?.["linked-folder"];
      if (lf && typeof lf === "string") {
        const wikiLinkMatch = /^\[\[(.+?)\]\]$/.exec(lf);
        const lfClean = wikiLinkMatch ? wikiLinkMatch[1].trim() : lf;
        this.linkedFolderMap.set(normalizeFolder(lfClean), file.path);
      }
    }

    // Rebuild workflow map (table path → [workflow paths])
    this.rebuildWorkflowMap(allFiles);

    // Collect all vault subfolders under the tables root so empty folders appear
    const vaultFolderPaths: string[] = [];
    if (!this.filterQuery) {
      const rootAbstract = folder
        ? this.app.vault.getAbstractFileByPath(folder)
        : null;
      if (rootAbstract instanceof TFolder) {
        const collectFolders = (tf: TFolder) => {
          for (const child of tf.children) {
            if (child instanceof TFolder) {
              vaultFolderPaths.push(child.path);
              collectFolders(child);
            }
          }
        };
        collectFolders(rootAbstract);
      }
    }

    if (files.length === 0 && vaultFolderPaths.length === 0) {
      this.listEl.createSpan({
        text: "No tables found.",
        cls: "duckmage-rt-empty",
      });
      return;
    }

    // The user's own tables first; the terrain and region tables the map
    // made go under one collapsed "Made by the map" section at the end.
    const { own, mapMade } = groupTableFiles(this.app, files);
    // A folder holding only the map's tables isn't listed among the user's.
    const under = (f: TFile, folderPath: string) => f.path.startsWith(folderPath + "/");
    const ownFolders = vaultFolderPaths.filter((p) => own.some((f) => under(f, p)) || !mapMade.some((f) => under(f, p)));
    const tree = buildTree(own, prefix, ownFolders);
    const mapTree = buildTree(mapMade, prefix);

    // Collapse all folders on first load
    if (!this.treeInitialized) {
      this.treeInitialized = true;
      const collectFolders = (nodes: TreeNode[], keyPrefix = "") => {
        for (const n of nodes)
          if (n.type === "folder") {
            this.collapsedFolders.add(keyPrefix + n.path);
            collectFolders(n.children, keyPrefix);
          }
      };
      collectFolders(tree);
      collectFolders(mapTree, MAP_MADE_KEY);
      this.collapsedFolders.add(MAP_MADE_KEY);
    }

    // When filtering, render flat (expand all) so matches aren't hidden inside collapsed folders
    const forceExpanded = this.filterQuery !== "";
    this.renderTreeNodes(this.listEl, tree, forceExpanded);
    if (mapMade.length) this.renderMapMadeSection(this.listEl, mapTree, mapMade.length, forceExpanded);
  }

  /** The "Made by the map" section: one collapsible folder holding the map's own tables. */
  private renderMapMadeSection(container: HTMLElement, nodes: TreeNode[], count: number, forceExpanded: boolean): void {
    const section = container.createDiv({ cls: "duckmage-rt-folder duckmage-rt-map-made" });
    const header = section.createDiv({ cls: "duckmage-rt-folder-header" });
    const collapsed = !forceExpanded && this.collapsedFolders.has(MAP_MADE_KEY);
    const arrow = header.createSpan({ cls: "duckmage-rt-folder-arrow", text: collapsed ? "▶" : "▼" });
    header.createSpan({ cls: "duckmage-rt-folder-name", text: `${MAP_MADE_GROUP_LABEL} (${count})` });
    header.title = "Description and encounter tables made for each terrain, and encounter tables made for each region. Delete a table's table-type line to make it your own.";
    const children = section.createDiv({ cls: "duckmage-rt-folder-children" });
    if (collapsed) children.hide();
    this.renderTreeNodes(children, nodes, forceExpanded, MAP_MADE_KEY);
    header.addEventListener("click", () => {
      const nowCollapsed = !this.collapsedFolders.has(MAP_MADE_KEY);
      if (nowCollapsed) this.collapsedFolders.add(MAP_MADE_KEY);
      else this.collapsedFolders.delete(MAP_MADE_KEY);
      children.toggle(!nowCollapsed);
      arrow.setText(nowCollapsed ? "▶" : "▼");
    });
  }

  private rebuildWorkflowMap(allFiles?: TFile[]): void {
    this.workflowMap.clear();
    const wfFolder = normalizeFolder(this.plugin.settings.workflowsFolder);
    if (!wfFolder) return;
    const wfFiles = (allFiles ?? this.app.vault.getMarkdownFiles()).filter(
      (f) => f.path.startsWith(wfFolder + "/") && !f.basename.startsWith("_"),
    );
    for (const wf of wfFiles) {
      const cache = this.app.metadataCache.getFileCache(wf);
      this.listSigs.changed(wf.path, listSignature(true, cache));
      const links = cache?.links ?? [];
      for (const link of links) {
        const dest = this.app.metadataCache.getFirstLinkpathDest(
          link.link,
          wf.path,
        );
        if (!dest) continue;
        const key = dest.path.slice(0, -3);
        const existing = this.workflowMap.get(key) ?? [];
        existing.push(wf.path);
        this.workflowMap.set(key, existing);
      }
    }
  }

  private loadWorkflowList(): void {
    if (!this.listEl) return;
    const wfFolder = normalizeFolder(this.plugin.settings.workflowsFolder);
    if (!wfFolder) {
      this.listEl.createSpan({
        text: "No workflows folder configured. Set it in settings.",
        cls: "duckmage-rt-empty",
      });
      return;
    }

    // Exclude templates subfolder
    const templatesPath = wfFolder + "/templates/";
    let files = this.app.vault
      .getMarkdownFiles()
      .filter(
        (f) =>
          f.path.startsWith(wfFolder + "/") &&
          !f.basename.startsWith("_") &&
          !f.path.startsWith(templatesPath),
      )
      .sort((a, b) => a.path.localeCompare(b.path));

    if (this.filterQuery) {
      files = files.filter((f) => {
        const rel = f.path.slice(wfFolder.length + 1);
        return rel.toLowerCase().includes(this.filterQuery);
      });
    }

    if (files.length === 0) {
      this.listEl.createSpan({
        text: "No workflows found.",
        cls: "duckmage-rt-empty",
      });
      return;
    }

    const prefix = wfFolder + "/";
    const tree = buildTree(files, prefix);
    this.renderWorkflowTreeNodes(this.listEl, tree);
  }

  private renderWorkflowTreeNodes(
    container: HTMLElement,
    nodes: TreeNode[],
  ): void {
    renderFolderTree(container, nodes, {
      collapsedFolders: this.collapsedFolders,
      keyPrefix: "wf:",
      activeFile: this.activeFile,
      itemCls: "duckmage-rt-workflow-item",
      onFileClick: (file) => void this.loadWorkflow(file),
      decorateFile: (item, file) => {
        item.addEventListener("auxclick", (e: MouseEvent) => {
          if (e.button !== 1) return;
          e.preventDefault();
          const leaf = this.app.workspace.getLeaf("tab");
          void leaf.setViewState({
            type: VIEW_TYPE_RANDOM_TABLES,
            active: true,
            state: { filePath: file.path },
          });
          void this.app.workspace.revealLeaf(leaf);
        });
        item.addEventListener("contextmenu", (e: MouseEvent) => {
          e.preventDefault();
          const menu = new Menu();
          menu.addItem((menuItem) => {
            menuItem.setTitle("Open in new tab");
            menuItem.setIcon("external-link");
            menuItem.onClick(() => {
              const leaf = this.app.workspace.getLeaf("tab");
              void leaf.setViewState({
                type: VIEW_TYPE_RANDOM_TABLES,
                active: true,
                state: { filePath: file.path },
              });
              void this.app.workspace.revealLeaf(leaf);
            });
          });
          menu.addSeparator();
          menu.addItem((menuItem) => {
            menuItem.setTitle("Delete workflow");
            menuItem.setIcon("trash");
            menuItem.onClick(() => {
              // No confirm (owner Q6): it goes to the trash.
              void this.trashAndForget(file);
            });
          });
          menu.showAtMouseEvent(e);
        });
      },
    });
  }

  /** Move a table or workflow note to the trash (no confirm: owner Q6) and say so. */
  private async trashAndForget(file: TFile): Promise<void> {
    await this.app.fileManager.trashFile(file);
    if (this.activeFile === file) {
      this.activeFile = null;
      this.detailEl?.empty();
    }
    this.loadList();
    new Notice(`Moved "${file.basename}" to the trash.`);
  }

  private async createWorkflow(initialTablePath?: string): Promise<void> {
    const wfFolder = normalizeFolder(this.plugin.settings.workflowsFolder);
    if (!wfFolder) {
      new Notice("Configure a workflows folder in settings first.");
      return;
    }
    if (!this.app.vault.getAbstractFileByPath(wfFolder)) {
      try {
        await this.app.vault.createFolder(wfFolder);
      } catch {
        /* may exist */
      }
    }

    // Find unique name
    let baseName = "New Workflow";
    let i = 2;
    while (this.app.vault.getAbstractFileByPath(`${wfFolder}/${baseName}.md`)) {
      baseName = `New Workflow ${i++}`;
    }

    const autoLabel = initialTablePath
      ? (initialTablePath.split("/").pop() ?? initialTablePath).replace(
          / /g,
          "_",
        )
      : "";
    const steps = initialTablePath
      ? `| [[${initialTablePath}]] | 1 | ${autoLabel} |\n`
      : "";
    const content = `---\n---\n\n| Table | Rolls | Label |\n|-------|-------|-------|\n${steps}`;
    const newPath = `${wfFolder}/${baseName}.md`;

    try {
      const file = await this.app.vault.create(newPath, content);
      this.loadList();
      await this.loadWorkflow(file);
      new WorkflowEditorModal(this.app, this.plugin, file, () => {
        void this.loadList();
        if (this.activeFile === file) void this.renderWorkflowDetail();
      }).open();
    } catch (err) {
      new Notice(`Could not create workflow: ${String(err)}`);
    }
  }

  private async loadWorkflow(file: TFile): Promise<void> {
    this.activeFile = file;
    this.app.workspace.trigger("layout-change");
    this.listEl
      ?.querySelectorAll<HTMLElement>(".duckmage-rt-workflow-item")
      .forEach((el) => el.toggleClass("is-active", el.title === file.path));
    await this.renderWorkflowDetail();
  }

  private async renderWorkflowDetail(): Promise<void> {
    if (!this.detailEl || !this.activeFile) return;
    const file = this.activeFile;
    const content = await this.app.vault.read(file);
    const workflow = parseWorkflow(content, file.basename);

    this.detailEl.empty();

    // ── Header ─────────────────────────────────────────────────────────
    const header = this.detailEl.createDiv({
      cls: "duckmage-rt-detail-header",
    });
    header.createEl("h3", {
      text: tableTitle(file.path),
      cls: "duckmage-rt-detail-title",
    });

    const editLink = header.createEl("a", {
      text: "Edit",
      cls: "duckmage-rt-edit-link",
    });
    editLink.addEventListener("click", () => {
      void (async () => {
        const content = await this.app.vault.read(file);
        const wf = parseWorkflow(content, file.basename);
        let tmplContent = "";
        if (wf.templateFile) {
          const tmplFile = resolveWorkflowTemplate(this.app, wf.templateFile, file.path);
          if (tmplFile) {
            tmplContent = await this.app.vault.read(tmplFile);
          }
        }
        if (!tmplContent) tmplContent = generateDefaultTemplate(wf.steps);
        new WorkflowEditorModal(
          this.app,
          this.plugin,
          file,
          () => {
            void this.loadList();
            if (this.activeFile === file) void this.renderWorkflowDetail();
          },
          { content, templateContent: tmplContent },
        ).open();
      })();
    });

    const runBtn = this.detailEl.createEl("button", {
      text: "Roll workflow",
      cls: "duckmage-rt-roll-btn duckmage-rt-roll-btn-spaced mod-cta",
    });
    runBtn.addEventListener("click", () => {
      new WorkflowWizardModal(this.app, this.plugin, file).open();
    });

    const copyWfLinkBtn = this.detailEl.createEl("button", {
      text: "🔗 Copy link",
      cls: "duckmage-rt-copy-link-btn duckmage-rt-copy-link-btn-spaced",
    });
    copyWfLinkBtn.title = "Copy a Markdown link to open this workflow";
    copyWfLinkBtn.addEventListener("click", () => {
      const vault = encodeURIComponent(this.app.vault.getName());
      const path = encodeURIComponent(file.path);
      const link = `[🔗 ${file.basename}](obsidian://duckmage-workflow?vault=${vault}&file=${path})`;
      void navigator.clipboard.writeText(link).then(() => {
        copyWfLinkBtn.setText("Copied!");
        window.setTimeout(() => copyWfLinkBtn.setText("🔗 Copy link"), 1500);
      });
    });

    // ── Description ────────────────────────────────────────────────────
    if (workflow.description) {
      this.detailEl.createDiv({
        cls: "duckmage-wf-description",
        text: workflow.description,
      });
    }

    // ── Steps list ─────────────────────────────────────────────────────
    if (workflow.steps.length === 0) {
      this.detailEl.createDiv({
        cls: "duckmage-rt-empty",
        text: "No steps. Click Edit to add steps.",
      });
    } else {
      const stepsEl = this.detailEl.createDiv({
        cls: "duckmage-wf-detail-steps",
      });
      stepsEl.createEl("p", {
        text: "Steps",
        cls: "duckmage-rt-history-label",
      });
      const list = stepsEl.createEl("ul", { cls: "duckmage-wf-steps-list" });
      for (const step of workflow.steps) {
        const li = list.createEl("li");
        let primaryName: string;
        if (step.kind === "dice") {
          const formula = step.diceFormula ?? "dice";
          primaryName = `(${formula})`;
          li.createEl("code", {
            text: primaryName,
            cls: "duckmage-wf-step-formula",
          });
        } else {
          primaryName = step.tablePath.split("/").pop() ?? step.tablePath;
          const link = li.createEl("a", {
            text: primaryName,
            cls: "duckmage-rt-entry-link",
          });
          link.addEventListener("click", () => {
            const tableFile =
              this.app.vault.getAbstractFileByPath(step.tablePath + ".md") ??
              this.app.metadataCache.getFirstLinkpathDest(
                step.tablePath,
                this.activeFile?.path ?? "",
              );
            if (tableFile instanceof TFile) void this.openTable(tableFile.path);
          });
        }
        if (step.label && step.label !== primaryName) {
          li.createSpan({
            text: ` "${step.label}"`,
            cls: "duckmage-wf-step-alias",
          });
        }
        li.createSpan({ text: ` ×${step.rolls}` });
      }
    }

    // ── Template link + preview ─────────────────────────────────────────
    if (workflow.templateFile) {
      const tmplFile = resolveWorkflowTemplate(this.app, workflow.templateFile, file.path);
      if (tmplFile) {
        const tmplSection = this.detailEl.createDiv({
          cls: "duckmage-wf-template-section",
        });
        tmplSection.createEl("p", {
          text: "Template",
          cls: "duckmage-rt-history-label",
        });
        const tmplLink = tmplSection.createEl("a", {
          text: tmplFile.basename,
          cls: "duckmage-rt-entry-link",
        });
        tmplLink.addEventListener("click", () => {
          void this.app.workspace.getLeaf(false).openFile(tmplFile);
        });
        const tmplContent = await this.app.vault.read(tmplFile);
        const escapedContent = tmplContent.replace(/\$/g, "\\$");
        const preview = tmplSection.createDiv({
          cls: "duckmage-wf-template-preview",
        });
        await MarkdownRenderer.render(
          this.app,
          escapedContent,
          preview,
          tmplFile.path,
          this,
        );
      }
    }
  }

  private renderTreeNodes(
    container: HTMLElement,
    nodes: TreeNode[],
    forceExpanded: boolean,
    keyPrefix = "",
  ): void {
    renderFolderTree(container, nodes, {
      collapsedFolders: this.collapsedFolders,
      keyPrefix,
      activeFile: this.activeFile,
      forceExpanded,
      onFileClick: (file) => void this.loadTable(file),
      decorateFolder: (header, folderEl, node) => {
        // Exclusion badges
        const inRoll = this.plugin.settings.rollTableExcludedFolders.includes(node.path);
        const inEnc = this.plugin.settings.encounterTableExcludedFolders.includes(node.path);
        if (inRoll || inEnc) {
          const badges = header.createSpan({ cls: "duckmage-rt-folder-filter-badges" });
          if (inRoll) {
            const b = badges.createSpan({ cls: "duckmage-rt-folder-badge", text: "🎲✗" });
            b.title = "Excluded from roll picker";
          }
          if (inEnc) {
            const b = badges.createSpan({ cls: "duckmage-rt-folder-badge", text: "⚔✗" });
            b.title = "Excluded from encounters table";
          }
        }
        // Folder drop target
        let dragCounter = 0;
        folderEl.addEventListener("dragenter", (e: DragEvent) => {
          if (!e.dataTransfer?.types.includes("text/plain")) return;
          dragCounter++;
          header.addClass("is-drag-over");
        });
        folderEl.addEventListener("dragleave", () => {
          if (--dragCounter <= 0) { dragCounter = 0; header.removeClass("is-drag-over"); }
        });
        folderEl.addEventListener("dragover", (e: DragEvent) => {
          if (!e.dataTransfer?.types.includes("text/plain")) return;
          e.preventDefault();
          e.stopPropagation();
        });
        folderEl.addEventListener("drop", (e: DragEvent) => {
          void (async () => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter = 0;
            header.removeClass("is-drag-over");
            const srcPath = e.dataTransfer?.getData("text/plain") ?? "";
            const tblFolder = normalizeFolder(this.plugin.settings.tablesFolder);
            const destFolder = tblFolder ? `${tblFolder}/${node.path}` : node.path;
            await this.moveFileTo(srcPath, destFolder);
          })();
        });
        header.addEventListener("contextmenu", (e: MouseEvent) => {
          e.preventDefault();
          this.showFolderContextMenu(e, node.path);
        });
      },
      decorateFile: (item, file) => {
        item.addEventListener("auxclick", (e: MouseEvent) => {
          if (e.button !== 1) return;
          e.preventDefault();
          const leaf = this.app.workspace.getLeaf("tab");
          void leaf.setViewState({
            type: VIEW_TYPE_RANDOM_TABLES,
            active: true,
            state: { filePath: file.path },
          });
          void this.app.workspace.revealLeaf(leaf);
        });
        item.addEventListener("contextmenu", (e: MouseEvent) => {
          e.preventDefault();
          this.showFileContextMenu(e, file);
        });
        item.draggable = true;
        item.addEventListener("dragstart", (e: DragEvent) => {
          e.dataTransfer?.setData("text/plain", file.path);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          item.addClass("is-dragging");
        });
        item.addEventListener("dragend", () => item.removeClass("is-dragging"));
      },
    });
  }

  private showFolderContextMenu(e: MouseEvent, folderPath: string): void {
    const menu = new Menu();
    // Both items are Advanced; with nothing else in the menu they're shown directly.
    const layers = new PlacedMenu(menu, isDebugMode(this.app));

    const rollExcluded =
      this.plugin.settings.rollTableExcludedFolders.includes(folderPath);
    layers.add("RTView.folderMenuRollPicker", {
      label: rollExcluded ? "Include in roll picker" : "Exclude from roll picker",
      icon: "dice",
      isSet: rollExcluded,
      onClick: () => void (async () => {
        const arr = this.plugin.settings.rollTableExcludedFolders;
        if (rollExcluded) {
          this.plugin.settings.rollTableExcludedFolders = arr.filter(
            (p) => p !== folderPath,
          );
        } else {
          arr.push(folderPath);
        }
        await this.plugin.saveSettings();
        new Notice(
          `Roll picker: "${folderPath}" ${rollExcluded ? "included" : "excluded"}.`,
        );
        this.loadList();
      })(),
    });

    const encExcluded =
      this.plugin.settings.encounterTableExcludedFolders.includes(folderPath);
    layers.add("RTView.folderMenuEncounters", {
      label: encExcluded ? "Include in encounters table" : "Exclude from encounters table",
      icon: "sword",
      isSet: encExcluded,
      onClick: () => void (async () => {
        const arr = this.plugin.settings.encounterTableExcludedFolders;
        if (encExcluded) {
          this.plugin.settings.encounterTableExcludedFolders = arr.filter(
            (p) => p !== folderPath,
          );
        } else {
          arr.push(folderPath);
        }
        await this.plugin.saveSettings();
        new Notice(
          `Encounters table: "${folderPath}" ${encExcluded ? "included" : "excluded"}.`,
        );
        this.loadList();
      })(),
    });

    layers.finish(() => ({ x: e.clientX, y: e.clientY }));
    menu.showAtMouseEvent(e);
  }

  private showFileContextMenu(e: MouseEvent, file: TFile): void {
    const fm: Frontmatter | undefined =
      this.app.metadataCache.getFileCache(file)?.frontmatter;
    const rollExcluded = fm?.["roll-filter"] === false;
    const encExcluded = fm?.["encounter-filter"] === false;
    const isDefaultTable = fm?.["table-type"] != null;
    const menu = new Menu();
    const layers = new PlacedMenu(menu, isDebugMode(this.app));

    layers.addItem((item) => {
      item.setTitle("Open in new tab");
      item.setIcon("external-link");
      item.onClick(() => {
        const leaf = this.app.workspace.getLeaf("tab");
        void leaf.setViewState({
          type: VIEW_TYPE_RANDOM_TABLES,
          active: true,
          state: { filePath: file.path },
        });
        void this.app.workspace.revealLeaf(leaf);
      });
    });
    layers.add("RTView.fileMenuRollPicker", {
      label: rollExcluded ? "Include in roll picker" : "Exclude from roll picker",
      icon: "dice",
      isSet: rollExcluded,
      onClick: () => void (async () => {
        await this.app.fileManager.processFrontMatter(
          file,
          (fmData: Frontmatter) => {
            if (rollExcluded) delete fmData["roll-filter"];
            else fmData["roll-filter"] = false;
          },
        );
        new Notice(
          `Roll picker: "${file.basename}" ${rollExcluded ? "included" : "excluded"}.`,
        );
        this.loadList();
      })(),
    });

    layers.add("RTView.fileMenuEncounters", {
      label: encExcluded ? "Include in encounters table" : "Exclude from encounters table",
      icon: "sword",
      isSet: encExcluded,
      onClick: () => void (async () => {
        await this.app.fileManager.processFrontMatter(
          file,
          (fmData: Frontmatter) => {
            if (encExcluded) delete fmData["encounter-filter"];
            else fmData["encounter-filter"] = false;
          },
        );
        new Notice(
          `Encounters table: "${file.basename}" ${encExcluded ? "included" : "excluded"}.`,
        );
        this.loadList();
      })(),
    });

    if (!isDefaultTable) {
      layers.addSeparator();

      layers.addItem((item) => {
        item.setTitle("Delete table");
        item.setIcon("trash");
        item.onClick(() => {
          // No confirm (owner Q6): it goes to the trash.
          void this.trashAndForget(file);
        });
      });
    }

    // Roll picker / encounters filters: the Advanced ▸ submenu.
    layers.finish(() => ({ x: e.clientX, y: e.clientY }));
    menu.showAtMouseEvent(e);
  }

  // ── Move ──────────────────────────────────────────────────────────────────

  private async moveFileTo(
    srcPath: string,
    destFolderPath: string,
  ): Promise<void> {
    const srcFile = this.app.vault.getAbstractFileByPath(srcPath);
    if (!(srcFile instanceof TFile)) return;
    const newPath = destFolderPath
      ? `${destFolderPath}/${srcFile.name}`
      : srcFile.name;
    if (srcFile.path === newPath) return;
    const wasActive = this.activeFile === srcFile;
    try {
      await this.app.fileManager.renameFile(srcFile, newPath);
      this.loadList();
      if (wasActive) {
        const newFile = this.app.vault.getAbstractFileByPath(newPath);
        if (newFile instanceof TFile) void this.loadTable(newFile);
      }
    } catch (err) {
      new Notice(`Could not move "${srcFile.basename}": ${String(err)}`);
    }
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  private async loadTable(file: TFile): Promise<void> {
    this.activeFile = file;
    this.app.workspace.trigger("layout-change");
    this.rollHistory = [];
    this.listEl
      ?.querySelectorAll<HTMLElement>(".duckmage-rt-list-item")
      .forEach((el) => {
        el.toggleClass("is-active", el.title === file.path);
      });
    await this.autoSyncLinkedFolder(file);
    await this.renderDetail();
  }

  /**
   * If tableFile has a linkedFolder, bring its rows in line with the folder:
   * add rows for new notes; rename or remove the row of a note that was
   * renamed or deleted (`change`). Rows whose note is missing for other
   * reasons are kept and reported in the detail view. Only the table's own
   * lines are rewritten, and nothing is written when nothing changed.
   */
  private async autoSyncLinkedFolder(
    tableFile: TFile,
    change?: { removed?: string; renamed?: [string, string] },
  ): Promise<void> {
    const content = await this.app.vault.read(tableFile);
    const table = parseRandomTable(content);
    if (!table.linkedFolder) return;
    const lf = normalizeFolder(table.linkedFolder);
    const names = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.parent?.path === lf && !f.basename.startsWith("_"))
      .map((f) => f.basename);
    if (syncLinkedRows(content, names, change) === content) return;
    await processTableNote(this.app, tableFile, (cur) => syncLinkedRows(cur, names, change));
  }

  /**
   * Change the table's die: the frontmatter and the roll column (redone from
   * the weights, header renamed). With no die the column is kept as typed.
   */
  private async changeDie(file: TFile, newDice: number): Promise<void> {
    await processTableNote(this.app, file, (content) => {
      const { table, block } = parseRandomTableWithReport(content);
      const next = setDiceInFrontmatter(content, newDice);
      if (!block?.recognized) return next;
      return writeRollTable(next, {
        dice: newDice,
        rows: table.entries.map((entry, source) => ({ entry, source })),
        ranges: newDice > 0 ? "regenerate" : "keep",
      });
    });
  }

  /**
   * What couldn't be read, with one-click fixes. Ranges typed by hand are
   * never changed without a click here.
   */
  private renderIssues(file: TFile, report: TableReport, resolved: ResolvedTable): void {
    if (!this.detailEl) return;
    const { table, block } = report;
    const issues = report.issues.filter((i) => i.code !== "no-table");
    const noRanges = table.dice > 0 && !!block?.recognized && block.cols.range < 0 && table.entries.length > 0;
    if (!issues.length && !noRanges) return;
    const banner = this.detailEl.createDiv({ cls: "duckmage-rt-banner" });
    if (issues.length) {
      const list = banner.createEl("ul", { cls: "duckmage-rt-banner-list" });
      for (const i of issues.slice(0, 6)) list.createEl("li", { text: i.message });
      if (issues.length > 6) list.createEl("li", { text: `…and ${issues.length - 6} more. "Check tables" lists them all.` });
    }
    if (noRanges) {
      banner.createDiv({
        text: "This note has no roll column yet, so it can't be rolled by hand from the note. The ranges shown here are worked out from the weights.",
      });
    }
    const btns = banner.createDiv({ cls: "duckmage-rt-banner-btns" });
    const fix = (text: string, title: string, edit: (content: string) => string) => {
      const b = btns.createEl("button", { text });
      b.title = title;
      b.addEventListener("click", () => {
        void processTableNote(this.app, file, edit).then(() => this.renderDetail());
      });
    };
    const codes = new Set(issues.map((i) => i.code));
    const rewrite = (content: string, ranges: "keep" | "regenerate", weights?: (i: number) => number) => {
      const t = parseRandomTable(content);
      return writeRollTable(content, {
        dice: t.dice,
        rows: t.entries.map((entry, source) => ({ entry: weights ? { ...entry, weight: weights(source) } : entry, source })),
        ranges,
      });
    };
    if (resolved.mode === "ranges" && (codes.has("range-weight-mismatch") || codes.has("range-gap"))) {
      fix("Keep ranges → set weights", "Set each weight to the number of faces its range covers", (c) =>
        rewrite(c, "keep", (i) => resolveTable(parseRandomTable(c)).faces[i]?.length ?? 0),
      );
      fix("Keep weights → redo ranges", "Work every range out again from the weights", (c) => rewrite(c, "regenerate"));
    }
    if (codes.has("too-many-rows")) {
      const live = table.entries.filter((e) => e.weight > 0).length;
      const bigger = DIE_OPTIONS.find((o) => o.value !== 66 && dieFaces(o.value).length >= live && o.value > table.dice);
      if (bigger) {
        const b = btns.createEl("button", { text: `Use a ${bigger.label}` });
        b.title = `${live} rows need at least ${live} faces`;
        b.addEventListener("click", () => {
          void this.changeDie(file, bigger.value).then(() => this.renderDetail());
        });
      }
    }
    if (noRanges && !issues.some((i) => i.code !== "legacy-roller-link")) {
      fix("Add roll ranges", "Add a roll column worked out from the weights; weights and text stay as they are", (c) => {
        const plan = planTableMigration(c);
        return plan.action === "change" ? plan.content : c;
      });
    } else if (codes.has("legacy-roller-link")) {
      fix("Replace old roller link", "Swap the old obsidian:// link for the roller block", (c) => withRollerBlock(c));
    }
    if (!btns.childElementCount) btns.remove();
  }

  /** Linked-folder rows whose note doesn't exist (kept, and shown in the view). */
  private missingLinkedRows(table: RandomTable): string[] {
    if (!table.linkedFolder) return [];
    const lf = normalizeFolder(table.linkedFolder);
    return table.entries
      .filter((e) => !(this.app.vault.getAbstractFileByPath(`${lf}/${e.result}.md`) instanceof TFile))
      .map((e) => e.result);
  }

  private renderDetailSeq = 0;
  private async renderDetail(): Promise<void> {
    if (!this.detailEl || !this.activeFile) return;
    const file = this.activeFile;
    const seq = ++this.renderDetailSeq;

    const content = await this.app.vault.read(file);
    if (seq !== this.renderDetailSeq) return; // superseded by a newer call

    this.detailEl.empty();
    // The detail's Advanced dropdown (and Debug inside it), at its end.
    const detailEl = this.detailEl;
    const detailDisclosure = new Disclosure(this.app, "RTView.detail", () => detailEl);
    const report = parseRandomTableWithReport(content);
    const table = report.table;
    const resolved = resolveTable(table);
    // The ranges shown are the ones rolled (stored as typed, blanks filled).
    const ranges = table.dice > 0 ? resolved.labels : null;
    const odds = rowOdds(table, resolved);

    // ── Header ─────────────────────────────────────────────────────────
    const header = this.detailEl.createDiv({
      cls: "duckmage-rt-detail-header",
    });
    header.createEl("h3", {
      text: file.basename,
      cls: "duckmage-rt-detail-title",
    });

    const editLink = header.createEl("a", {
      text: "Edit",
      cls: "duckmage-rt-edit-link",
    });
    editLink.addEventListener("click", () => {
      void (async () => {
        const content = await this.app.vault.read(file);
        new RandomTableEditorModal(
          this.app,
          this.plugin,
          file,
          () => void this.renderDetail(),
          content,
        ).open();
      })();
    });

    const openNoteLink = header.createEl("a", {
      text: "Open note",
      cls: "duckmage-rt-edit-link",
    });
    openNoteLink.addEventListener("click", () => {
      void this.app.workspace.getLeaf().openFile(file);
    });

     
    const exportPdfLink = header.createEl("a", {
      text: "Export PDF",
      cls: "duckmage-rt-edit-link",
    });
    exportPdfLink.title = "Export this table as a printable PDF";
     
    exportPdfLink.addEventListener("click", () => {
      void exportRandomTableAsPdf(this.plugin, file);
    });

    const exportMdLink = header.createEl("a", {
      text: "Export Markdown",
      cls: "duckmage-rt-edit-link",
    });
    exportMdLink.title = "Export this table as clean Markdown";
    exportMdLink.addEventListener("click", () => {
      void exportRandomTableAsMarkdown(this.plugin, file);
    });

    // A linked folder's rows sync on their own (on open, and when notes in
    // the folder are added, renamed or deleted), so "Refresh" is Debug.
    const refreshHost = table.linkedFolder ? detailDisclosure.target("RTView.refreshLinked", header) : null;
    if (refreshHost) {
      const refreshBtn = refreshHost.createEl(refreshHost === header ? "a" : "button", {
        text: "Refresh",
        cls: refreshHost === header ? "duckmage-rt-edit-link" : "",
      });
      refreshBtn.title = `Sync entries from ${table.linkedFolder}`;
      refreshBtn.addEventListener("click", () => {
        void (async () => {
          await this.autoSyncLinkedFolder(file);
          await this.renderDetail();
        })();
      });
    }

    const dieSelect = header.createEl("select", {
      cls: "duckmage-rt-die-select",
    });
    for (const opt of DIE_OPTIONS) {
      const o = dieSelect.createEl("option", {
        value: String(opt.value),
        text: opt.label,
      });
      if (opt.value === table.dice) o.selected = true;
    }
    dieSelect.addEventListener("change", () => {
      void this.changeDie(file, parseInt(dieSelect.value, 10)).then(() => this.renderDetail());
    });

    // Linked-folder rows whose note is gone are kept; say so.
    const missing = this.missingLinkedRows(table);
    if (missing.length) {
      const them = missing.length === 1 ? "it" : "them";
      this.detailEl.createDiv({
        cls: "duckmage-rt-banner",
        text: `${missing.length === 1 ? "1 row has" : `${missing.length} rows have`} no note in ${table.linkedFolder}: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ", …" : ""}. Delete ${them} in the editor if the note is gone for good.`,
      });
    }
    this.renderIssues(file, report, resolved);

    // ── Description ────────────────────────────────────────────────────
    if (table.description) {
      const descSection = this.detailEl.createDiv({
        cls: "duckmage-rt-desc-section",
      });
      const descHeader = descSection.createDiv({
        cls: "duckmage-rt-desc-header",
      });
      const descCollapseBtn = descHeader.createEl("button", {
        text: "▼",
        cls: "duckmage-rt-collapse-btn",
      });
      descCollapseBtn.title = "Collapse description";
      descHeader.createSpan({
        text: "Description",
        cls: "duckmage-rt-section-label",
      });
      const descBody = descSection.createDiv({ cls: "duckmage-rt-desc-body" });
      void MarkdownRenderer.render(
        this.app,
        table.description,
        descBody,
        file.path,
        this,
      );
      descCollapseBtn.addEventListener("click", () => {
        const collapsed = descBody.style.display === "none";
        if (collapsed) descBody.show();
        else descBody.hide();
        descCollapseBtn.setText(collapsed ? "▼" : "▶");
        descCollapseBtn.title = collapsed
          ? "Collapse description"
          : "Expand description";
      });
    }

    // ── Odds table ─────────────────────────────────────────────────────
    const tableSection = this.detailEl.createDiv({
      cls: "duckmage-rt-table-section",
    });
    const tableSectionHeader = tableSection.createDiv({
      cls: "duckmage-rt-table-section-header",
    });
    const collapseBtn = tableSectionHeader.createEl("button", {
      text: "▼",
      cls: "duckmage-rt-collapse-btn",
    });
    collapseBtn.title = "Collapse table";
    const tableBody = tableSection.createDiv({ cls: "duckmage-rt-table-body" });

    collapseBtn.addEventListener("click", () => {
      const collapsed = tableBody.style.display === "none";
      if (collapsed) tableBody.show();
      else tableBody.hide();
      collapseBtn.setText(collapsed ? "▼" : "▶");
      collapseBtn.title = collapsed ? "Collapse table" : "Expand table";
    });

    if (table.entries.length === 0) {
      renderEmptyTableState(tableBody, { app: this.app, plugin: this.plugin, file, content, onSaved: () => void this.renderDetail() });
    } else {
      const tableEl = tableBody.createEl("table", {
        cls: "duckmage-random-table",
      });
      const thead = tableEl.createEl("thead");
      const headerRow = thead.createEl("tr");
      if (ranges) headerRow.createEl("th", { text: dieLabel(table.dice) });
      headerRow.createEl("th", { text: "Result" });
      headerRow.createEl("th", { text: "Odds" });
      // Row attributes and shared columns (Roll, Shown as, Once, When), read-only.
      const attrCols = [...new Set((table.rowInfo ?? []).flatMap((r) => Object.keys(r.attrs ?? {})))];
      for (const c of attrCols) headerRow.createEl("th", { text: c, cls: "duckmage-rt-attr-col" });
      headerRow.createEl("th", { cls: "duckmage-rt-copy-col-header" });

      const tbody = tableEl.createEl("tbody");
      table.entries.forEach((entry, i) => {
        const tr = tbody.createEl("tr");
        tr.dataset.index = String(i);
        if (ranges)
          tr.createEl("td", { text: ranges[i], cls: "duckmage-rt-range-cell" });

        // Result cell — clickable link for linkedFolder or isLink entries
        const resultTd = tr.createEl("td");
        if (table.linkedFolder) {
          const link = resultTd.createEl("a", {
            text: entry.result,
            cls: "duckmage-rt-entry-link",
          });
          link.addEventListener("click", (e) => {
            e.preventDefault();
            const noteFile = this.app.vault.getAbstractFileByPath(
              `${table.linkedFolder}/${entry.result}.md`,
            );
            if (noteFile instanceof TFile)
              void this.app.workspace.getLeaf().openFile(noteFile);
          });
        } else if (entry.isLink) {
          const label = entry.result.split("/").pop() ?? entry.result;
          const link = resultTd.createEl("a", {
            text: label,
            cls: "duckmage-rt-entry-link",
          });
          link.addEventListener("click", (e) => {
            e.preventDefault();
            const noteFile =
              this.app.vault.getAbstractFileByPath(entry.result + ".md") ??
              this.app.metadataCache.getFirstLinkpathDest(entry.result, "");
            if (noteFile instanceof TFile)
              void this.app.workspace.getLeaf().openFile(noteFile);
          });
        } else {
          resultTd.setText(entry.result);
        }

        tr.createEl("td", { text: odds[i], cls: "duckmage-rt-odds-cell" });
        const attrs = rowInfoOf(table, i).attrs ?? {};
        for (const c of attrCols) tr.createEl("td", { text: attrs[c] ?? "", cls: "duckmage-rt-attr-cell" });
        const copyTd = tr.createEl("td", {
          cls: "duckmage-rt-entry-copy-cell",
        });
        const copyBtn = copyTd.createEl("button", {
          text: "⎘",
          cls: "duckmage-rt-entry-copy-btn",
        });
        copyBtn.title = "Copy entry";
        copyBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          void navigator.clipboard.writeText(entry.result);
          copyBtn.setText("✓");
          window.setTimeout(() => copyBtn.setText("⎘"), 1200);
        });
      });
    }

    // ── Roll controls ──────────────────────────────────────────────────
    const rollArea = this.detailEl.createDiv({ cls: "duckmage-rt-roll-area" });

    // Roll first (the simple job); "Copy link" is Advanced.
    const copyLinkHost = detailDisclosure.target("RTView.copyRollLink", rollArea);
    const copyLinkBtn = (copyLinkHost ?? createDiv()).createEl("button", {
      text: "🎲 Copy link",
      cls: "duckmage-rt-copy-link-btn",
    });
    copyLinkBtn.title = "Copy a Markdown link to this table";
    copyLinkBtn.addEventListener("click", () => {
      const vault = encodeURIComponent(this.app.vault.getName());
      const path = encodeURIComponent(file.path);
      const link = `[🎲 ${file.basename}](obsidian://duckmage-roll?vault=${vault}&file=${path})`;
      void navigator.clipboard.writeText(link).then(() => {
        copyLinkBtn.setText("Copied!");
        window.setTimeout(() => copyLinkBtn.setText("🎲 Copy link"), 1500);
      });
    });

    const rollBtn = rollArea.createEl("button", {
      text: "Roll",
      cls: "duckmage-rt-roll-btn mod-cta",
    });
    setRollEnabled(rollBtn, table.entries.length > 0);

    const resultBox = this.detailEl.createDiv({ cls: "duckmage-roll-result" });
    resultBox.hide();
    // The simple job first: Roll and its result sit above the entries.
    tableSection.before(rollArea, resultBox);
    // "d20 → 14": the face rolled, so the roll can be checked against the note.
    const faceEl = resultBox.createDiv({ cls: "duckmage-roll-face" });
    const resultTextarea = resultBox.createEl("textarea", {
      cls: "duckmage-roll-result-textarea",
    });
    const resultBtns = resultBox.createDiv({
      cls: "duckmage-roll-result-btns",
    });
    const copyBtn = resultBtns.createEl("button", {
      text: "Copy",
      cls: "duckmage-roll-copy-btn",
    });
    copyBtn.addEventListener("click", () => {
      void navigator.clipboard.writeText(resultTextarea.value);
      copyBtn.setText("Copied!");
      window.setTimeout(() => copyBtn.setText("Copy"), 1500);
    });
    // "Open note" button — shown only when the table has a linked folder
    const openNoteBtn = resultBtns.createEl("button", {
      text: "Open note",
      cls: "duckmage-rt-open-note-btn",
    });
    openNoteBtn.hide();

    const historyEl = this.detailEl.createDiv({ cls: "duckmage-rt-history" });
    this.renderHistory(historyEl);

    rollBtn.addEventListener("click", () => {
      this.doRoll(table, resultBox, resultTextarea, historyEl, openNoteBtn, faceEl);
    });

    // ── Used by workflows ───────────────────────────────────────────────
    const tableKey = file.path.slice(0, -3); // remove .md
    const usingWorkflows = this.workflowMap.get(tableKey) ?? [];
    if (usingWorkflows.length > 0 || this.plugin.settings.workflowsFolder) {
      const usedBySection = this.detailEl.createDiv({
        cls: "duckmage-rt-used-by",
      });
      usedBySection.createDiv({
        text: "Workflows using this table",
        cls: "duckmage-rt-used-by-label",
      });
      const linksEl = usedBySection.createDiv({
        cls: "duckmage-rt-used-by-links",
      });

      for (const wfPath of usingWorkflows) {
        const wfFile = this.app.vault.getAbstractFileByPath(wfPath);
        if (!(wfFile instanceof TFile)) continue;
        const link = linksEl.createEl("a", {
          text: wfFile.basename,
          cls: "duckmage-rt-entry-link",
        });
        link.addEventListener("click", () => {
          this.setViewMode("workflows");
          // After mode switch, select the workflow
          window.setTimeout(() => {
            if (wfFile instanceof TFile) void this.loadWorkflow(wfFile);
          }, 50);
        });
      }

      const newWfLink = linksEl.createEl("a", {
        text: "+ new workflow with this table",
        cls: "duckmage-rt-entry-link duckmage-rt-new-wf-link",
      });
      newWfLink.addEventListener("click", () => {
        void (async () => {
          this.setViewMode("workflows");
          await this.createWorkflow(tableKey);
        })();
      });
    }
    detailDisclosure.toEnd();
  }

  private doRoll(
    table: RandomTable,
    resultBox: HTMLElement,
    resultTextarea: HTMLTextAreaElement,
    historyEl: HTMLElement,
    openNoteBtn?: HTMLButtonElement,
    faceEl?: HTMLElement,
  ): void {
    const outcome = rollTable(table);
    if (!outcome) return;
    const entry = outcome.entry;

    // Display label: basename for link entries, full result for plain entries
    const displayLabel = entry.isLink
      ? (entry.result.split("/").pop() ?? entry.result)
      : entry.result;

    this.detailEl
      ?.querySelectorAll<HTMLElement>(".duckmage-random-table tbody tr")
      .forEach((tr) => {
        tr.toggleClass("is-rolled", tr.dataset.index === String(outcome.index));
      });

    resultBox.show();
    if (faceEl) {
      const face = handRollLabel(table, outcome);
      faceEl.setText(face);
      faceEl.toggle(!!face);
    }
    resultTextarea.value = displayLabel;
    resultTextarea.focus();

    // Update "Open note" button
    if (openNoteBtn) {
      if (table.linkedFolder) {
        openNoteBtn.show();
        openNoteBtn.onclick = () => {
          const noteFile = this.app.vault.getAbstractFileByPath(
            `${table.linkedFolder}/${entry.result}.md`,
          );
          if (noteFile instanceof TFile)
            void this.app.workspace.getLeaf().openFile(noteFile);
        };
      } else if (entry.isLink) {
        openNoteBtn.show();
        openNoteBtn.onclick = () => {
          const noteFile =
            this.app.vault.getAbstractFileByPath(entry.result + ".md") ??
            this.app.metadataCache.getFirstLinkpathDest(entry.result, "");
          if (noteFile instanceof TFile)
            void this.app.workspace.getLeaf().openFile(noteFile);
        };
      } else {
        openNoteBtn.hide();
      }
    }

    this.rollHistory.unshift(displayLabel);
    if (this.rollHistory.length > 5) this.rollHistory.pop();
    this.renderHistory(historyEl);
  }

  private renderHistory(historyEl: HTMLElement): void {
    historyEl.empty();
    if (this.rollHistory.length === 0) return;
    historyEl.createEl("p", {
      text: "Recent rolls:",
      cls: "duckmage-rt-history-label",
    });
    const list = historyEl.createEl("ul", { cls: "duckmage-rt-history-list" });
    for (const result of this.rollHistory) {
      const li = list.createEl("li", { cls: "duckmage-rt-history-item" });
      li.createSpan({ text: result });
      const copyIcon = li.createEl("button", {
        text: "⎘",
        cls: "duckmage-rt-history-copy",
      });
      copyIcon.title = "Copy";
      copyIcon.addEventListener(
        "click",
        () => void navigator.clipboard.writeText(result),
      );
    }
  }
}
