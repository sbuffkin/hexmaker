import { TFile } from "obsidian";
import { handRollLabel } from "../arrival/eventsLedger";
import type HexmakerPlugin from "../HexmakerPlugin";
import { dieLabel, parseRandomTable, rollTable } from "./randomTable";
import { renderEmptyTableState, setRollEnabled, tableIsEmpty } from "./emptyTable";
import { withRepairHint } from "../ui/repairHint";

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
          text: withRepairHint(`Table not found: "${targetPath}"`),
        });
        return;
      }

      // The die is the table's own (its frontmatter / roll column header).
      const initialContent = await plugin.app.vault.read(file);
      const initialTable = parseRandomTable(initialContent);

      // ── Widget container ─────────────────────────────────────────────
      const block = el.createDiv({ cls: "duckmage-roller-block" });

      // Header: title + the table's die
      const header = block.createDiv({ cls: "duckmage-roller-header" });
      header.createSpan({
        cls: "duckmage-roller-title",
        text: `🎲 ${file.basename}`,
      });
      const dieEl = header.createSpan({
        cls: "duckmage-roller-die",
        text: dieLabel(initialTable.dice),
      });

      // Roll button
      const rollBtn = block.createEl("button", {
        text: "Roll",
        cls: "duckmage-roller-btn mod-cta",
      });

      // An empty table (tables ship empty, SF1): Roll is disabled and the
      // shared empty state opens the table editor. Checked again after an
      // edit there and before each roll.
      const emptyWrap = block.createDiv();
      const showEmpty = (content: string): boolean => {
        emptyWrap.empty();
        const empty = tableIsEmpty(content);
        setRollEnabled(rollBtn, !empty);
        if (empty) {
          renderEmptyTableState(emptyWrap, {
            app: plugin.app,
            plugin,
            file,
            content,
            onSaved: () => void plugin.app.vault.read(file).then(showEmpty),
          });
        }
        return empty;
      };
      showEmpty(initialContent);

      // Result area — hidden until first roll (reuses modal CSS classes)
      const resultBox = block.createDiv({ cls: "duckmage-roll-result" });
      resultBox.hide();
      const resultTextarea = resultBox.createEl("textarea", {
        cls: "duckmage-roll-result-textarea",
      });
      resultTextarea.readOnly = true;
      const faceEl = resultBox.createDiv({ cls: "duckmage-roll-face" });
      resultTextarea.before(faceEl);
      const resultBtns = resultBox.createDiv({ cls: "duckmage-roll-result-btns" });
      const copyBtn = resultBtns.createEl("button", {
        text: "Copy",
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
          dieEl.setText(dieLabel(table.dice));
          const outcome = rollTable(table);
          const rolled = outcome?.entry;
          if (showEmpty(content) || !outcome || !rolled) {
            resultBox.hide();
            return;
          }

          // For linked-folder / isLink entries strip the path prefix
          let display = rolled.result;
          if (rolled.isLink || table.linkedFolder) {
            display = display.split("/").pop() ?? display;
          }

          resultTextarea.value = display;
          // "d20 → 14": the face rolled, so it can be checked against the note.
          const face = handRollLabel(table, outcome);
          faceEl.setText(face);
          faceEl.toggle(!!face);
          resultBox.show();

          history.unshift(display);
          if (history.length > 10) history.pop();
          renderHistory();
        })();
      });
    },
  );
}
