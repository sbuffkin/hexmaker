import {
  ItemView,
  MarkdownRenderer,
  Menu,
  Modal,
  Notice,
  TFile,
  ViewStateResult,
  WorkspaceLeaf,
} from "obsidian";
import type DuckmagePlugin from "./DuckmagePlugin";
import { VIEW_TYPE_RANDOM_TABLES } from "./constants";
import { normalizeFolder, makeTableTemplate } from "./utils";
import { RandomTableEditorModal } from "./RandomTableEditorModal";
import {
  parseRandomTable,
  rollOnTable,
  getDieRanges,
  getOddsLabel,
  setDiceInFrontmatter,
  type RandomTable,
  type RandomTableEntry,
} from "./randomTable";

const DIE_OPTIONS = [
  { label: "— no die —", value: 0 },
  { label: "d4", value: 4 },
  { label: "d6", value: 6 },
  { label: "d8", value: 8 },
  { label: "d10", value: 10 },
  { label: "d12", value: 12 },
  { label: "d20", value: 20 },
  { label: "d100", value: 100 },
  { label: "d200", value: 200 },
  { label: "d500", value: 500 },
  { label: "d1000", value: 1000 },
];

interface FileNode {
  type: "file";
  file: TFile;
}
interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}
type TreeNode = FileNode | FolderNode;

