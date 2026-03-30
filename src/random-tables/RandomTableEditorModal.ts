import { App, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import { parseRandomTable, extractPostTableContent } from "./randomTable";
import type { RandomTableEntry } from "./randomTable";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";

/**
 * Modal editor for a random table file.
 * Shows existing entries as editable rows and allows adding new ones.
 * Saves back to the file, preserving frontmatter.
 */
export class RandomTableEditorModal extends HexmakerModal {
  // Held so onClose can flush a pending "add row" entry and save it
  private flushAndSave: (() => Promise<void>) | null = null;

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private file: TFile,
    private onSaved?: () => void,
    private initialContent?: string,
  ) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.titleEl.setText(`Edit: ${this.file.basename}`);
    const { contentEl } = this;
    contentEl.addClass("duckmage-table-editor");

    const rawContent =
      this.initialContent ?? (await this.app.vault.read(this.file));
    const table = parseRandomTable(rawContent);
    const frontmatter = this.extractFrontmatter(rawContent);
    const preamble = this.extractPreamble(rawContent, frontmatter);

    // Working copy so edits don't mutate until Save
    const entries: RandomTableEntry[] = table.entries.map((e) => ({ ...e }));

    // If linked to a folder, silently drop entries whose note no longer exists
    if (table.linkedFolder) {
      const lf = normalizeFolder(table.linkedFolder);
      for (let i = entries.length - 1; i >= 0; i--) {
        if (
          !this.app.vault.getAbstractFileByPath(`${lf}/${entries[i].result}.md`)
        ) {
          entries.splice(i, 1);
        }
      }
    }

    // Track each entry's original result by object identity (survives drag-reorder)
    const entryOriginalResult = new WeakMap<RandomTableEntry, string>();
    entries.forEach((e) => entryOriginalResult.set(e, e.result));

    // Snapshot of original results so deleted entries can be retired on save
    const originalResults = new Set(entries.map((e) => e.result));

    // ── Name (rename) ────────────────────────────────────────────────
    const nameRow = contentEl.createDiv({
      cls: "duckmage-table-editor-name-row",
    });
    nameRow.createEl("label", {
      text: "Name",
      cls: "duckmage-table-editor-name-label",
    });
    const nameInput = nameRow.createEl("input", {
      type: "text",
      cls: "duckmage-table-editor-name-input",
    });
    nameInput.value = this.file.basename;

    const doRename = async () => {
      const newName = nameInput.value.trim();
      if (!newName || newName === this.file.basename) return;
      const dir = this.file.path.slice(
        0,
        this.file.path.length - this.file.name.length,
      );
      const newPath = dir + newName + ".md";
      try {
        await this.app.fileManager.renameFile(this.file, newPath);
        this.titleEl.setText(`Edit: ${this.file.basename}`);
        this.onSaved?.();
      } catch {
        nameInput.value = this.file.basename; // revert on error
      }
    };

    nameInput.addEventListener("blur", () => void doRename());
    nameInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        nameInput.blur();
      }
      if (e.key === "Escape") {
        nameInput.value = this.file.basename;
        nameInput.blur();
      }
    });

    // ── Entries section (grows to fill available space) ───────────────
    const entriesSection = contentEl.createDiv({
      cls: "duckmage-table-editor-entries-section",
    });

    // ── Existing rows ─────────────────────────────────────────────────
    const entriesHeadingRow = entriesSection.createDiv({
      cls: "duckmage-table-editor-entries-heading-row",
    });
    entriesHeadingRow.createEl("p", {
      text: "Entries",
      cls: "duckmage-table-editor-heading",
    });
    const subOneToAllBtn = entriesHeadingRow.createEl("button", {
      text: "-1",
      cls: "duckmage-table-editor-add-one-btn",
      attr: { title: "Add 1 to every entry's weight" },
    });
    subOneToAllBtn.addEventListener("click", () => {
      for (const e of entries) e.weight -= 1;
      renderRows();
    });
    const addOneToAllBtn = entriesHeadingRow.createEl("button", {
      text: "+1",
      cls: "duckmage-table-editor-add-one-btn",
      attr: { title: "Add 1 to every entry's weight" },
    });
    addOneToAllBtn.addEventListener("click", () => {
      for (const e of entries) e.weight += 1;
      renderRows();
    });

    const rowsEl = entriesSection.createDiv({
      cls: "duckmage-table-editor-rows",
    });

    let dragSrcIndex = -1;

    const autoResize = (el: HTMLTextAreaElement) => {
      el.setCssProps({ height: "auto" });
      el.setCssProps({ height: `${el.scrollHeight}px` });
    };

    const renderRows = () => {
      rowsEl.empty();
      if (entries.length === 0) {
        rowsEl.createSpan({
          text: "No entries yet.",
          cls: "duckmage-rt-empty",
        });
        return;
      }
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const row = rowsEl.createDiv({ cls: "duckmage-table-editor-row" });
        row.draggable = true;

        const handle = row.createSpan({
          cls: "duckmage-table-editor-drag-handle",
          text: "⠿",
        });
        handle.title = "Drag to reorder";

        const resultInput = row.createEl("textarea", {
          cls: "duckmage-table-editor-result",
        });
        // Show [[path]] for link entries so the user can see and edit the link format
        resultInput.value = entry.isLink ? `[[${entry.result}]]` : entry.result;
        resultInput.placeholder = "Result…";
        resultInput.rows = 1;
        // Size to content immediately, then keep in sync as the user types
        requestAnimationFrame(() => autoResize(resultInput));
        resultInput.addEventListener("input", () => {
          const val = resultInput.value;
          const m = /^\[\[(.+?)(?:\|[^\]]+)?\]\]$/.exec(val.trim());
          if (m) {
            entries[i].result = m[1];
            entries[i].isLink = true;
          } else {
            entries[i].result = val;
            entries[i].isLink = undefined;
          }
          autoResize(resultInput);
        });

        const weightInput = row.createEl("input", {
          type: "number",
          cls: "duckmage-table-editor-weight",
        });
        weightInput.value = String(entry.weight);
        //weightInput.min = "1";
        weightInput.addEventListener("input", () => {
          entries[i].weight = Math.max(1, parseInt(weightInput.value, 10) || 1);
        });
        // weightInput.addEventListener("keydown", (e: KeyboardEvent) => {
        //   if (e.key === "ArrowDown" && entries[i].weight <= 1) {
        //     e.preventDefault();
        //     for (let j = 0; j < entries.length; j++) {
        //       if (j !== i) entries[j].weight += 1;
        //     }
        //     renderRows();
        //   }
        // });

        const delBtn = row.createEl("button", {
          text: "×",
          cls: "duckmage-table-editor-del",
        });
        delBtn.title = "Remove row";
        delBtn.addEventListener("click", () => {
          entries.splice(i, 1);
          renderRows();
        });

        row.addEventListener("dragstart", (e: DragEvent) => {
          dragSrcIndex = i;
          row.addClass("duckmage-table-editor-dragging");
          e.dataTransfer?.setDragImage(row, 0, 0);
        });
        row.addEventListener("dragend", () => {
          row.removeClass("duckmage-table-editor-dragging");
          rowsEl
            .querySelectorAll(".duckmage-table-editor-drop-target")
            .forEach((el) =>
              el.classList.remove("duckmage-table-editor-drop-target"),
            );
        });
        row.addEventListener("dragover", (e: DragEvent) => {
          e.preventDefault();
          rowsEl
            .querySelectorAll(".duckmage-table-editor-drop-target")
            .forEach((el) =>
              el.classList.remove("duckmage-table-editor-drop-target"),
            );
          row.addClass("duckmage-table-editor-drop-target");
        });
        row.addEventListener("dragleave", () => {
          row.removeClass("duckmage-table-editor-drop-target");
        });
        row.addEventListener("drop", (e: DragEvent) => {
          e.preventDefault();
          if (dragSrcIndex === -1 || dragSrcIndex === i) return;
          const [moved] = entries.splice(dragSrcIndex, 1);
          entries.splice(i, 0, moved);
          dragSrcIndex = -1;
          renderRows();
        });
      }
    };
    renderRows();

    // ── Add new row ───────────────────────────────────────────────────
    entriesSection.createEl("p", {
      text: "Add row",
      cls: "duckmage-table-editor-heading",
    });
    const addRow = entriesSection.createDiv({
      cls: "duckmage-table-editor-add-row",
    });

    const newResult = addRow.createEl("textarea", {
      cls: "duckmage-table-editor-result",
    });
    newResult.placeholder = "New result…";
    newResult.rows = 1;

    const newWeight = addRow.createEl("input", {
      type: "number",
      cls: "duckmage-table-editor-weight",
    });
    newWeight.value = "1";
    newWeight.min = "1";

    const addBtn = addRow.createEl("button", {
      text: "Add",
      cls: "duckmage-table-editor-add-btn mod-cta",
    });

    const errorEl = entriesSection.createDiv({
      cls: "duckmage-table-editor-add-error",
    });
    errorEl.hide();

    // ── Description ───────────────────────────────────────────────────
    const descRow = contentEl.createDiv({
      cls: "duckmage-table-editor-desc-row",
    });
    descRow.createEl("label", {
      text: "Description",
      cls: "duckmage-table-editor-desc-label",
    });
    const descInput = descRow.createEl("textarea", {
      cls: "duckmage-table-editor-desc-input",
    });
    descInput.placeholder = "Optional description shown above the table…";
    descInput.value = table.description ?? "";
    descInput.rows = 3;

    // ── Linked folder ─────────────────────────────────────────────────
    const folderRow = contentEl.createDiv({
      cls: "duckmage-table-editor-folder-row",
    });
    folderRow.createEl("label", {
      text: "Linked folder",
      cls: "duckmage-table-editor-folder-label",
    });
    const folderDatalistId =
      "duckmage-lf-folders-" + Math.random().toString(36).slice(2);
    const folderDatalist = contentEl.createEl("datalist");
    folderDatalist.id = folderDatalistId;
    const worldFolder = normalizeFolder(this.plugin.settings.worldFolder);
    const seenFolders = new Set<string>();
    for (const f of this.app.vault.getAllFolders()) {
      const p = normalizeFolder(f.path);
      if (!p || p === worldFolder) continue;
      if (worldFolder && !p.startsWith(worldFolder + "/")) continue;
      if (!seenFolders.has(p)) {
        seenFolders.add(p);
        folderDatalist.createEl("option", { value: p });
      }
    }
    const folderInput = folderRow.createEl("input", {
      type: "text",
      cls: "duckmage-table-editor-folder-input",
    });
    folderInput.setAttribute("list", folderDatalistId);
    folderInput.value = table.linkedFolder ?? "";
    folderInput.placeholder = "World/towns (leave blank for none)";

    // ── Filter settings ───────────────────────────────────────────────
    const filterSection = contentEl.createDiv({
      cls: "duckmage-table-editor-filter-section",
    });
    const rollFilterRow = filterSection.createDiv({
      cls: "duckmage-table-editor-filter-row",
    });
    const rollFilterCb = rollFilterRow.createEl("input", { type: "checkbox" });
    rollFilterCb.checked =
      this.parseFrontmatterBool(frontmatter, "roll-filter") === false;
    rollFilterRow.createEl("label", { text: "Exclude from roll picker" });

    const encFilterRow = filterSection.createDiv({
      cls: "duckmage-table-editor-filter-row",
    });
    const encFilterCb = encFilterRow.createEl("input", { type: "checkbox" });
    encFilterCb.checked =
      this.parseFrontmatterBool(frontmatter, "encounter-filter") === false;
    encFilterRow.createEl("label", { text: "Exclude from encounters table" });

    const doAdd = () => {
      const raw = newResult.value.trim();
      if (!raw) return;

      // Detect vault-relative link format: explicit [[...]] or a path containing / or \
      const explicitLink = /^\[\[(.+?)(?:\|[^\]]+)?\]\]$/.exec(raw);
      const linkPath = explicitLink ? explicitLink[1] : raw;
      const looksLikeLink =
        explicitLink !== null ||
        linkPath.includes("/") ||
        linkPath.includes("\\");

      if (looksLikeLink) {
        // Normalize backslashes and strip .md extension if present
        const normalizedPath = linkPath
          .replace(/\\/g, "/")
          .replace(/\.md$/i, "");
        // Try exact vault-relative path, then case-insensitive scan, then Obsidian's link resolver
        const found =
          this.app.vault.getAbstractFileByPath(normalizedPath + ".md") ??
          this.app.vault
            .getMarkdownFiles()
            .find(
              (f) =>
                f.path.slice(0, -3).trim().toLowerCase() ===
                normalizedPath.toLowerCase(),
            ) ??
          this.app.metadataCache.getFirstLinkpathDest(
            normalizedPath,
            this.file.path,
          );
        if (!(found instanceof TFile)) {
          errorEl.setText(`No note found: "${normalizedPath}"`);
          errorEl.show();
          return;
        }
        errorEl.hide();
        // Store the vault-relative path without extension (canonical link form)
        const resolvedPath = found.path.replace(/\.md$/i, "");
        const weight = Math.max(1, parseInt(newWeight.value, 10) || 1);
        entries.push({ result: resolvedPath, weight, isLink: true });
      } else {
        errorEl.hide();
        const weight = Math.max(1, parseInt(newWeight.value, 10) || 1);
        entries.push({ result: raw, weight });
      }

      newResult.value = "";
      newWeight.value = "1";
      renderRows();
      newResult.focus();
    };
    // Expose so onClose always saves all changes (flushes pending "add row" text first)
    this.flushAndSave = async () => {
      doAdd(); // flush pending "add row" text if any (no-op if empty)
      const suffix = extractPostTableContent(rawContent) || undefined;
      let updatedFm = this.setFrontmatterBool(
        frontmatter,
        "roll-filter",
        rollFilterCb.checked ? false : undefined,
      );
      updatedFm = this.setFrontmatterBool(
        updatedFm,
        "encounter-filter",
        encFilterCb.checked ? false : undefined,
      );
      const linkedFolder = normalizeFolder(folderInput.value.trim());
      updatedFm = this.setFrontmatterString(
        updatedFm,
        "linked-folder",
        linkedFolder || undefined,
      );
      if (linkedFolder) {
        await this.renameUpdatedEntries(
          entries,
          entryOriginalResult,
          linkedFolder,
        );
        await this.retireDeletedEntries(originalResults, entries, linkedFolder);
        await this.syncLinkedFolder(entries, linkedFolder);
      }
      // Rebuild preamble: preserve roller link, replace user description
      const rollerLinkMatch = preamble.match(
        /\[.*?\]\(obsidian:\/\/duckmage-roll[^)]*\)/,
      );
      const rollerLink = rollerLinkMatch ? rollerLinkMatch[0] : "";
      const newDescription = descInput.value.trim();
      const newPreamble = [rollerLink, newDescription]
        .filter(Boolean)
        .join("\n\n");
      const newContent = this.buildContent(
        updatedFm,
        newPreamble,
        entries,
        linkedFolder || undefined,
        suffix,
      );
      try {
        await this.app.vault.process(this.file, () => newContent);
        this.onSaved?.();
      } catch {
        /* best-effort */
      }
    };

    addBtn.addEventListener("click", doAdd);
    // Enter submits; Shift+Enter inserts a newline
    newResult.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doAdd();
      }
    });

    // ── Footer: Close (auto-saves on close) ───────────────────────────
    const footer = contentEl.createDiv({ cls: "duckmage-table-editor-footer" });

    footer
      .createEl("button", { text: "Close", cls: "mod-cta" })
      .addEventListener("click", () => this.close());

    this.makeDraggable();
  }

  /** Sync entries ↔ notes in linkedFolder. Mutates entries in-place. */
  private async syncLinkedFolder(
    entries: RandomTableEntry[],
    folderPath: string,
  ): Promise<void> {
    // Ensure folder exists
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      try {
        await this.app.vault.createFolder(folderPath);
      } catch {
        /* may already exist */
      }
    }

    // Notes currently in the folder
    const existing = this.app.vault
      .getMarkdownFiles()
      .filter(
        (f) => f.parent?.path === folderPath && !f.basename.startsWith("_"),
      );

    // For each entry: create note if missing
    for (const entry of entries) {
      const notePath = `${folderPath}/${entry.result}.md`;
      const noteFile = this.app.vault.getAbstractFileByPath(notePath);
      if (!noteFile) {
        try {
          await this.app.vault.create(notePath, `# ${entry.result}\n`);
        } catch {
          continue;
        }
      }
    }

    // For each note without a matching entry: add entry
    const entryNames = new Set(entries.map((e) => e.result));
    for (const noteFile of existing) {
      if (!entryNames.has(noteFile.basename)) {
        entries.push({ result: noteFile.basename, weight: 1 });
      }
    }
  }

  /** Rename notes whose entry result text was changed, instead of creating a new note. */
  private async renameUpdatedEntries(
    entries: RandomTableEntry[],
    originalResults: WeakMap<RandomTableEntry, string>,
    folderPath: string,
  ): Promise<void> {
    for (const entry of entries) {
      const orig = originalResults.get(entry);
      if (!orig || orig === entry.result) continue;
      const oldPath = `${folderPath}/${orig}.md`;
      const newPath = `${folderPath}/${entry.result}.md`;
      const noteFile = this.app.vault.getAbstractFileByPath(oldPath);
      if (!(noteFile instanceof TFile)) continue;
      if (this.app.vault.getAbstractFileByPath(newPath)) continue; // target already exists
      try {
        await this.app.fileManager.renameFile(noteFile, newPath);
      } catch {
        /* best-effort */
      }
    }
  }

  /** Prepend "_" to notes whose entries were deleted, so they are excluded from future syncs. */
  private async retireDeletedEntries(
    originalResults: Set<string>,
    currentEntries: RandomTableEntry[],
    folderPath: string,
  ): Promise<void> {
    const currentNames = new Set(currentEntries.map((e) => e.result));
    for (const result of originalResults) {
      if (currentNames.has(result)) continue;
      const notePath = `${folderPath}/${result}.md`;
      const noteFile = this.app.vault.getAbstractFileByPath(notePath);
      if (!(noteFile instanceof TFile)) continue;
      const newPath = `${folderPath}/_${result}.md`;
      try {
        await this.app.fileManager.renameFile(noteFile, newPath);
      } catch {
        /* already renamed or missing */
      }
    }
  }

  onClose(): void {
    // If the user typed something in "Add row" and closed without clicking Add,
    // flush it and save so the entry isn't lost.
    void this.flushAndSave?.();
    this.flushAndSave = null;
    this.contentEl.empty();
  }

  /** Read a `key: true|false` line from a frontmatter block string. Returns undefined if absent. */
  private parseFrontmatterBool(
    frontmatter: string,
    key: string,
  ): boolean | undefined {
    const m = frontmatter.match(
      new RegExp(`^${key}:\\s*(true|false)\\s*$`, "m"),
    );
    if (!m) return undefined;
    return m[1] === "true";
  }

  /**
   * Set, remove, or update a boolean key in a frontmatter block string.
   * If value is undefined the key line is removed.
   * If the key doesn't exist and value is not undefined, it is inserted before the closing `---`.
   */
  private setFrontmatterBool(
    frontmatter: string,
    key: string,
    value: boolean | undefined,
  ): string {
    const lineRegex = new RegExp(`^${key}:.*$`, "m");
    const hasKey = lineRegex.test(frontmatter);
    if (value === undefined) {
      if (!hasKey) return frontmatter;
      // Remove the line (and any trailing newline)
      return frontmatter.replace(new RegExp(`^${key}:.*\\n?`, "m"), "");
    }
    const line = `${key}: ${value}`;
    if (hasKey) {
      return frontmatter.replace(lineRegex, line);
    }
    // Insert before closing ---
    return frontmatter.replace(/\n---$/, `\n${line}\n---`);
  }

  /** Set, remove, or update a string key in a frontmatter block string. */
  private setFrontmatterString(
    frontmatter: string,
    key: string,
    value: string | undefined,
  ): string {
    const lineRegex = new RegExp(`^${key}:.*$`, "m");
    const hasKey = lineRegex.test(frontmatter);
    if (!value) {
      if (!hasKey) return frontmatter;
      return frontmatter.replace(new RegExp(`^${key}:.*\\n?`, "m"), "");
    }
    const line = `${key}: ${value}`;
    if (hasKey) return frontmatter.replace(lineRegex, line);
    return frontmatter.replace(/\n---$/, `\n${line}\n---`);
  }

  private extractFrontmatter(content: string): string {
    const match = content.match(/^---\n[\s\S]*?\n---/);
    return match ? match[0] : "";
  }

  private extractPreamble(content: string, frontmatter: string): string {
    const afterFm = frontmatter ? content.slice(frontmatter.length) : content;
    // Find first markdown table row (line starting with |)
    const tableMatch = afterFm.match(/^[ \t]*\|/m);
    if (!tableMatch || tableMatch.index === undefined) return "";
    return afterFm.slice(0, tableMatch.index).trim();
  }

  private buildContent(
    frontmatter: string,
    preamble: string,
    entries: RandomTableEntry[],
    linkedFolder?: string,
    suffix?: string,
  ): string {
    const rows = entries
      .map((e) => {
        const cell = linkedFolder || e.isLink ? `[[${e.result}]]` : e.result;
        return `| ${cell} | ${e.weight} |`;
      })
      .join("\n");
    const tableBlock = `| Result | Weight |\n|--------|--------|\n${rows}`;
    const parts: string[] = [];
    if (frontmatter) parts.push(frontmatter);
    if (preamble) parts.push(preamble);
    parts.push(tableBlock);
    let result = parts.join("\n\n") + "\n";
    if (suffix) result += "\n" + suffix;
    return result;
  }
}
