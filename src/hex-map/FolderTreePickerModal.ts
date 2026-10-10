import { App, Modal, Notice, TFile, TFolder } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder, makeTableTemplate } from "../utils";
import { buildTree, renderFolderTree, type TreeNode } from "../random-tables/FolderTree";

/**
 * Unified table/file picker modal.
 *
 * - `onChoose`       — called when the user selects an existing file.
 * - `onOpenView`     — if provided, renders a "🎲 Open tables view" button.
 * - `onTableCreated` — if provided, called after a new table is created (e.g. to open it in RT view).
 */
export class FolderTreePickerModal extends Modal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private rootFolder: string,
    private modalTitle: string,
    private filterPlaceholder: string,
    private emptyMessage: string,
    private onChoose: (file: TFile) => void,
    private onOpenView?: () => void,
    private onTableCreated?: (file: TFile) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.modalTitle);
    const { contentEl } = this;
    contentEl.addClass("duckmage-table-picker-modal");

    // ── Optional "open tables view" button ───────────────────────────────
    if (this.onOpenView) {
      const topBar = contentEl.createDiv({ cls: "duckmage-table-picker-topbar" });
      topBar.createEl("button", {
        cls: "duckmage-rt-icon-btn duckmage-table-picker-view-btn",
        text: "🎲 Open tables view",
        title: "Open random tables view",
      }).addEventListener("click", () => this.onOpenView!());
    }

    // ── Filter input ─────────────────────────────────────────────────────
    const filterInput = contentEl.createEl("input", {
      type: "text",
      cls: "duckmage-rt-search",
    });
    filterInput.placeholder = this.filterPlaceholder;

    // ── Scrollable folder tree ────────────────────────────────────────────
    const listEl = contentEl.createDiv({ cls: "duckmage-rt-list duckmage-picker-list" });

    const folder = normalizeFolder(this.rootFolder);
    const prefix = folder ? folder + "/" : "";

    const getFiles = (query: string): TFile[] => {
      let files = this.app.vault
        .getMarkdownFiles()
        .filter(
          (f) =>
            (!prefix || f.path.startsWith(prefix)) &&
            this.plugin.isLinkableNote(f),
        )
        .sort((a, b) => a.path.localeCompare(b.path));
      if (query) {
        const q = query.toLowerCase();
        files = files.filter((f) => {
          const rel = prefix ? f.path.slice(prefix.length) : f.path;
          return rel.toLowerCase().includes(q);
        });
      }
      return files;
    };

    const collapsedFolders = new Set<string>();
    let treeInitialized = false;

    const renderTree = (query: string) => {
      listEl.empty();
      const trimmed = query.trim();
      const forceExpanded = trimmed.length > 0;
      const files = getFiles(trimmed);

      if (files.length === 0) {
        listEl.createDiv({ cls: "duckmage-picker-list-empty", text: this.emptyMessage });
        return;
      }

      // Gather vault folder paths under the root for empty-folder support
      // (same approach as RandomTableView — walk TFolder children, not getAllFolders)
      const vaultFolderPaths: string[] = [];
      if (!forceExpanded) {
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

      const tree = buildTree(files, prefix, vaultFolderPaths);

      // Start all folders collapsed on first render
      if (!treeInitialized && !forceExpanded) {
        treeInitialized = true;
        const collect = (nodes: TreeNode[]) => {
          for (const n of nodes) {
            if (n.type === "folder") {
              collapsedFolders.add(n.path);
              collect(n.children);
            }
          }
        };
        collect(tree);
      }

      renderFolderTree(listEl, tree, {
        collapsedFolders,
        forceExpanded,
        onFileClick: (file) => {
          this.onChoose(file);
          this.close();
        },
      });
    };

    renderTree("");
    filterInput.addEventListener("input", () => renderTree(filterInput.value));

    // ── New table ────────────────────────────────────────────────────────
    contentEl.createEl("h4", { text: "New table", cls: "duckmage-table-picker-new-heading" });
    const newRow = contentEl.createDiv({ cls: "duckmage-region-row" });
    const nameInput = newRow.createEl("input", {
      type: "text",
      placeholder: "table-name",
    });
    const createBtn = newRow.createEl("button", { text: "+ create", cls: "mod-cta" });

    const doCreate = () =>
      void this.handleCreateTable(nameInput.value.trim(), createBtn, nameInput);
    createBtn.addEventListener("click", doCreate);
    nameInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") doCreate();
    });

    this.modalEl.tabIndex = -1;
    this.modalEl.focus();
  }

  private async handleCreateTable(
    name: string,
    btn: HTMLButtonElement,
    nameInput: HTMLInputElement,
  ): Promise<void> {
    if (!name) return;
    const folder = normalizeFolder(this.rootFolder);
    const newPath = folder ? `${folder}/${name}.md` : `${name}.md`;
    if (this.app.vault.getAbstractFileByPath(newPath) instanceof TFile) {
      new Notice(`"${name}" already exists.`);
      return;
    }
    btn.disabled = true;
    btn.setText("Creating…");
    try {
      if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
        await this.app.vault.createFolder(folder);
      }
      const rollerLink = this.plugin.buildRollerLink();
      const content = makeTableTemplate(
        this.plugin.settings.defaultTableDice,
        undefined,
        rollerLink,
      );
      const file = await this.app.vault.create(newPath, content);
      if (file instanceof TFile) {
        this.onTableCreated?.(file);
      }
      this.close();
    } catch (err) {
      new Notice(`Could not create table: ${String(err)}`);
      btn.disabled = false;
      btn.setText("+ create");
      nameInput.focus();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
