import { TFile, type App } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { choiceSourceLabel, type TableChoiceItem } from "../tableChoice";
import { tableTitle } from "../encounterLinks";
import { withRepairHint } from "../ui/repairHint";
import { renderEmptyTableState, setRollEnabled, tableIsEmpty } from "./emptyTable";

/** Unique radio-group names. */
let choiceSeq = 0;

export interface TableChoiceOptions {
  app: App;
  plugin: HexmakerPlugin;
  /** What the tables are for, in UI text ("encounter", "weather"). */
  noun: string;
  items: TableChoiceItem[];
  /** Index of the item to start on (tableChoice.ts initialChoice). */
  start: number;
  /** The user switched tables (remember it; nothing is written). */
  onChoose: (item: TableChoiceItem) => void;
  onRoll: (item: TableChoiceItem) => void;
  /** Open the table (its name was clicked). */
  onOpen: (item: TableChoiceItem) => void;
  /** "change…": pick any other table. */
  onChange: () => void;
  /** Remove a table linked in the hex note (items with `link`). */
  onRemove?: (item: TableChoiceItem) => void;
}

/**
 * One section's tables (owner SF2): the tables that apply to this hex,
 * most specific first, as radio buttons when there are several; the chosen
 * table's name; Roll; and "change…" to pick any other table. Roll is
 * disabled on an empty table, with the shared empty state (SF1).
 */
export class TableChoice {
  readonly el: HTMLElement;
  private chosen: number;
  private readonly name = `duckmage-table-choice-${++choiceSeq}`;
  /** Bumped on every redraw so a late file read can't draw into a newer one. */
  private drawn = 0;

  constructor(parent: HTMLElement, private o: TableChoiceOptions) {
    this.el = parent.createDiv({ cls: "duckmage-table-choice" });
    this.chosen = o.start;
    this.render();
  }

  /** The chosen item, if any. */
  get current(): TableChoiceItem | undefined {
    return this.o.items[this.chosen];
  }

  /** Show a new list (after a link was added or removed), starting on `start`. */
  setItems(items: TableChoiceItem[], start: number): void {
    this.o.items = items;
    this.chosen = start;
    this.render();
  }

  private render(): void {
    const { el, o } = this;
    const run = ++this.drawn;
    el.empty();
    const items = o.items;

    if (items.length === 0) {
      el.createDiv({ cls: "duckmage-table-choice-none", text: `No ${o.noun} table yet.` });
    } else if (items.length === 1) {
      this.renderItem(el.createDiv({ cls: "duckmage-table-choice-one" }), items[0]);
    } else {
      const list = el.createDiv({ cls: "duckmage-table-choice-options", attr: { role: "radiogroup", "aria-label": `${o.noun} tables` } });
      items.forEach((item, i) => {
        const row = list.createEl("label", { cls: "duckmage-table-choice-option" });
        const radio = row.createEl("input", { type: "radio", attr: { name: this.name, value: String(i) } });
        radio.checked = i === this.chosen;
        radio.addEventListener("change", () => {
          if (!radio.checked) return;
          this.chosen = i;
          o.onChoose(item);
          this.render();
        });
        this.renderItem(row, item);
      });
    }

    const actions = el.createDiv({ cls: "duckmage-table-choice-actions" });
    const roll = actions.createEl("button", { text: "🎲 Roll", cls: "duckmage-table-choice-roll" });
    const change = actions.createEl("a", { text: "Change…", href: "#", cls: "duckmage-table-choice-change" });
    change.title = `Pick another ${o.noun} table for this hex`;
    change.addEventListener("click", (e) => {
      e.preventDefault();
      o.onChange();
    });

    const current = this.current;
    const file = current && !current.missing ? o.app.vault.getAbstractFileByPath(current.path) : null;
    if (!current || !(file instanceof TFile)) {
      roll.disabled = true;
      roll.title = current ? withRepairHint(`${current.path}: no such note.`) : `Pick a ${o.noun} table first`;
      return;
    }
    roll.title = `Roll on ${tableTitle(current.path)}`;
    roll.addEventListener("click", () => o.onRoll(current));
    // Empty tables (SF1): Roll off, and a way to add entries right here.
    roll.disabled = true;
    const emptyWrap = el.createDiv();
    void o.app.vault.cachedRead(file).then((content) => {
      if (run !== this.drawn) return;
      const empty = tableIsEmpty(content);
      setRollEnabled(roll, !empty);
      if (!empty) {
        roll.title = `Roll on ${tableTitle(current.path)}`;
        return;
      }
      renderEmptyTableState(emptyWrap, { app: o.app, plugin: o.plugin, file, content, compact: true, onSaved: () => this.render() });
    });
  }

  /** A table's name (opens it), where it comes from, and × for a link in the hex note. */
  private renderItem(row: HTMLElement, item: TableChoiceItem): void {
    const { o } = this;
    const nameEl = row.createSpan({ cls: "duckmage-table-choice-name", text: tableTitle(item.path) });
    if (item.missing) {
      nameEl.addClass("is-missing");
      nameEl.title = withRepairHint(`[[${item.link ?? item.path}]]: no such note.`);
    } else {
      nameEl.addClass("duckmage-link-item-clickable");
      nameEl.title = `Open ${item.path}`;
      nameEl.addEventListener("click", (e) => {
        e.preventDefault();
        o.onOpen(item);
      });
    }
    row.createSpan({ cls: "duckmage-table-choice-source", text: choiceSourceLabel(item.source) });
    if (item.link && o.onRemove) {
      const remove = row.createEl("button", { text: "×", cls: "duckmage-link-remove-btn", attr: { "aria-label": `Remove ${tableTitle(item.path)} from this hex` } });
      remove.addEventListener("click", (e) => {
        e.preventDefault();
        o.onRemove?.(item);
      });
    }
  }
}
