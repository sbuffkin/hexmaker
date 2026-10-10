import { TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { emptyTableMessage, parseRandomTable, rollOnTable } from "./randomTable";
import { DIE_OPTIONS } from "./RandomTableView";

/**
 * Registers the `duckmage-roller` fenced code block processor.
 *
 * Block format:
 *   ```duckmage-roller
 *   path/to/table.md   ← optional; omit to roll the current note itself
 *   ```
 *
 * Renders a compact interactive roller widget in reading / preview mode.
 */
export function registerRollerBlock(plugin: HexmakerPlugin): void {
  plugin.registerMarkdownCodeBlockProcessor(
    "duckmage-roller",
    async (source, el, ctx) => {
      const targetPath = source.trim() || ctx.sourcePath;
      const file = plugin.app.vault.getAbstractFileByPath(targetPath);

      if (!(file instanceof TFile)) {
        el.createDiv({
          cls: "duckmage-rt-empty",
          text: `Table not found: "${targetPath}"`,
        });
        return;
      }

      // Read initial table to seed the die selector
      const initialContent = await plugin.app.vault.read(file);
      const initialTable = parseRandomTable(initialContent);

      // Local die state — cosmetic, not saved to file
      let currentDice = initialTable.dice;

      // ── Widget container ─────────────────────────────────────────────
      const block = el.createDiv({ cls: "duckmage-roller-block" });

      // Header: title + die selector
      const header = block.createDiv({ cls: "duckmage-roller-header" });
      header.createSpan({
        cls: "duckmage-roller-title",
        text: `🎲 ${file.basename}`,
      });
      const dieSelect = header.createEl("select", {
        cls: "duckmage-roller-die",
      });
      for (const opt of DIE_OPTIONS) {
        const o = dieSelect.createEl("option", {
          value: String(opt.value),
          text: opt.label,
        });
        if (opt.value === currentDice) o.selected = true;
      }
      dieSelect.addEventListener("change", () => {
        currentDice = parseInt(dieSelect.value, 10);
      });

      // Roll button
      const rollBtn = block.createEl("button", {
        text: "Roll",
        cls: "duckmage-roller-btn mod-cta",
      });

      // Shown instead of a result when the table has nothing to roll yet
      // (e.g. a terrain table setup created empty), with a way to fill it.
      const emptyEl = block.createDiv({ cls: "duckmage-rt-empty-state" });
      emptyEl.hide();
      const emptyText = emptyEl.createDiv({ cls: "duckmage-rt-empty" });
      const openTableBtn = emptyEl.createEl("button", { text: "Open table" });
      openTableBtn.addEventListener("click", () => {
        void plugin.app.workspace.getLeaf("tab").openFile(file);
      });

      // Result area — hidden until first roll (reuses modal CSS classes)
      const resultBox = block.createDiv({ cls: "duckmage-roll-result" });
      resultBox.hide();
      const resultTextarea = resultBox.createEl("textarea", {
        cls: "duckmage-roll-result-textarea",
      });
      resultTextarea.readOnly = true;
      const resultBtns = resultBox.createDiv({ cls: "duckmage-roll-result-btns" });
      const copyBtn = resultBtns.createEl("button", {
        text: "Copy",
        cls: "mod-cta",
      });
      copyBtn.addEventListener("click", () => {
        void navigator.clipboard.writeText(resultTextarea.value);
        copyBtn.setText("Copied!");
        window.setTimeout(() => copyBtn.setText("Copy"), 1200);
      });

      // History: scrollable list, each item individually copyable
      const historyEl = block.createDiv({ cls: "duckmage-roller-history" });
      const history: string[] = [];

      const renderHistory = () => {
        historyEl.empty();
        for (const item of history) {
          const row = historyEl.createDiv({ cls: "duckmage-roller-history-item" });
          row.createSpan({ cls: "duckmage-roller-history-text", text: item });
          const hCopyBtn = row.createEl("button", {
            text: "⎘",
            cls: "duckmage-roller-history-copy",
            attr: { title: "Copy" },
          });
          hCopyBtn.addEventListener("click", () => {
            void navigator.clipboard.writeText(item);
            hCopyBtn.setText("✓");
            window.setTimeout(() => hCopyBtn.setText("⎘"), 1000);
          });
        }
      };

      // Roll: re-reads the file each time so edits to the table are reflected live
      rollBtn.addEventListener("click", () => {
        void (async () => {
          const content = await plugin.app.vault.read(file);
          const table = parseRandomTable(content);
          const rolled = rollOnTable(table);
          if (!rolled) {
            emptyText.setText(emptyTableMessage(content));
            emptyEl.show();
            resultBox.hide();
            return;
          }
          emptyEl.hide();

          // For linked-folder / isLink entries strip the path prefix
          let display = rolled.result;
          if (rolled.isLink || table.linkedFolder) {
            display = display.split("/").pop() ?? display;
          }

          resultTextarea.value = display;
          resultBox.show();

          history.unshift(display);
          if (history.length > 10) history.pop();
          renderHistory();
        })();
      });
    },
  );
}
