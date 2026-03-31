import { App, TFile } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import { normalizeFolder } from "../utils";
import { parseRandomTable, rollOnTable, getDieRanges } from "./randomTable";
import { VIEW_TYPE_RANDOM_TABLES } from "../constants";
import { RandomTableEditorModal } from "./RandomTableEditorModal";

/**
 * Lightweight inline roll modal — used by the 🎲 button inside HexEditorModal
 * so the user can roll on a table without leaving the hex editor context.
 *
 * When `initialFilePath` is supplied the dropdown is skipped and that table is
 * loaded immediately (used for terrain description tables via the 📖 button).
 * When `onInsert` is absent the result shows a Copy button instead of "Use result".
 */
export class RandomTableModal extends HexmakerModal {
  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private onInsert?: (result: string) => void,
    private initialFilePath?: string,
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
  } {
    const resultBox = contentEl.createDiv({ cls: "duckmage-roll-result" });
    resultBox.hide();
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
    } else {
      const copyBtn = resultBtns.createEl("button", {
        text: "Copy",
        cls: "mod-cta",
      });
      copyBtn.addEventListener("click", () => {
        void navigator.clipboard.writeText(resultTextarea.value);
      });
    }

    return { el: resultBox, textarea: resultTextarea };
  }

  private async renderOddsTable(
    tableContainer: HTMLElement,
    resultBox: { el: HTMLElement; textarea: HTMLTextAreaElement },
    rollBtn: HTMLButtonElement,
    file: TFile,
  ): Promise<void> {
    const content = await this.app.vault.read(file);
    const table = parseRandomTable(content);
    const ranges = table.dice > 0 ? getDieRanges(table) : null;

    if (table.entries.length === 0) {
      tableContainer.createSpan({
        text: "No entries found.",
        cls: "duckmage-rt-empty",
      });
      return;
    }

    const tableEl = tableContainer.createEl("table", {
      cls: "duckmage-random-table",
    });
    const thead = tableEl.createEl("thead");
    const headerRow = thead.createEl("tr");
    if (ranges) headerRow.createEl("th", { text: `d${table.dice}` });
    headerRow.createEl("th", { text: "Result" });
    headerRow.createEl("th", { text: "Odds" });
    headerRow.createEl("th", { cls: "duckmage-rt-copy-col-header" });

    const tbody = tableEl.createEl("tbody");
    const total = table.entries.reduce((s, e) => s + e.weight, 0);
    table.entries.forEach((entry, i) => {
      const tr = tbody.createEl("tr");
      tr.dataset.index = String(i);
      if (ranges)
        tr.createEl("td", { text: ranges[i], cls: "duckmage-rt-range-cell" });
      tr.createEl("td", { text: entry.result });
      const pct = `${Math.round((entry.weight / total) * 100)}%`;
      tr.createEl("td", { text: pct, cls: "duckmage-rt-odds-cell" });
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
        setTimeout(() => copyBtn.setText("⎘"), 1200);
      });
    });

    rollBtn.disabled = false;
    rollBtn.onclick = () => {
      const rolled = rollOnTable(table);
      if (!rolled) return;
      tbody.querySelectorAll("tr").forEach((tr) => {
        tr.toggleClass(
          "is-rolled",
          tr.textContent?.includes(rolled.result) || false,
        );
      });
      resultBox.el.show();
      resultBox.textarea.value = rolled.result;
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
