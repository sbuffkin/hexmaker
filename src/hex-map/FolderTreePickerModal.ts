import { App, Modal, TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";

interface FileNode {
  type: "file";
  file: TFile;
}
interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  children: TPickerNode[];
}
type TPickerNode = FileNode | FolderNode;

/**
 * Unified folder-tree file picker modal — used for both table and faction links.
 *
 * Pass `rootFolder` as the normalised vault path to browse (e.g. `settings.tablesFolder`).
 * Pass `onOpenView` to add an optional icon-button in the title bar (used for the 🎲 button
 * that opens the random-tables view when picking tables).
 */
export class FolderTreePickerModal extends Modal {
  private filterQuery = "";
  private collapsedFolders: Set<string> = new Set();
  private listEl: HTMLElement | null = null;

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private rootFolder: string,
    private modalTitle: string,
    private filterPlaceholder: string,
    private emptyMessage: string,
    private onChoose: (file: TFile) => void,
    private onOpenView?: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    if (this.onOpenView) {
      this.titleEl.setCssProps({
        display: "flex",
        "align-items": "center",
        "justify-content": "space-between",
      });
      this.titleEl.createSpan({ text: this.modalTitle });
      const openViewBtn = this.titleEl.createEl("button", {
        cls: "duckmage-rt-icon-btn",
        text: "🎲",
        title: "Open random tables view",
      });
      openViewBtn.addEventListener("click", () => this.onOpenView!());
    } else {
      this.titleEl.setText(this.modalTitle);
    }

    const { contentEl } = this;
    contentEl.addClass("duckmage-table-picker-modal");

    const search = contentEl.createEl("input", {
      type: "text",
      cls: "duckmage-rt-search",
    });
    search.placeholder = this.filterPlaceholder;
    search.addEventListener("input", () => {
      this.filterQuery = search.value.toLowerCase().trim();
      this.renderList();
    });

    this.listEl = contentEl.createDiv({
      cls: "duckmage-table-picker-list duckmage-rt-list",
    });
    this.renderList();
    search.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();

    const folder = normalizeFolder(this.rootFolder);
    const prefix = folder ? folder + "/" : "";

    let files = this.app.vault
      .getMarkdownFiles()
      .filter(
        (f) =>
          (!prefix || f.path.startsWith(prefix)) &&
          !f.basename.startsWith("_"),
      )
      .sort((a, b) => a.path.localeCompare(b.path));

    if (this.filterQuery) {
      files = files.filter((f) => {
        const rel = prefix ? f.path.slice(prefix.length) : f.path;
        return rel.toLowerCase().includes(this.filterQuery);
      });
    }

    if (files.length === 0) {
      this.listEl.createSpan({
        text: this.emptyMessage,
        cls: "duckmage-rt-empty",
      });
      return;
    }

    const tree = this.buildTree(files, prefix);
    this.renderNodes(this.listEl, tree, this.filterQuery !== "");
  }

  private buildTree(files: TFile[], prefix: string): TPickerNode[] {
    const root: FolderNode = {
      type: "folder",
      name: "",
      path: "",
      children: [],
    };
    for (const file of files) {
      const rel = prefix ? file.path.slice(prefix.length) : file.path;
      const parts = rel.split("/");
      let cur = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const name = parts[i];
        const path = parts.slice(0, i + 1).join("/");
        let child = cur.children.find(
          (c): c is FolderNode => c.type === "folder" && c.name === name,
        );
        if (!child) {
          child = { type: "folder", name, path, children: [] };
          cur.children.push(child);
        }
        cur = child;
      }
      cur.children.push({ type: "file", file });
    }
    return root.children;
  }

  private renderNodes(
    container: HTMLElement,
    nodes: TPickerNode[],
    forceExpanded: boolean,
  ): void {
    for (const node of nodes) {
      if (node.type === "folder") {
        const isCollapsed =
          !forceExpanded && this.collapsedFolders.has(node.path);
        const folderEl = container.createDiv({ cls: "duckmage-rt-folder" });
        const header = folderEl.createDiv({ cls: "duckmage-rt-folder-header" });
        const arrow = header.createSpan({
          cls: "duckmage-rt-folder-arrow",
          text: isCollapsed ? "▶" : "▼",
        });
        header.createSpan({ cls: "duckmage-rt-folder-name", text: node.name });
        const childrenEl = folderEl.createDiv({
          cls: "duckmage-rt-folder-children",
        });
        if (isCollapsed) childrenEl.hide();
        this.renderNodes(childrenEl, node.children, forceExpanded);
        header.addEventListener("click", () => {
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
        row.setText(node.file.basename);
        row.title = node.file.path;
        row.addEventListener("click", () => {
          this.onChoose(node.file);
          this.close();
        });
      }
    }
  }
}
