import { App, Notice, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import {
  parseRandomTableWithReport,
  parseMarkdownListItems,
  writeRollTable,
  rangeCellTexts,
  resolveTable,
  dieLabel,
  type RandomTableEntry,
  type TableWrite,
} from "./randomTable";
import { FileLinkSuggestModal } from "../hex-map/FileLinkSuggestModal";
import { processTableNote } from "./TableStore";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";
import { escapeRegex } from "../textUtils";

/** How the editor writes the die column: ranges are redone when weights or rows change. */
export function editorRangeMode(rowsOrWeightsChanged: boolean): TableWrite["ranges"] {
  return rowsOrWeightsChanged ? "regenerate" : "keep";
}

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
    const report = parseRandomTableWithReport(rawContent);
    const table = report.table;
    const frontmatter = this.extractFrontmatter(rawContent);

    // Working copy so edits don't mutate until Save
    const entries: RandomTableEntry[] = table.entries.map((e) => ({ ...e }));
    // Which parsed row each entry came from (survives drag-reorder), so the
    // writer keeps that row's raw text: extra columns, aliases, spacing.
    const entrySource = new WeakMap<RandomTableEntry, number>();
    entries.forEach((e, i) => entrySource.set(e, i));

    // Linked-folder rows whose note is missing are kept and reported, not
    // deleted: the note may have been renamed or moved elsewhere.
    const missingAtOpen = new Set<string>();
    if (table.linkedFolder) {
      const lf = normalizeFolder(table.linkedFolder);
      for (const e of entries) {
        if (!this.app.vault.getAbstractFileByPath(`${lf}/${e.result}.md`)) missingAtOpen.add(e.result);
      }
    }
    if (missingAtOpen.size) {
      const warn = contentEl.createDiv({ cls: "duckmage-table-editor-warning" });
      const names = [...missingAtOpen];
      warn.setText(
        `${names.length === 1 ? "This row has" : "These rows have"} no note in ${table.linkedFolder}: ${names.slice(0, 8).join(", ")}${names.length > 8 ? ", …" : ""}. ` +
          `${names.length === 1 ? "It's" : "They're"} kept; delete ${names.length === 1 ? "it" : "them"} here if the note is gone for good.`,
      );
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

    // ── Sort buttons ──────────────────────────────────────────────────
    let weightSortAsc = false;
    let alphaSortAsc = false;
    const stripLeadingSpecial = (s: string) =>
      s.replace(/^[^a-zA-Z0-9]+/, "").toLowerCase();

    const weightSortBtn = entriesHeadingRow.createEl("button", {
      text: "Wt ↑",
      cls: "duckmage-table-editor-add-one-btn",
      attr: { title: "Sort entries by weight (low → high)" },
    });
    weightSortBtn.addEventListener("click", () => {
      weightSortAsc = !weightSortAsc;
      entries.sort((a, b) =>
        weightSortAsc ? a.weight - b.weight : b.weight - a.weight,
      );
      weightSortBtn.setText(weightSortAsc ? "Wt ↓" : "Wt ↑");
      weightSortBtn.title = weightSortAsc
        ? "Sort entries by weight (high → low)"
        : "Sort entries by weight (low → high)";
      renderRows();
    });

    const alphaSortBtn = entriesHeadingRow.createEl("button", {
      text: "A→z",
      cls: "duckmage-table-editor-add-one-btn",
      attr: { title: "Sort entries alphabetically (a → z)" },
    });
    alphaSortBtn.addEventListener("click", () => {
      alphaSortAsc = !alphaSortAsc;
      entries.sort((a, b) => {
        const ka = stripLeadingSpecial(a.result);
        const kb = stripLeadingSpecial(b.result);
        return alphaSortAsc ? ka.localeCompare(kb) : kb.localeCompare(ka);
      });
      alphaSortBtn.setText(alphaSortAsc ? "Z→a" : "A→z");
      alphaSortBtn.title = alphaSortAsc
        ? "Sort entries alphabetically (z → a)"
        : "Sort entries alphabetically (a → z)";
      renderRows();
    });

    const subOneToAllBtn = entriesHeadingRow.createEl("button", {
      text: "-1",
      cls: "duckmage-table-editor-add-one-btn",
      attr: { title: "Subtract 1 from every entry's weight (stops at 0)" },
    });
    subOneToAllBtn.addEventListener("click", () => {
      for (const e of entries) e.weight = Math.max(0, e.weight - 1);
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

    const importBtn = entriesHeadingRow.createEl("button", {
      text: "Import…",
      cls: "duckmage-table-editor-add-one-btn",
      attr: { title: "Import list items from a vault note" },
    });
    importBtn.addEventListener("click", () => {
      new FileLinkSuggestModal(
        this.app,
        this.plugin,
        (file: TFile) => {
          void (async () => {
            const content = await this.app.vault.read(file);
            const items = parseMarkdownListItems(content);
            if (items.length === 0) {
              new Notice(`No list items found in "${file.basename}"`);
              return;
            }
            for (const item of items) {
              entries.push({ result: item, weight: 1 });
            }
            renderRows();
            new Notice(`Imported ${items.length} item${items.length === 1 ? "" : "s"} from "${file.basename}"`);
          })();
        },
        "",
      ).open();
    });

    const rowsEl = entriesSection.createDiv({
      cls: "duckmage-table-editor-rows",
    });

    let dragSrcIndex = -1;

    const autoResize = (el: HTMLTextAreaElement) => {
      el.setCssProps({ height: "auto" });
      el.setCssProps({ height: `${el.scrollHeight}px` });
    };

    // Rows added, removed, reordered or reweighted: the ranges are redone.
    const rowsOrWeightsChanged = (): boolean =>
      entries.length !== table.entries.length ||
      entries.some((e, i) => entrySource.get(e) !== i || e.weight !== table.entries[i].weight);
    // Each row's roll range, as it will be written.
    let rangeEls: HTMLElement[] = [];
    const onWeightsChanged = (): void => {
      if (table.dice <= 0) return;
      const labels = rowsOrWeightsChanged()
        ? rangeCellTexts(table.dice, entries, "regenerate")
        : resolveTable({ dice: table.dice, entries }).labels;
      rangeEls.forEach((el, i) => el.setText(labels[i] || "—"));
    };

    const renderRows = () => {
      rowsEl.empty();
      rangeEls = [];
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
        if (table.dice > 0) {
          const rangeEl = row.createSpan({ cls: "duckmage-table-editor-range" });
          rangeEl.title = `Roll range on the ${dieLabel(table.dice)} (from the weights)`;
          rangeEls.push(rangeEl);
        }

        const resultInput = row.createEl("textarea", {
          cls: "duckmage-table-editor-result",
        });
        // Show [[path]] for link entries so the user can see and edit the link format
        resultInput.value = entry.isLink ? `[[${entry.result}]]` : entry.result;
        resultInput.placeholder = "Result…";
        resultInput.rows = 1;
        // Size to content immediately, then keep in sync as the user types
        window.requestAnimationFrame(() => autoResize(resultInput));
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
        weightInput.min = "0";
        weightInput.title = "Weight (0 = never rolled)";
        weightInput.addEventListener("input", () => {
          entries[i].weight = readWeight(weightInput.value);
          onWeightsChanged();
        });

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
      onWeightsChanged();
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
    newWeight.min = "0";

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
    const seenFolders = new Set<string>();
    // Add configured settings folders first (excluding hexFolder)
    const s = this.plugin.settings;
    for (const raw of [
      s.townsFolder,
      s.dungeonsFolder,
      s.questsFolder,
      s.featuresFolder,
      s.factionsFolder,
      s.tablesFolder,
      s.workflowsFolder,
    ]) {
      const p = normalizeFolder(raw);
      if (p && !seenFolders.has(p)) {
        seenFolders.add(p);
        folderDatalist.createEl("option", { value: p });
      }
    }
    // Add all vault subfolders under worldFolder or any settings folder
    const folderRoots = [
      s.worldFolder,
      s.townsFolder,
      s.dungeonsFolder,
      s.questsFolder,
      s.featuresFolder,
      s.factionsFolder,
      s.tablesFolder,
      s.workflowsFolder,
    ]
      .map(normalizeFolder)
      .filter(Boolean);
    for (const f of this.app.vault.getAllFolders()) {
      const p = normalizeFolder(f.path);
      if (!p) continue;
      const underRoot = folderRoots.some(
        (r) => p === r || p.startsWith(r + "/"),
      );
      if (!underRoot) continue;
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
    // Terrain description/encounter tables manage these flags programmatically — hide UI.
    const isSystemTable = /^table-type:/m.test(frontmatter);
    const filterSection = contentEl.createDiv({
      cls: "duckmage-table-editor-filter-section",
    });
    if (isSystemTable) filterSection.hide();

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
        const weight = readWeight(newWeight.value);
        entries.push({ result: resolvedPath, weight, isLink: true });
      } else {
        errorEl.hide();
        const weight = readWeight(newWeight.value);
        entries.push({ result: raw, weight });
      }

      newResult.value = "";
      newWeight.value = "1";
      renderRows();
      newResult.focus();
    };
    // Expose so onClose saves all changes (flushes pending "add row" text
    // first). Nothing is written unless something actually changed.
    this.flushAndSave = async () => {
      doAdd(); // flush pending "add row" text if any (no-op if empty)
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
      if (linkedFolder !== normalizeFolder(table.linkedFolder ?? "")) {
        updatedFm = this.setFrontmatterString(
          updatedFm,
          "linkedFolder",
          linkedFolder ? `"[[${linkedFolder}]]"` : undefined,
        );
      }
      if (linkedFolder) {
        await this.renameUpdatedEntries(
          entries,
          entryOriginalResult,
          linkedFolder,
        );
        await this.retireDeletedEntries(originalResults, entries, linkedFolder);
        await this.syncLinkedFolder(entries, linkedFolder, missingAtOpen);
      }

      // ── Table: only its own lines are rewritten, and only if it changed.
      const orig = table.entries;
      const reweighted = rowsOrWeightsChanged();
      const textChanged = entries.some((e) => {
        const src = entrySource.get(e);
        return src === undefined || orig[src].result !== e.result || !!orig[src].isLink !== !!e.isLink;
      });
      let next = rawContent;
      if (reweighted || textChanged) {
        next = writeRollTable(rawContent, {
          dice: table.dice,
          rows: entries.map((entry) => ({ entry, source: entrySource.get(entry) })),
          ranges: editorRangeMode(reweighted),
          linkCells: !!linkedFolder,
          dropPlaceholders: true,
        });
      }

      // ── Description: only the text between frontmatter and table, only if edited.
      const newDescription = descInput.value.trim();
      if (newDescription !== (table.description ?? "")) {
        const eol = rawContent.includes("\r\n") ? "\r\n" : "\n";
        const fmEnd = frontmatter ? frontmatter.length : 0;
        const tableStart = report.block ? report.block.start : fmEnd;
        const preamble = rawContent.slice(fmEnd, tableStart);
        // Keep the roller block; an old roller link becomes the block.
        const roller =
          /```duckmage-roller[\s\S]*?```/.exec(preamble)?.[0] ?? "```duckmage-roller" + eol + "```";
        const parts = [roller, newDescription.replace(/\r?\n/g, eol)].filter(Boolean);
        const newPreamble = (frontmatter ? eol + eol : "") + parts.join(eol + eol) + (report.block ? eol + eol : eol);
        // The table write above leaves everything before the table as it was.
        next = next.slice(0, fmEnd) + newPreamble + next.slice(tableStart);
      }

      if (updatedFm !== frontmatter) next = updatedFm + next.slice(frontmatter.length);
      if (next === rawContent) return;
      try {
        await processTableNote(this.app, this.file, () => next);
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
    missingAtOpen: Set<string>,
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
      // A row whose note was missing when the editor opened is reported, not recreated.
      if (missingAtOpen.has(entry.result)) continue;
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
      new RegExp(`^${escapeRegex(key)}:\\s*(true|false)\\s*$`, "m"),
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
    const lineRegex = new RegExp(`^${escapeRegex(key)}:[^\\r\\n]*`, "m");
    const hasKey = lineRegex.test(frontmatter);
    if (value === undefined) {
      if (!hasKey) return frontmatter;
      // Remove the line (and any trailing newline)
      return frontmatter.replace(new RegExp(`^${escapeRegex(key)}:.*(?:\\r?\\n)?`, "m"), "");
    }
    const line = `${key}: ${value}`;
    if (hasKey) {
      return frontmatter.replace(lineRegex, () => line);
    }
    // Insert before closing ---
    return frontmatter.replace(/(\r?\n)---$/, (_m, eol: string) => `${eol}${line}${eol}---`);
  }

  /** Set, remove, or update a string key in a frontmatter block string. */
  private setFrontmatterString(
    frontmatter: string,
    key: string,
    value: string | undefined,
  ): string {
    const lineRegex = new RegExp(`^${escapeRegex(key)}:[^\\r\\n]*`, "m");
    const hasKey = lineRegex.test(frontmatter);
    if (!value) {
      if (!hasKey) return frontmatter;
      return frontmatter.replace(new RegExp(`^${escapeRegex(key)}:.*(?:\\r?\\n)?`, "m"), "");
    }
    const line = `${key}: ${value}`;
    if (hasKey) return frontmatter.replace(lineRegex, () => line);
    return frontmatter.replace(/(\r?\n)---$/, (_m, eol: string) => `${eol}${line}${eol}---`);
  }

  private extractFrontmatter(content: string): string {
    const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?=\r?\n|$)/.exec(content);
    return match ? match[0] : "";
  }
}

/** A typed weight: a whole number ≥ 0; anything else counts as 1. */
function readWeight(value: string): number {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}