export class RandomTableView extends ItemView {
  private listEl: HTMLElement | null = null;
  private detailEl: HTMLElement | null = null;
  private activeFile: TFile | null = null;
  private rollHistory: string[] = [];
  private collapsedFolders: Set<string> = new Set();
  private filterQuery = "";
  private treeInitialized = false;
  private linkedFolderMap: Map<string, string> = new Map(); // folder path → table file path
  private listRefreshTimer: number | null = null;
  private detailRefreshTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: DuckmagePlugin,
  ) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_RANDOM_TABLES;
  }
  getDisplayText() {
    return "Random tables";
  }
  getIcon() {
    return "dice";
  }

  async setState(state: any, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    if (state?.filePath) {
      const file = this.app.vault.getAbstractFileByPath(state.filePath);
      if (file instanceof TFile) {
        await this.loadList();
        this.loadTable(file);
      }
    }
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("duckmage-rt-container");

    // ── Left column: table list ──────────────────────────────────────────
    const leftCol = contentEl.createDiv({ cls: "duckmage-rt-left" });

    const listHeader = leftCol.createDiv({ cls: "duckmage-rt-list-header" });
    listHeader.createEl("span", {
      text: "Tables",
      cls: "duckmage-rt-list-title",
    });
    const refreshBtn = listHeader.createEl("button", {
      text: "↺",
      cls: "duckmage-rt-icon-btn",
    });
    refreshBtn.title = "Refresh list";
    refreshBtn.addEventListener("click", () => this.loadList());

    const searchInput = leftCol.createEl("input", {
      type: "text",
      cls: "duckmage-rt-search",
    });
    searchInput.placeholder = "Filter tables…";
    searchInput.addEventListener("input", () => {
      this.filterQuery = searchInput.value.toLowerCase().trim();
      this.loadList();
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
      if (--listDragCounter <= 0) { listDragCounter = 0; this.listEl!.removeClass("is-drag-over-root"); }
    });
    this.listEl.addEventListener("dragover", (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("text/plain")) return;
      e.preventDefault();
    });
    this.listEl.addEventListener("drop", async (e: DragEvent) => {
      e.preventDefault();
      listDragCounter = 0;
      this.listEl!.removeClass("is-drag-over-root");
      const srcPath = e.dataTransfer?.getData("text/plain") ?? "";
      await this.moveFileTo(srcPath, normalizeFolder(this.plugin.settings.tablesFolder));
    });

    const listFooter = leftCol.createDiv({ cls: "duckmage-rt-list-footer" });
    const newRow = listFooter.createDiv({ cls: "duckmage-rt-new-row" });
    const newInput = newRow.createEl("input", {
      type: "text",
      cls: "duckmage-rt-new-input",
    });
    newInput.placeholder = "New table name…";
    newInput.addEventListener("input", () => {
      const name = newInput.value.trim();
      if (!name) { newInput.removeClass("duckmage-input-error"); newInput.title = ""; return; }
      const folder = normalizeFolder(this.plugin.settings.tablesFolder);
      const checkPath = folder ? `${folder}/${name}.md` : `${name}.md`;
      const exists = this.app.vault.getAbstractFileByPath(checkPath) instanceof TFile;
      if (exists) {
        newInput.addClass("duckmage-input-error");
        newInput.title = `"${name}" already exists.`;
      } else {
        newInput.removeClass("duckmage-input-error");
        newInput.title = "";
      }
    });
    const newBtn = newRow.createEl("button", {
      text: "+ New",
      cls: "duckmage-rt-new-btn",
    });
    const fromFolderInput = listFooter.createEl("input", {
      type: "text",
      cls: "duckmage-rt-from-folder-input",
      attr: { placeholder: "Generate from folder link (optional)…" },
    });

    const createTable = async () => {
      const name = newInput.value.trim();
      if (!name || newInput.hasClass("duckmage-input-error")) return;
      const folder = normalizeFolder(this.plugin.settings.tablesFolder);
      const newPath = folder ? `${folder}/${name}.md` : `${name}.md`;
      let file = this.app.vault.getAbstractFileByPath(newPath);
      if (!(file instanceof TFile)) {
        try {
          if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder);
          }
          const srcFolder = normalizeFolder(fromFolderInput.value.trim());
          let content: string;
          if (srcFolder) {
            const folderFiles = this.app.vault
              .getMarkdownFiles()
              .filter((f) => f.parent?.path === srcFolder && !f.basename.startsWith("_"))
              .sort((a, b) => a.basename.localeCompare(b.basename));
            const rollerLink = this.plugin.buildRollerLink(newPath);
            const entryRows = folderFiles
              .map((f) => `| ${f.basename} | 1 |`)
              .join("\n");
            content = `---\ndice: ${this.plugin.settings.defaultTableDice}\nlinked-folder: ${srcFolder}\n---\n\n${rollerLink}\n\n| Result | Weight |\n|--------|--------|\n${entryRows || "|  | 1 |"}\n`;
          } else {
            const rollerLink = this.plugin.buildRollerLink(newPath);
            content = makeTableTemplate(
              this.plugin.settings.defaultTableDice,
              undefined,
              rollerLink,
            );
          }
          file = await this.app.vault.create(newPath, content);
        } catch (err) {
          new Notice(`Could not create ${newPath}: ${err}`);
          return;
        }
      }
      newInput.value = "";
      newInput.removeClass("duckmage-input-error");
      newInput.title = "";
      fromFolderInput.value = "";
      await this.loadList();
      this.loadTable(file as TFile);
    };

    newBtn.addEventListener("click", createTable);
    newInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") createTable();
    });

    // ── Right column: table detail ───────────────────────────────────────
    this.detailEl = contentEl.createDiv({ cls: "duckmage-rt-detail" });
    this.detailEl.createDiv({
      cls: "duckmage-rt-placeholder",
      text: "Select a table to view and roll.",
    });

    await this.loadList();

    // ── Proactive tree refresh on vault changes ───────────────────────────
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && !file.basename.startsWith("_") && this.isInTablesFolder(file.path))
          this.scheduleListRefresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!(file instanceof TFile) || !this.isInTablesFolder(file.path)) return;
        if (this.activeFile === file) {
          this.activeFile = null;
          this.detailEl?.empty();
        }
        this.scheduleListRefresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        const wasIn = this.isInTablesFolder(oldPath);
        const isIn = this.isInTablesFolder(file.path);
        if (!wasIn && !isIn) return;
        if (this.activeFile?.path === oldPath) this.activeFile = file;
        this.scheduleListRefresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file === this.activeFile) this.scheduleDetailRefresh();
      }),
    );

    // ── Live sync: note created in a linked folder → add entry to table ──
    this.registerEvent(
      this.app.vault.on("create", async (createdFile) => {
        if (!(createdFile instanceof TFile) || createdFile.extension !== "md" || createdFile.basename.startsWith("_"))
          return;
        const dir = normalizeFolder(createdFile.parent?.path ?? "");
        const tableFilePath = this.linkedFolderMap.get(dir);
        if (!tableFilePath) return;
        const tableFile = this.app.vault.getAbstractFileByPath(tableFilePath);
        if (!(tableFile instanceof TFile)) return;
        const content = await this.app.vault.read(tableFile);
        const table = parseRandomTable(content);
        if (table.entries.some((e) => e.result === createdFile.basename))
          return;
        // Append new row to the markdown table block in the file
        const newRow = `| ${createdFile.basename} | 1 |`;
        const updated = content.replace(
          /(\| Result \| Weight \|\n\|[-| ]+\|\n)([\s\S]*)$/,
          (_, hdr, body) =>
            `${hdr}${body.trimEnd() ? body.trimEnd() + "\n" : ""}${newRow}\n`,
        );
        await this.app.vault.modify(tableFile, updated);
        await this.loadList();
        if (this.activeFile?.path === tableFilePath) await this.renderDetail();
      }),
    );
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  // ── Public: open a specific table (called from hex editor / protocol handler) ──
  async openTable(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      await this.loadList();
      this.loadTable(file);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private isInTablesFolder(filePath: string): boolean {
    const folder = normalizeFolder(this.plugin.settings.tablesFolder);
    return !folder || filePath.startsWith(folder + "/");
  }

  private scheduleListRefresh(): void {
    if (this.listRefreshTimer !== null) clearTimeout(this.listRefreshTimer);
    this.listRefreshTimer = window.setTimeout(() => {
      this.listRefreshTimer = null;
      void this.loadList();
    }, 200);
  }

  private scheduleDetailRefresh(): void {
    if (this.detailRefreshTimer !== null) clearTimeout(this.detailRefreshTimer);
    this.detailRefreshTimer = window.setTimeout(() => {
      this.detailRefreshTimer = null;
      void this.renderDetail();
    }, 300);
  }

  // ── Tree building ─────────────────────────────────────────────────────────

  private buildTree(files: TFile[], prefix: string): TreeNode[] {
    const root: FolderNode = {
      type: "folder",
      name: "",
      path: "",
      children: [],
    };

    for (const file of files) {
      const rel = prefix ? file.path.slice(prefix.length) : file.path;
      const parts = rel.split("/");
      let current = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const folderName = parts[i];
        const folderPath = parts.slice(0, i + 1).join("/");
        let child = current.children.find(
          (c): c is FolderNode => c.type === "folder" && c.name === folderName,
        );
        if (!child) {
          child = {
            type: "folder",
            name: folderName,
            path: folderPath,
            children: [],
          };
          current.children.push(child);
        }
        current = child;
      }
      current.children.push({ type: "file", file });
    }

    const sortChildren = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        const aName = a.type === "folder" ? a.name : a.file.basename;
        const bName = b.type === "folder" ? b.name : b.file.basename;
        return aName.localeCompare(bName);
      });
      for (const node of nodes) {
        if (node.type === "folder") sortChildren(node.children);
      }
    };
    sortChildren(root.children);

    return root.children;
  }

  // ── List ─────────────────────────────────────────────────────────────────

  private async loadList(): Promise<void> {
    if (!this.listEl) return;
    this.listEl.empty();

    const folder = normalizeFolder(this.plugin.settings.tablesFolder);
    const prefix = folder ? folder + "/" : "";

    let files = this.app.vault
      .getMarkdownFiles()
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
      const lf =
        this.app.metadataCache.getFileCache(file)?.frontmatter?.[
          "linked-folder"
        ];
      if (lf)
        this.linkedFolderMap.set(normalizeFolder(lf as string), file.path);
    }

    if (files.length === 0) {
      this.listEl.createSpan({
        text: "No tables found.",
        cls: "duckmage-rt-empty",
      });
      return;
    }

    const tree = this.buildTree(files, prefix);

    // Collapse all folders on first load
    if (!this.treeInitialized) {
      this.treeInitialized = true;
      const collectFolders = (nodes: TreeNode[]) => {
        for (const n of nodes)
          if (n.type === "folder") {
            this.collapsedFolders.add(n.path);
            collectFolders(n.children);
          }
      };
      collectFolders(tree);
    }

    // When filtering, render flat (expand all) so matches aren't hidden inside collapsed folders
    this.renderTreeNodes(this.listEl, tree, this.filterQuery !== "");
  }

  private renderTreeNodes(
    container: HTMLElement,
    nodes: TreeNode[],
    forceExpanded: boolean,
  ): void {
    for (const node of nodes) {
      if (node.type === "folder") {
        const isCollapsed =
          !forceExpanded && this.collapsedFolders.has(node.path);

        const folderEl = container.createDiv({ cls: "duckmage-rt-folder" });
        const folderHeader = folderEl.createDiv({
          cls: "duckmage-rt-folder-header",
        });
        const arrow = folderHeader.createSpan({
          cls: "duckmage-rt-folder-arrow",
          text: isCollapsed ? "▶" : "▼",
        });
        folderHeader.createSpan({
          cls: "duckmage-rt-folder-name",
          text: node.name,
        });

        // Exclusion badges
        const inRoll = this.plugin.settings.rollTableExcludedFolders.includes(
          node.path,
        );
        const inEnc =
          this.plugin.settings.encounterTableExcludedFolders.includes(
            node.path,
          );
        if (inRoll || inEnc) {
          const badges = folderHeader.createSpan({
            cls: "duckmage-rt-folder-filter-badges",
          });
          if (inRoll) {
            const b = badges.createSpan({
              cls: "duckmage-rt-folder-badge",
              text: "🎲✗",
            });
            b.title = "Excluded from roll picker";
          }
          if (inEnc) {
            const b = badges.createSpan({
              cls: "duckmage-rt-folder-badge",
              text: "⚔✗",
            });
            b.title = "Excluded from encounters table";
          }
        }

        const childrenEl = folderEl.createDiv({
          cls: "duckmage-rt-folder-children",
        });
        if (isCollapsed) childrenEl.style.display = "none";

        this.renderTreeNodes(childrenEl, node.children, forceExpanded);

        // Folder drop target — accept dragged table files
        let dragCounter = 0;
        folderEl.addEventListener("dragenter", (e: DragEvent) => {
          if (!e.dataTransfer?.types.includes("text/plain")) return;
          dragCounter++;
          folderHeader.addClass("is-drag-over");
        });
        folderEl.addEventListener("dragleave", () => {
          if (--dragCounter <= 0) { dragCounter = 0; folderHeader.removeClass("is-drag-over"); }
        });
        folderEl.addEventListener("dragover", (e: DragEvent) => {
          if (!e.dataTransfer?.types.includes("text/plain")) return;
          e.preventDefault();
          e.stopPropagation(); // don't let the root list show its highlight
        });
        folderEl.addEventListener("drop", async (e: DragEvent) => {
          e.preventDefault();
          e.stopPropagation();
          dragCounter = 0;
          folderHeader.removeClass("is-drag-over");
          const srcPath = e.dataTransfer?.getData("text/plain") ?? "";
          const tblFolder = normalizeFolder(this.plugin.settings.tablesFolder);
          const destFolder = tblFolder ? `${tblFolder}/${node.path}` : node.path;
          await this.moveFileTo(srcPath, destFolder);
        });

        folderHeader.addEventListener("contextmenu", (e: MouseEvent) => {
          e.preventDefault();
          this.showFolderContextMenu(e, node.path);
        });

        folderHeader.addEventListener("click", () => {
          const nowCollapsed = !this.collapsedFolders.has(node.path);
          if (nowCollapsed) {
            this.collapsedFolders.add(node.path);
            childrenEl.style.display = "none";
            arrow.textContent = "▶";
          } else {
            this.collapsedFolders.delete(node.path);
            childrenEl.style.display = "";
            arrow.textContent = "▼";
          }
        });
      } else {
        const row = container.createDiv({ cls: "duckmage-rt-list-item" });
        if (node.file === this.activeFile) row.addClass("is-active");
        row.setText(node.file.basename);
        row.title = node.file.path;
        row.addEventListener("click", () => this.loadTable(node.file));
        row.addEventListener("contextmenu", (e: MouseEvent) => {
          e.preventDefault();
          this.showFileContextMenu(e, node.file);
        });
        row.draggable = true;
        row.addEventListener("dragstart", (e: DragEvent) => {
          e.dataTransfer?.setData("text/plain", node.file.path);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
          row.addClass("is-dragging");
        });
        row.addEventListener("dragend", () => row.removeClass("is-dragging"));
      }
    }
  }

  private showFolderContextMenu(e: MouseEvent, folderPath: string): void {
    const menu = new Menu();

    const rollExcluded =
      this.plugin.settings.rollTableExcludedFolders.includes(folderPath);
    menu.addItem((item) => {
      item.setTitle(
        rollExcluded ? "Include in roll picker" : "Exclude from roll picker",
      );
      item.setIcon("dice");
      item.onClick(async () => {
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
        await this.loadList();
      });
    });

    const encExcluded =
      this.plugin.settings.encounterTableExcludedFolders.includes(folderPath);
    menu.addItem((item) => {
      item.setTitle(
        encExcluded
          ? "Include in encounters table"
          : "Exclude from encounters table",
      );
      item.setIcon("sword");
      item.onClick(async () => {
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
        await this.loadList();
      });
    });

    menu.showAtMouseEvent(e);
  }

  private showFileContextMenu(e: MouseEvent, file: TFile): void {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const rollExcluded = fm?.["roll-filter"] === false;
    const encExcluded = fm?.["encounter-filter"] === false;
    const isDefaultTable = fm?.["table-type"] != null;
    const menu = new Menu();

    menu.addItem((item) => {
      item.setTitle(rollExcluded ? "Include in roll picker" : "Exclude from roll picker");
      item.setIcon("dice");
      item.onClick(async () => {
        await this.app.fileManager.processFrontMatter(file, (fmData) => {
          if (rollExcluded) delete fmData["roll-filter"];
          else fmData["roll-filter"] = false;
        });
        new Notice(`Roll picker: "${file.basename}" ${rollExcluded ? "included" : "excluded"}.`);
        await this.loadList();
      });
    });

    menu.addItem((item) => {
      item.setTitle(encExcluded ? "Include in encounters table" : "Exclude from encounters table");
      item.setIcon("sword");
      item.onClick(async () => {
        await this.app.fileManager.processFrontMatter(file, (fmData) => {
          if (encExcluded) delete fmData["encounter-filter"];
          else fmData["encounter-filter"] = false;
        });
        new Notice(`Encounters table: "${file.basename}" ${encExcluded ? "included" : "excluded"}.`);
        await this.loadList();
      });
    });

    if (!isDefaultTable) {
      menu.addSeparator();

      menu.addItem((item) => {
        item.setTitle("Delete table");
        item.setIcon("trash");
        item.onClick(() => {
          new ConfirmDeleteModal(this.app, file.basename, async () => {
            await this.app.fileManager.trashFile(file);
            if (this.activeFile === file) {
              this.activeFile = null;
              this.detailEl?.empty();
            }
            await this.loadList();
          }).open();
        });
      });
    }

    menu.showAtMouseEvent(e);
  }

  // ── Move ──────────────────────────────────────────────────────────────────

  private async moveFileTo(srcPath: string, destFolderPath: string): Promise<void> {
    const srcFile = this.app.vault.getAbstractFileByPath(srcPath);
    if (!(srcFile instanceof TFile)) return;
    const newPath = destFolderPath ? `${destFolderPath}/${srcFile.name}` : srcFile.name;
    if (srcFile.path === newPath) return;
    const wasActive = this.activeFile === srcFile;
    try {
      await this.app.fileManager.renameFile(srcFile, newPath);
      await this.loadList();
      if (wasActive) {
        const newFile = this.app.vault.getAbstractFileByPath(newPath);
        if (newFile instanceof TFile) this.loadTable(newFile);
      }
    } catch (err) {
      new Notice(`Could not move "${srcFile.basename}": ${err}`);
    }
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  private async loadTable(file: TFile): Promise<void> {
    this.activeFile = file;
    this.rollHistory = [];
    this.listEl
      ?.querySelectorAll<HTMLElement>(".duckmage-rt-list-item")
      .forEach((el) => {
        el.toggleClass("is-active", el.title === file.path);
      });
    await this.renderDetail();
  }

  private renderDetailSeq = 0;
  private async renderDetail(): Promise<void> {
    if (!this.detailEl || !this.activeFile) return;
    const file = this.activeFile;
    const seq = ++this.renderDetailSeq;

    const content = await this.app.vault.read(file);
    if (seq !== this.renderDetailSeq) return; // superseded by a newer call

    this.detailEl.empty();
    const table = parseRandomTable(content);
    const ranges = table.dice > 0 ? getDieRanges(table) : null;

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
      new RandomTableEditorModal(this.app, this.plugin, file, () =>
        this.renderDetail(),
      ).open();
    });

    const openNoteLink = header.createEl("a", {
      text: "Open note",
      cls: "duckmage-rt-edit-link",
    });
    openNoteLink.addEventListener("click", () => {
      this.app.workspace.getLeaf(false).openFile(file);
    });

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
    dieSelect.addEventListener("change", async () => {
      const newDice = parseInt(dieSelect.value, 10);
      const updated = setDiceInFrontmatter(
        await this.app.vault.read(file),
        newDice,
      );
      await this.app.vault.modify(file, updated);
      await this.renderDetail();
    });

    // ── Description ────────────────────────────────────────────────────
    if (table.description) {
      const descSection = this.detailEl.createDiv({ cls: "duckmage-rt-desc-section" });
      const descHeader = descSection.createDiv({ cls: "duckmage-rt-desc-header" });
      const descCollapseBtn = descHeader.createEl("button", {
        text: "▼",
        cls: "duckmage-rt-collapse-btn",
      });
      descCollapseBtn.title = "Collapse description";
      const descBody = descSection.createDiv({ cls: "duckmage-rt-desc-body" });
      MarkdownRenderer.render(this.app, table.description, descBody, file.path, this);
      descCollapseBtn.addEventListener("click", () => {
        const collapsed = descBody.style.display === "none";
        descBody.style.display = collapsed ? "" : "none";
        descCollapseBtn.setText(collapsed ? "▼" : "▶");
        descCollapseBtn.title = collapsed ? "Collapse description" : "Expand description";
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
      tableBody.style.display = collapsed ? "" : "none";
      collapseBtn.setText(collapsed ? "▼" : "▶");
      collapseBtn.title = collapsed ? "Collapse table" : "Expand table";
    });

    if (table.entries.length === 0) {
      tableBody.createDiv({
        cls: "duckmage-rt-empty",
        text: "No entries found. Check the table format.",
      });
    } else {
      const tableEl = tableBody.createEl("table", {
        cls: "duckmage-random-table",
      });
      const thead = tableEl.createEl("thead");
      const headerRow = thead.createEl("tr");
      if (ranges) headerRow.createEl("th", { text: `d${table.dice}` });
      headerRow.createEl("th", { text: "Result" });
      headerRow.createEl("th", { text: "Odds" });
      headerRow.createEl("th", { cls: "duckmage-rt-copy-col-header" });

      const tbody = tableEl.createEl("tbody");
      table.entries.forEach((entry, i) => {
        const tr = tbody.createEl("tr");
        tr.dataset.index = String(i);
        if (ranges)
          tr.createEl("td", { text: ranges[i], cls: "duckmage-rt-range-cell" });

        // Result cell — clickable link if table has a linked folder
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
              this.app.workspace.getLeaf(false).openFile(noteFile);
          });
        } else {
          resultTd.setText(entry.result);
        }

        const pct = `${Math.round((entry.weight / table.entries.reduce((s, e) => s + e.weight, 0)) * 100)}%`;
        tr.createEl("td", { text: pct, cls: "duckmage-rt-odds-cell" });
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
          navigator.clipboard.writeText(entry.result);
          copyBtn.setText("✓");
          setTimeout(() => copyBtn.setText("⎘"), 1200);
        });

      });
    }

    // ── Roll controls ──────────────────────────────────────────────────
    const rollArea = this.detailEl.createDiv({ cls: "duckmage-rt-roll-area" });

    const copyLinkBtn = rollArea.createEl("button", {
      text: "🎲 Copy link",
      cls: "duckmage-rt-copy-link-btn",
    });
    copyLinkBtn.title = "Copy a markdown link to this table";
    copyLinkBtn.addEventListener("click", () => {
      const vault = encodeURIComponent(this.app.vault.getName());
      const path = encodeURIComponent(file.path);
      const link = `[🎲 ${file.basename}](obsidian://duckmage-roll?vault=${vault}&file=${path})`;
      navigator.clipboard.writeText(link).then(() => {
        copyLinkBtn.setText("Copied!");
        setTimeout(() => copyLinkBtn.setText("🎲 Copy link"), 1500);
      });
    });

    const rollBtn = rollArea.createEl("button", {
      text: "Roll",
      cls: "duckmage-rt-roll-btn mod-cta",
    });

    const resultBox = this.detailEl.createDiv({ cls: "duckmage-roll-result" });
    resultBox.style.display = "none";
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
      navigator.clipboard.writeText(resultTextarea.value);
      copyBtn.setText("Copied!");
      setTimeout(() => copyBtn.setText("Copy"), 1500);
    });
    // "Open note" button — shown only when the table has a linked folder
    const openNoteBtn = resultBtns.createEl("button", {
      text: "Open note",
      cls: "duckmage-rt-open-note-btn",
    });
    openNoteBtn.style.display = "none";

    const historyEl = this.detailEl.createDiv({ cls: "duckmage-rt-history" });
    this.renderHistory(historyEl);

    rollBtn.addEventListener("click", () => {
      this.doRoll(table, resultBox, resultTextarea, historyEl, openNoteBtn);
    });
  }

  private doRoll(
    table: RandomTable,
    resultBox: HTMLElement,
    resultTextarea: HTMLTextAreaElement,
    historyEl: HTMLElement,
    openNoteBtn?: HTMLButtonElement,
  ): void {
    const entry = rollOnTable(table);
    if (!entry) return;

    this.detailEl
      ?.querySelectorAll(".duckmage-random-table tbody tr")
      .forEach((tr) => {
        tr.toggleClass(
          "is-rolled",
          tr.textContent?.includes(entry.result) ?? false,
        );
      });

    resultBox.style.display = "";
    resultTextarea.value = entry.result;
    resultTextarea.focus();

    // Update "Open note" button
    if (openNoteBtn) {
      if (table.linkedFolder) {
        openNoteBtn.style.display = "";
        openNoteBtn.onclick = () => {
          const noteFile = this.app.vault.getAbstractFileByPath(
            `${table.linkedFolder}/${entry.result}.md`,
          );
          if (noteFile instanceof TFile)
            this.app.workspace.getLeaf(false).openFile(noteFile);
        };
      } else {
        openNoteBtn.style.display = "none";
      }
    }

    this.rollHistory.unshift(entry.result);
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
      copyIcon.addEventListener("click", () =>
        navigator.clipboard.writeText(result),
      );
    }
  }
}


// ── ConfirmDeleteModal ────────────────────────────────────────────────────────

class ConfirmDeleteModal extends Modal {
  constructor(
    app: import("obsidian").App,
    private readonly tableName: string,
    private readonly onConfirm: () => Promise<void>,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("p", {
      text: `Delete "${this.tableName}"? This cannot be undone.`,
    });
    const btnRow = contentEl.createDiv({ cls: "duckmage-confirm-btn-row" });

    const deleteBtn = btnRow.createEl("button", {
      text: "Delete",
      cls: "mod-warning",
    });
    deleteBtn.addEventListener("click", async () => {
      this.close();
      await this.onConfirm();
    });

    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
