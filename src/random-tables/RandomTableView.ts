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
import type HexmakerPlugin from "../HexmakerPlugin";
import { VIEW_TYPE_RANDOM_TABLES } from "../constants";
import { normalizeFolder, makeTableTemplate } from "../utils";
import { RandomTableEditorModal } from "./RandomTableEditorModal";
import { WorkflowEditorModal } from "./WorkflowEditorModal";
import { WorkflowWizardModal } from "./WorkflowWizardModal";
import {
  parseRandomTable,
  rollOnTable,
  getDieRanges,
  setDiceInFrontmatter,
  extractPostTableContent,
  type RandomTable,
} from "./randomTable";
import { parseWorkflow, generateDefaultTemplate } from "./workflow";
import { Frontmatter } from "../frontmatter";

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
  private workflowMap: Map<string, string[]> = new Map(); // table path (no .md) → workflow file paths
  private listRefreshTimer: number | null = null;
  private detailRefreshTimer: number | null = null;
  private viewMode: "tables" | "workflows" = "tables";
  private tablesBtn: HTMLButtonElement | null = null;
  private workflowsBtn: HTMLButtonElement | null = null;
  private tableFooterEl: HTMLElement | null = null;
  private workflowFooterEl: HTMLElement | null = null;

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
      ? `Random tables · ${this.activeFile.basename}`
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
          this.tablesBtn?.removeClass("is-active");
          this.workflowsBtn?.addClass("is-active");
          await this.loadList();
          await this.loadWorkflow(file);
        } else {
          await this.loadList();
          void this.loadTable(file);
        }
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
    refreshBtn.addEventListener("click", () => void this.loadList());

    // ── Mode toggle tabs ─────────────────────────────────────────────────
    const modeTabs = leftCol.createDiv({ cls: "duckmage-rt-mode-tabs" });
    this.tablesBtn = modeTabs.createEl("button", {
      text: "Tables",
      cls: "duckmage-rt-mode-tab is-active",
    });
    this.workflowsBtn = modeTabs.createEl("button", {
      text: "Workflows",
      cls: "duckmage-rt-mode-tab",
    });
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
      this.app.workspace.revealLeaf(leaf);
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
      this.app.workspace.revealLeaf(leaf);
    });

    const searchInput = leftCol.createEl("input", {
      type: "text",
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
    this.listEl.addEventListener("drop", async (e: DragEvent) => {
      e.preventDefault();
      listDragCounter = 0;
      this.listEl!.removeClass("is-drag-over-root");
      const srcPath = e.dataTransfer?.getData("text/plain") ?? "";
      await this.moveFileTo(
        srcPath,
        normalizeFolder(this.plugin.settings.tablesFolder),
      );
    });

    const listFooter = leftCol.createDiv({ cls: "duckmage-rt-list-footer" });

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
    const fromFolderInput = this.tableFooterEl.createEl("input", {
      type: "text",
      cls: "duckmage-rt-from-folder-input",
      attr: { placeholder: "Generate from folder link (optional)…" },
    });
    fromFolderInput.setCssProps({ "margin-top": "6px" });

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
          srcFolder = normalizeFolder(fromFolderInput.value.trim());
          let content: string;
          if (srcFolder) {
            const folderFiles = this.app.vault
              .getMarkdownFiles()
              .filter(
                (f) =>
                  f.parent?.path === srcFolder && !f.basename.startsWith("_"),
              )
              .sort((a, b) => a.basename.localeCompare(b.basename));
            const rollerLink = this.plugin.buildRollerLink(newPath);
            const entryRows = folderFiles
              .map((f) => `| [[${f.basename}]] | 1 |`)
              .join("\n");
            content = `---\ndice: ${this.plugin.settings.defaultTableDice}\nlinkedFolder: ${srcFolder}\n---\n\n${rollerLink}\n\n| Result | Weight |\n|--------|--------|\n${entryRows || "|  | 1 |"}\n`;
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
          new Notice(`Could not create ${newPath}: ${String(err)}`);
          return;
        }
      }
      newInput.value = "";
      newInput.removeClass("duckmage-input-error");
      newInput.title = "";
      fromFolderInput.value = "";
      await this.loadList();
      if (file instanceof TFile) await this.loadTable(file);
      // Re-render after vault I/O settles to ensure linkedFolder link styling is applied
      if (srcFolder) await this.renderDetail();
    };

    newBtn.addEventListener("click", createTable);
    newInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") void createTable();
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
        if (
          file instanceof TFile &&
          !file.basename.startsWith("_") &&
          this.isInTablesFolder(file.path)
        )
          this.scheduleListRefresh();
        if (
          file instanceof TFile &&
          !file.basename.startsWith("_") &&
          this.isInWorkflowsFolder(file.path)
        )
          this.scheduleListRefresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && this.isInWorkflowsFolder(file.path)) {
          if (this.activeFile === file) {
            this.activeFile = null;
            this.detailEl?.empty();
          }
          this.scheduleListRefresh();
        }
        if (!(file instanceof TFile) || !this.isInTablesFolder(file.path))
          return;
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
        const wasInWf = this.isInWorkflowsFolder(oldPath);
        const isInWf = this.isInWorkflowsFolder(file.path);
        if (!wasIn && !isIn && !wasInWf && !isInWf) return;
        if (this.activeFile?.path === oldPath) this.activeFile = file;
        this.scheduleListRefresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file === this.activeFile)
          this.scheduleDetailRefresh();
      }),
    );

    // ── Auto-sync: note renamed/deleted in a linked folder → rebuild table entries ──
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        const oldDir = normalizeFolder(
          oldPath.slice(0, oldPath.lastIndexOf("/")),
        );
        const newDir = normalizeFolder(file.parent?.path ?? "");
        for (const dir of new Set([oldDir, newDir])) {
          const tableFilePath = this.linkedFolderMap.get(dir);
          if (!tableFilePath) continue;
          const tableFile = this.app.vault.getAbstractFileByPath(tableFilePath);
          if (tableFile instanceof TFile)
            await this.autoSyncLinkedFolder(tableFile);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", async (file) => {
        if (!(file instanceof TFile)) return;
        const dir = normalizeFolder(
          file.path.slice(0, file.path.lastIndexOf("/")),
        );
        const tableFilePath = this.linkedFolderMap.get(dir);
        if (!tableFilePath) return;
        const tableFile = this.app.vault.getAbstractFileByPath(tableFilePath);
        if (tableFile instanceof TFile)
          await this.autoSyncLinkedFolder(tableFile);
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
        const tableFile = this.app.vault.getAbstractFileByPath(tableFilePath);
        if (!(tableFile instanceof TFile)) return;
        await this.app.vault.process(tableFile, (content) => {
          const table = parseRandomTable(content);
          if (table.entries.some((e) => e.result === createdFile.basename))
            return content;
          const suffix = extractPostTableContent(content);
          const newRow = `| ${createdFile.basename} | 1 |`;
          const replaced = content.replace(
            /(\| Result \| Weight \|\n\|[-| ]+\|\n)([\s\S]*)$/,
            (_, hdr, body) => {
              const tableLines = body
                .split("\n")
                .filter((l: string) => l.trimStart().startsWith("|"))
                .join("\n");
              return `${hdr}${tableLines.trimEnd() ? tableLines.trimEnd() + "\n" : ""}${newRow}\n`;
            },
          );
          return suffix ? replaced.trimEnd() + "\n\n" + suffix : replaced;
        });
        await this.loadList();
        if (this.activeFile?.path === tableFilePath) await this.renderDetail();
      }),
    );
  }

  onClose(): Promise<void> {
    this.contentEl.empty();
    return Promise.resolve();
  }

  // ── Public: open a specific table (called from hex editor / protocol handler) ──
  async openTable(filePath: string): Promise<void> {
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
      await this.loadList();
      void this.loadTable(file);
    }
  }

  // ── Public: open a specific workflow (called from protocol handler) ──
  async openWorkflow(filePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      if (this.viewMode !== "workflows") {
        this.setViewMode("workflows");
        await this.loadList();
      }
      await this.loadWorkflow(file);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private isInTablesFolder(filePath: string): boolean {
    const folder = normalizeFolder(this.plugin.settings.tablesFolder);
    return !folder || filePath.startsWith(folder + "/");
  }

  private isInWorkflowsFolder(filePath: string): boolean {
    const folder = normalizeFolder(this.plugin.settings.workflowsFolder);
    return !!folder && filePath.startsWith(folder + "/");
  }

  private setViewMode(mode: "tables" | "workflows"): void {
    this.viewMode = mode;
    this.tablesBtn?.toggleClass("is-active", mode === "tables");
    this.workflowsBtn?.toggleClass("is-active", mode === "workflows");
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
      if (this.viewMode === "workflows") {
        void this.renderWorkflowDetail();
      } else {
        void this.renderDetail();
      }
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
      const lf = (
        this.app.metadataCache.getFileCache(file)?.frontmatter as
          | Frontmatter
          | undefined
      )?.["linkedFolder"];
      if (lf) this.linkedFolderMap.set(normalizeFolder(lf), file.path);
    }

    // Rebuild workflow map (table path → [workflow paths])
    this.rebuildWorkflowMap(allFiles);

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

  private rebuildWorkflowMap(allFiles?: TFile[]): void {
    this.workflowMap.clear();
    const wfFolder = normalizeFolder(this.plugin.settings.workflowsFolder);
    if (!wfFolder) return;
    const wfFiles = (allFiles ?? this.app.vault.getMarkdownFiles()).filter(
      (f) => f.path.startsWith(wfFolder + "/") && !f.basename.startsWith("_"),
    );
    for (const wf of wfFiles) {
      const links = this.app.metadataCache.getFileCache(wf)?.links ?? [];
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
    const tree = this.buildTree(files, prefix);
    this.renderWorkflowTreeNodes(this.listEl, tree);
  }

  private renderWorkflowTreeNodes(
    container: HTMLElement,
    nodes: TreeNode[],
  ): void {
    for (const node of nodes) {
      if (node.type === "folder") {
        const isCollapsed = this.collapsedFolders.has("wf:" + node.path);
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

        const childrenEl = folderEl.createDiv({
          cls: "duckmage-rt-folder-children",
        });
        if (isCollapsed) childrenEl.hide();
        this.renderWorkflowTreeNodes(childrenEl, node.children);

        folderHeader.addEventListener("click", () => {
          const key = "wf:" + node.path;
          const nowCollapsed = !this.collapsedFolders.has(key);
          if (nowCollapsed) {
            this.collapsedFolders.add(key);
            childrenEl.hide();
            arrow.textContent = "▶";
          } else {
            this.collapsedFolders.delete(key);
            childrenEl.show();
            arrow.textContent = "▼";
          }
        });
      } else {
        const row = container.createDiv({ cls: "duckmage-rt-workflow-item" });
        if (node.file === this.activeFile) row.addClass("is-active");
        row.setText(node.file.basename);
        row.title = node.file.path;
        row.addEventListener("click", () => void this.loadWorkflow(node.file));
        row.addEventListener("auxclick", (e: MouseEvent) => {
          if (e.button !== 1) return;
          e.preventDefault();
          const leaf = this.app.workspace.getLeaf("tab");
          void leaf.setViewState({
            type: VIEW_TYPE_RANDOM_TABLES,
            active: true,
            state: { filePath: node.file.path },
          });
          this.app.workspace.revealLeaf(leaf);
        });
        row.addEventListener("contextmenu", (e: MouseEvent) => {
          e.preventDefault();
          const menu = new Menu();
          menu.addItem((item) => {
            item.setTitle("Open in new tab");
            item.setIcon("external-link");
            item.onClick(() => {
              const leaf = this.app.workspace.getLeaf("tab");
              void leaf.setViewState({
                type: VIEW_TYPE_RANDOM_TABLES,
                active: true,
                state: { filePath: node.file.path },
              });
              this.app.workspace.revealLeaf(leaf);
            });
          });
          menu.addSeparator();
          menu.addItem((item) => {
            item.setTitle("Delete workflow");
            item.setIcon("trash");
            item.onClick(() => {
              new ConfirmDeleteModal(this.app, node.file.basename, async () => {
                await this.app.fileManager.trashFile(node.file);
                if (this.activeFile === node.file) {
                  this.activeFile = null;
                  this.detailEl?.empty();
                }
                await this.loadList();
              }).open();
            });
          });
          menu.showAtMouseEvent(e);
        });
      }
    }
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
      await this.loadList();
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
      text: file.basename,
      cls: "duckmage-rt-detail-title",
    });

    const editLink = header.createEl("a", {
      text: "Edit",
      cls: "duckmage-rt-edit-link",
    });
    editLink.addEventListener("click", async () => {
      const content = await this.app.vault.read(file);
      const wf = parseWorkflow(content, file.basename);
      let tmplContent = "";
      if (wf.templateFile) {
        const tmplFile = this.app.vault.getAbstractFileByPath(wf.templateFile);
        if (tmplFile instanceof TFile) {
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
    });

    const runBtn = this.detailEl.createEl("button", {
      text: "Roll workflow",
      cls: "duckmage-rt-roll-btn mod-cta",
    });
    runBtn.addEventListener("click", () => {
      new WorkflowWizardModal(this.app, this.plugin, file).open();
    });
    runBtn.setCssProps({ "margin-right": "8px" });

    const copyWfLinkBtn = this.detailEl.createEl("button", {
      text: "🔗 copy link",
      cls: "duckmage-rt-copy-link-btn",
    });
    copyWfLinkBtn.title = "Copy a Markdown link to open this workflow";
    copyWfLinkBtn.setCssProps({ "margin-bottom": "12px" });
    copyWfLinkBtn.addEventListener("click", () => {
      const vault = encodeURIComponent(this.app.vault.getName());
      const path = encodeURIComponent(file.path);
      const link = `[🔗 ${file.basename}](obsidian://duckmage-workflow?vault=${vault}&file=${path})`;
      void navigator.clipboard.writeText(link).then(() => {
        copyWfLinkBtn.setText("Copied!");
        setTimeout(() => copyWfLinkBtn.setText("🔗 copy link"), 1500);
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
      const list = stepsEl.createEl("ul");
      list.setCssProps({ margin: "0", "padding-left": "18px" });
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
          link.addEventListener("click", async () => {
            const tableFile =
              this.app.vault.getAbstractFileByPath(step.tablePath + ".md") ??
              this.app.metadataCache.getFirstLinkpathDest(
                step.tablePath,
                this.activeFile?.path ?? "",
              );
            if (tableFile instanceof TFile)
              await this.openTable(tableFile.path);
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
      const tmplFile = this.app.vault.getAbstractFileByPath(
        workflow.templateFile,
      );
      if (tmplFile instanceof TFile) {
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
        if (isCollapsed) childrenEl.hide();

        this.renderTreeNodes(childrenEl, node.children, forceExpanded);

        // Folder drop target — accept dragged table files
        let dragCounter = 0;
        folderEl.addEventListener("dragenter", (e: DragEvent) => {
          if (!e.dataTransfer?.types.includes("text/plain")) return;
          dragCounter++;
          folderHeader.addClass("is-drag-over");
        });
        folderEl.addEventListener("dragleave", () => {
          if (--dragCounter <= 0) {
            dragCounter = 0;
            folderHeader.removeClass("is-drag-over");
          }
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
          const destFolder = tblFolder
            ? `${tblFolder}/${node.path}`
            : node.path;
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
            childrenEl.hide();
            arrow.textContent = "▶";
          } else {
            this.collapsedFolders.delete(node.path);
            childrenEl.show();
            arrow.textContent = "▼";
          }
        });
      } else {
        const row = container.createDiv({ cls: "duckmage-rt-list-item" });
        if (node.file === this.activeFile) row.addClass("is-active");
        row.setText(node.file.basename);
        row.title = node.file.path;
        row.addEventListener("click", () => void this.loadTable(node.file));
        row.addEventListener("auxclick", (e: MouseEvent) => {
          if (e.button !== 1) return;
          e.preventDefault();
          const leaf = this.app.workspace.getLeaf("tab");
          void leaf.setViewState({
            type: VIEW_TYPE_RANDOM_TABLES,
            active: true,
            state: { filePath: node.file.path },
          });
          this.app.workspace.revealLeaf(leaf);
        });
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
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
      | Frontmatter
      | undefined;
    const rollExcluded = fm?.["roll-filter"] === false;
    const encExcluded = fm?.["encounter-filter"] === false;
    const isDefaultTable = fm?.["table-type"] != null;
    const menu = new Menu();

    menu.addItem((item) => {
      item.setTitle("Open in new tab");
      item.setIcon("external-link");
      item.onClick(() => {
        const leaf = this.app.workspace.getLeaf("tab");
        void leaf.setViewState({
          type: VIEW_TYPE_RANDOM_TABLES,
          active: true,
          state: { filePath: file.path },
        });
        this.app.workspace.revealLeaf(leaf);
      });
    });
    menu.addSeparator();

    menu.addItem((item) => {
      item.setTitle(
        rollExcluded ? "Include in roll picker" : "Exclude from roll picker",
      );
      item.setIcon("dice");
      item.onClick(async () => {
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
        await this.loadList();
      });
    });

    menu.addItem((item) => {
      item.setTitle(
        encExcluded
          ? "Include in encounters table"
          : "Exclude from encounters table",
      );
      item.setIcon("sword");
      item.onClick(async () => {
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
      await this.loadList();
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
   * If tableFile has a linkedFolder, rebuild its entries from the folder:
   * keep existing entries (preserving weights), add new notes, remove stale ones.
   * No-op when there's no linked folder or nothing has changed.
   */
  private async autoSyncLinkedFolder(tableFile: TFile): Promise<void> {
    await this.app.vault.process(tableFile, (content) => {
      const table = parseRandomTable(content);
      if (!table.linkedFolder) return content;

      const lf = normalizeFolder(table.linkedFolder);
      const folderFiles = this.app.vault
        .getMarkdownFiles()
        .filter((f) => f.parent?.path === lf && !f.basename.startsWith("_"))
        .sort((a, b) => a.basename.localeCompare(b.basename));

      const folderBasenames = new Set(folderFiles.map((f) => f.basename));
      const currentNames = new Set(table.entries.map((e) => e.result));

      const hasNew = folderFiles.some((f) => !currentNames.has(f.basename));
      const hasStale = table.entries.some(
        (e) => !folderBasenames.has(e.result),
      );
      if (!hasNew && !hasStale) return content;

      const kept = table.entries.filter((e) => folderBasenames.has(e.result));
      const added = folderFiles
        .filter((f) => !currentNames.has(f.basename))
        .map((f) => ({ result: f.basename, weight: 1 }));
      const newEntries = [...kept, ...added];

      const suffix = extractPostTableContent(content);
      const rows = newEntries
        .map((e) => `| ${e.result} | ${e.weight} |`)
        .join("\n");
      const replaced = content.replace(
        /(\| Result \| Weight \|\n\|[-| ]+\|\n)([\s\S]*)$/,
        `$1${rows}\n`,
      );
      const updated = suffix ? replaced.trimEnd() + "\n\n" + suffix : replaced;
      return updated !== content ? updated : content;
    });
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
    editLink.addEventListener("click", async () => {
      const content = await this.app.vault.read(file);
      new RandomTableEditorModal(
        this.app,
        this.plugin,
        file,
        () => void this.renderDetail(),
        content,
      ).open();
    });

    const openNoteLink = header.createEl("a", {
      text: "Open note",
      cls: "duckmage-rt-edit-link",
    });
    openNoteLink.addEventListener("click", () => {
      void this.app.workspace.getLeaf().openFile(file);
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
      await this.app.vault.process(file, (content) =>
        setDiceInFrontmatter(content, newDice),
      );
      await this.renderDetail();
    });

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
          void navigator.clipboard.writeText(entry.result);
          copyBtn.setText("✓");
          setTimeout(() => copyBtn.setText("⎘"), 1200);
        });
      });
    }

    // ── Roll controls ──────────────────────────────────────────────────
    const rollArea = this.detailEl.createDiv({ cls: "duckmage-rt-roll-area" });

    const copyLinkBtn = rollArea.createEl("button", {
      text: "🎲 copy link",
      cls: "duckmage-rt-copy-link-btn",
    });
    copyLinkBtn.title = "Copy a Markdown link to this table";
    copyLinkBtn.addEventListener("click", () => {
      const vault = encodeURIComponent(this.app.vault.getName());
      const path = encodeURIComponent(file.path);
      const link = `[🎲 ${file.basename}](obsidian://duckmage-roll?vault=${vault}&file=${path})`;
      void navigator.clipboard.writeText(link).then(() => {
        copyLinkBtn.setText("Copied!");
        setTimeout(() => copyLinkBtn.setText("🎲 copy link"), 1500);
      });
    });

    const rollBtn = rollArea.createEl("button", {
      text: "Roll",
      cls: "duckmage-rt-roll-btn mod-cta",
    });

    const resultBox = this.detailEl.createDiv({ cls: "duckmage-roll-result" });
    resultBox.hide();
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
      setTimeout(() => copyBtn.setText("Copy"), 1500);
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
      this.doRoll(table, resultBox, resultTextarea, historyEl, openNoteBtn);
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
          setTimeout(() => {
            if (wfFile instanceof TFile) void this.loadWorkflow(wfFile);
          }, 50);
        });
      }

      const newWfLink = linksEl.createEl("a", {
        text: "+ new workflow with this table",
        cls: "duckmage-rt-entry-link",
      });
      newWfLink.setCssProps({ "font-style": "italic" });
      newWfLink.addEventListener("click", async () => {
        this.setViewMode("workflows");
        await this.createWorkflow(tableKey);
      });
    }
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

    // Display label: basename for link entries, full result for plain entries
    const displayLabel = entry.isLink
      ? (entry.result.split("/").pop() ?? entry.result)
      : entry.result;

    this.detailEl
      ?.querySelectorAll(".duckmage-random-table tbody tr")
      .forEach((tr) => {
        tr.toggleClass(
          "is-rolled",
          tr.textContent?.includes(displayLabel) ?? false,
        );
      });

    resultBox.show();
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
