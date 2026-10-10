import { App, Notice, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";
import { parseRandomTable, rollTable, rollLabel, resolveTable, rowOdds, dieLabel, emptyTableMessage } from "./randomTable";
import { VIEW_TYPE_RANDOM_TABLES } from "../constants";
import { RandomTableEditorModal } from "./RandomTableEditorModal";

/**
 * "Add to this hex" target for a roll made from a hex (P2): which sections
 * the result may go to, the one picked first (where the roll came from), and
 * how to add it (the hex editor appends to its own text box; elsewhere
 * plugin.appendToHexSection creates the note if needed).
 */
export interface RollHexTarget {
  /** "Hex 3, 4", shown on the button's tooltip. */
  label: string;
  sections: readonly { key: string; label: string }[];
  defaultSection: string;
  add: (sectionKey: string, text: string) => Promise<void> | void;
}

/**
 * Section picker + "Add to this hex" button (P2), for a roll result or a
 * filled-in workflow (PA2). `getText` is read on click.
 */
export function renderAddToHex(
  parent: HTMLElement,
  target: RollHexTarget,
  getText: () => string,
  opts: { cta?: boolean; onAdded?: () => void } = {},
): void {
  const select = parent.createEl("select", {
    cls: "duckmage-roll-add-section",
    attr: { "aria-label": "Section to add the result to" },
  });
  for (const s of target.sections) select.createEl("option", { value: s.key, text: s.label });
  select.value = target.sections.some((s) => s.key === target.defaultSection)
    ? target.defaultSection
    : (target.sections[0]?.key ?? "");
  const addBtn = parent.createEl("button", {
    text: "Add to this hex",
    cls: opts.cta ? "mod-cta" : "",
    attr: { title: `Append the result to a section of ${target.label}'s note` },
  });
  addBtn.addEventListener("click", () => {
    const text = getText().trim();
    if (!text || !select.value) return;
    addBtn.disabled = true;
    void (async () => {
      try {
        await target.add(select.value, text);
        const label = target.sections.find((s) => s.key === select.value)?.label ?? select.value;
        new Notice(`Added to ${label} (${target.label}).`);
        opts.onAdded?.();
      } catch (err) {
        new Notice(`Could not add the result: ${String(err)}`);
        addBtn.disabled = false;
      }
    })();
  });
}

/**
 * Lightweight inline roll modal — used by the 🎲 button inside HexEditorModal
 * so the user can roll on a table without leaving the hex editor context.
 *
 * When `initialFilePath` is supplied the dropdown is skipped and that table is
 * loaded immediately (used for terrain description tables via the 📖 button).
 * The result always has Copy; "Use result" when `onInsert` is given, and
 * "Add to this hex" with a section picker when `hexTarget` is given.
 */
export class RandomTableModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private onInsert?: (result: string) => void,
    private initialFilePath?: string,
    private hexTarget?: RollHexTarget,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("Roll on table");
    const { contentEl } = this;
    contentEl.addClass("duckmage-roll-modal");
    this.makeDraggable();

    if (this.initialFilePath) {
      void this.loadTable(contentEl, this.initialFilePath);
      return;
    }

    // ── Table selector ────────────────────────────────────────────────
    const folder = normalizeFolder(this.plugin.settings.tablesFolder);
    let files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !folder || f.path.startsWith(folder + "/"))
      .filter((f) => !f.basename.startsWith("_"));
    files = this.plugin.filterTableFiles(
      files,
      "roll-filter",
      this.plugin.settings.rollTableExcludedFolders,
    );
    files = files.sort((a, b) => a.basename.localeCompare(b.basename));

    if (files.length === 0) {
      contentEl.createDiv({
        cls: "duckmage-rt-empty",
        text: `No tables found in "${this.plugin.settings.tablesFolder}".`,
      });
      return;
    }

    const select = contentEl.createEl("select", {
      cls: "duckmage-roll-modal-select",
    });
    select.createEl("option", { value: "", text: "— choose a table —" });
    for (const file of files) {
      select.createEl("option", { value: file.path, text: file.basename });
    }

    // "Open in roller" link — hidden until a table is selected
    const openLink = contentEl.createEl("a", {
      text: "Open in roller view",
      cls: "duckmage-roll-modal-open-link",
    });
    openLink.hide();

    const tableContainer = contentEl.createDiv({
      cls: "duckmage-roll-modal-table-wrap",
    });
    const resultBox = this.buildResultBox(contentEl);
    const rollBtn = contentEl.createEl("button", {
      text: "Roll",
      cls: "duckmage-rt-roll-btn mod-cta",
    });
    rollBtn.disabled = true;

    select.addEventListener("change", () => {
      void (async () => {
        tableContainer.empty();
        resultBox.el.hide();
        rollBtn.disabled = true;
        const path = select.value;
        if (!path) {
          openLink.hide();
          return;
        }
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;

        openLink.show();
        openLink.onclick = () => {
          this.openInRoller(file.path);
        };

        await this.renderOddsTable(tableContainer, resultBox, rollBtn, file);
      })();
    });

    contentEl.appendChild(rollBtn);
  }

  private async loadTable(
    contentEl: HTMLElement,
    filePath: string,
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      contentEl.createDiv({
        cls: "duckmage-rt-empty",
        text: "Table file not found.",
      });
      return;
    }

    // Header row: name + edit link + open-in-roller link
    const headerRow = contentEl.createDiv({
      cls: "duckmage-roll-modal-header-row",
    });
    headerRow.createEl("strong", { text: file.basename });
    const editLink = headerRow.createEl("a", {
      text: "Edit",
      cls: "duckmage-roll-modal-edit-link",
    });
    editLink.addEventListener("click", () => {
      void (async () => {
        const content = await this.app.vault.read(file);
        new RandomTableEditorModal(
          this.app,
          this.plugin,
          file,
          () => {
            void (async () => {
              // Reload the table in place after saving
              tableContainer.empty();
              resultBox.el.hide();
              rollBtn.disabled = true;
              await this.renderOddsTable(tableContainer, resultBox, rollBtn, file);
            })();
          },
          content,
        ).open();
      })();
    });
    const openLink = headerRow.createEl("a", {
      text: "Open in roller view",
      cls: "duckmage-roll-modal-open-link",
    });
    openLink.addEventListener("click", () => {
      this.openInRoller(file.path);
    });

    const tableContainer = contentEl.createDiv({
      cls: "duckmage-roll-modal-table-wrap",
    });
    const resultBox = this.buildResultBox(contentEl);
    const rollBtn = contentEl.createEl("button", {
      text: "Roll",
      cls: "duckmage-rt-roll-btn mod-cta",
    });
    rollBtn.disabled = true;

    await this.renderOddsTable(tableContainer, resultBox, rollBtn, file);
    contentEl.appendChild(rollBtn);
  }

  private openInRoller(filePath: string): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RANDOM_TABLES);
    if (leaves.length > 0) {
      void this.app.workspace.revealLeaf(leaves[0]);
      (
        leaves[0].view as unknown as { openTable?: (path: string) => void }
      ).openTable?.(filePath);
    } else {
      void this.app.workspace.getLeaf("tab").setViewState({
        type: VIEW_TYPE_RANDOM_TABLES,
        state: { filePath },
      });
    }
    this.close();
  }

  private buildResultBox(contentEl: HTMLElement): {
    el: HTMLElement;
    textarea: HTMLTextAreaElement;
    face: HTMLElement;
  } {
    const resultBox = contentEl.createDiv({ cls: "duckmage-roll-result" });
    resultBox.hide();
    const face = resultBox.createDiv({ cls: "duckmage-roll-face" });
    const resultTextarea = resultBox.createEl("textarea", {
      cls: "duckmage-roll-result-textarea",
    });
    const resultBtns = resultBox.createDiv({
      cls: "duckmage-roll-result-btns",
    });

    if (this.onInsert) {
      const useBtn = resultBtns.createEl("button", {
        text: "Use result",
        cls: "mod-cta",
      });
      useBtn.addEventListener("click", () => {
        this.onInsert!(resultTextarea.value);
        this.close();
      });
    }

    const target = this.hexTarget;
    if (target) {
      renderAddToHex(resultBtns, target, () => resultTextarea.value, {
        cta: !this.onInsert,
        onAdded: () => this.close(),
      });
    }

    const copyBtn = resultBtns.createEl("button", {
      text: "Copy",
      cls: this.onInsert || target ? "" : "mod-cta",
    });
    copyBtn.addEventListener("click", () => {
      void navigator.clipboard.writeText(resultTextarea.value);
      copyBtn.setText("Copied");
      window.setTimeout(() => copyBtn.setText("Copy"), 1200);
    });

    return { el: resultBox, textarea: resultTextarea, face };
  }

  private async renderOddsTable(
    tableContainer: HTMLElement,
    resultBox: { el: HTMLElement; textarea: HTMLTextAreaElement; face: HTMLElement },
    rollBtn: HTMLButtonElement,
    file: TFile,
  ): Promise<void> {
    const content = await this.app.vault.read(file);
    const table = parseRandomTable(content);
    const resolved = resolveTable(table);
    // Ranges as stored in the note (blanks filled): the ones that are rolled.
    const ranges = table.dice > 0 ? resolved.labels : null;
    const odds = rowOdds(table, resolved);

    if (table.entries.length === 0) {
      const empty = tableContainer.createDiv({ cls: "duckmage-rt-empty-state" });
      empty.createDiv({ text: emptyTableMessage(content), cls: "duckmage-rt-empty" });
      const addBtn = empty.createEl("button", { text: "Add entries", cls: "mod-cta" });
      addBtn.addEventListener("click", () => {
        new RandomTableEditorModal(
          this.app,
          this.plugin,
          file,
          () => {
            void (async () => {
              tableContainer.empty();
              resultBox.el.hide();
              rollBtn.disabled = true;
              await this.renderOddsTable(tableContainer, resultBox, rollBtn, file);
            })();
          },
          content,
        ).open();
      });
      rollBtn.title = "Add entries to roll on this table";
      return;
    }
    rollBtn.removeAttribute("title");

    const tableEl = tableContainer.createEl("table", {
      cls: "duckmage-random-table",
    });
    const thead = tableEl.createEl("thead");
    const headerRow = thead.createEl("tr");
    if (ranges) headerRow.createEl("th", { text: dieLabel(table.dice) });
    headerRow.createEl("th", { text: "Result" });
    headerRow.createEl("th", { text: "Odds" });
    headerRow.createEl("th", { cls: "duckmage-rt-copy-col-header" });

    const tbody = tableEl.createEl("tbody");
    table.entries.forEach((entry, i) => {
      const tr = tbody.createEl("tr");
      tr.dataset.index = String(i);
      if (ranges)
        tr.createEl("td", { text: ranges[i], cls: "duckmage-rt-range-cell" });
      tr.createEl("td", { text: entry.result });
      tr.createEl("td", { text: odds[i], cls: "duckmage-rt-odds-cell" });
      const copyTd = tr.createEl("td", { cls: "duckmage-rt-entry-copy-cell" });
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

    rollBtn.disabled = false;
    rollBtn.onclick = () => {
      const outcome = rollTable(table);
      if (!outcome) return;
      tbody.querySelectorAll("tr").forEach((tr) => {
        tr.toggleClass("is-rolled", tr.dataset.index === String(outcome.index));
      });
      resultBox.el.show();
      const face = rollLabel(table, outcome);
      resultBox.face.setText(face);
      resultBox.face.toggle(!!face);
      resultBox.textarea.value = outcome.entry.result;
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
