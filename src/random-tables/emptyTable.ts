import type { App, TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { emptyTableMessage, parseRandomTable } from "./randomTable";
import { RandomTableEditorModal } from "./RandomTableEditorModal";

/**
 * An empty table, wherever it can be rolled (owner SF1, 2026-10-14):
 * tables ship empty, so Roll is disabled, not a silent no-op, and a short
 * empty state opens the table editor to add entries. The roll dialog, the
 * random tables view, the in-note roller, workflows and the hex editor all
 * use this one helper.
 */

/** Tooltip on a disabled Roll button while its table is empty. */
export const EMPTY_ROLL_TITLE = "Add entries to roll on this table";

/** Whether a table note has nothing to roll. */
export function tableIsEmpty(content: string): boolean {
  return parseRandomTable(content).entries.length === 0;
}

/** Disable (or re-enable) a Roll button for an empty table. */
export function setRollEnabled(btn: HTMLButtonElement, enabled: boolean): void {
  btn.disabled = !enabled;
  if (enabled) btn.removeAttribute("title");
  else btn.title = EMPTY_ROLL_TITLE;
}

export interface EmptyTableStateOptions {
  app: App;
  plugin: HexmakerPlugin;
  file: TFile;
  /** The table note's text (for the message, and passed to the editor). */
  content: string;
  /** After the editor saves: redraw with the new entries. */
  onSaved: () => void;
  /** One line (the hex editor's table row), not the full message. */
  compact?: boolean;
}

/** The empty state: what's wrong and an "Add entries" button that opens the table editor. */
export function renderEmptyTableState(parent: HTMLElement, o: EmptyTableStateOptions): HTMLElement {
  const el = parent.createDiv({ cls: `duckmage-rt-empty-state${o.compact ? " is-compact" : ""}` });
  el.createDiv({ cls: "duckmage-rt-empty", text: o.compact ? "No entries yet." : emptyTableMessage(o.content) });
  const add = el.createEl("button", { text: "Add entries", cls: "duckmage-rt-add-entries" });
  add.addEventListener("click", () => {
    new RandomTableEditorModal(o.app, o.plugin, o.file, o.onSaved, o.content).open();
  });
  return el;
}
