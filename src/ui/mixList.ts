/**
 * A mix list (O6, owner 2026-10-14: "show only the types in the mix, plus
 * Add type … do this for the generator page as well, make sure they stay
 * consistent with one another and share code"). One component for the
 * biome page's Type mix and the generator page's Terrain mix:
 *
 * - only what is in the mix gets a row (splitMix);
 * - each row ends with the same "×" (mixRemoveButton): out of the mix;
 * - under the list, "+ Add type" / "+ Add terrain" (renderMixAdd) opens the
 *   shared picker (AddToMixModal: a tile per item not in the mix, with the
 *   picker standard's filter box, src/ui/pickers.ts).
 *
 * The rows themselves stay each page's own (share sliders on the biome page,
 * bias and patch counts on the generator page).
 */

import type { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import { addPickerFilter, emptyState, filterText } from "./pickers";

/** Something that can be in a mix: a terrain type, a terrain. */
export interface MixItem {
  id: string;
  label: string;
  /** A colour swatch before the name. */
  color?: string;
  /** Hover text (default: the label). */
  title?: string;
}

/** The items in the mix (in list order) and the ones that can be added. Pure. */
export function splitMix<T extends { id: string }>(all: readonly T[], inMix: (id: string) => boolean): { shown: T[]; addable: T[] } {
  const shown: T[] = [];
  const addable: T[] = [];
  const seen = new Set<string>();
  for (const item of all) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    (inMix(item.id) ? shown : addable).push(item);
  }
  return { shown, addable };
}

/** The "×" at the end of a mix row: takes the item out of the mix. */
export function mixRemoveButton(row: HTMLElement, label: string, onRemove: () => void): HTMLButtonElement {
  const btn = row.createEl("button", {
    cls: "duckmage-mix-remove clickable-icon",
    text: "×",
    attr: { "aria-label": `Remove ${label} from the mix`, title: `Remove ${label} from the mix` },
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    onRemove();
  });
  return btn;
}

export interface MixAddOptions {
  /** One item, as on the button: "type" → "+ Add type". */
  thing: string;
  /** Plural, for the picker's filter and empty state: "types". */
  things: string;
  /** Items not in the mix yet. */
  addable: readonly MixItem[];
  onAdd: (id: string) => void;
}

/** "+ Add type" under a mix list: the shared picker of what isn't in the mix. Disabled when everything is. */
export function renderMixAdd(app: App, parent: HTMLElement, o: MixAddOptions): HTMLButtonElement {
  const btn = parent.createEl("button", { cls: "duckmage-mix-add", text: `+ Add ${o.thing}` });
  if (!o.addable.length) {
    btn.disabled = true;
    btn.setAttr("title", `Every ${o.thing} is in the mix.`);
  }
  btn.addEventListener("click", () => {
    if (!o.addable.length) return;
    new AddToMixModal(app, o).open();
  });
  return btn;
}

/** The picker behind "+ Add …": one tile per item, a filter box, click to add. */
export class AddToMixModal extends HexmakerModal {
  protected surfaceId = "AddToMix";

  constructor(app: App, private o: MixAddOptions) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText(`Add a ${this.o.thing}`);
    this.contentEl.addClass("duckmage-mix-add-modal");
    const list = this.contentEl.createDiv({ cls: "duckmage-mix-add-list" });
    if (!this.o.addable.length) {
      emptyState(list, `Every ${this.o.thing} is in the mix.`);
      return;
    }
    for (const item of this.o.addable) {
      const tile = list.createEl("button", { cls: "duckmage-mix-add-tile", attr: { title: item.title ?? item.label } });
      if (item.color) tile.createSpan({ cls: "duckmage-biome-swatch" }).setCssProps({ "--duckmage-biome-color": item.color });
      tile.createSpan({ text: item.label });
      filterText(tile, item.label, item.id);
      tile.addEventListener("click", () => {
        this.close();
        this.o.onAdd(item.id);
      });
    }
    const filter = addPickerFilter(list, { things: this.o.things, count: this.o.addable.length, always: true });
    filter.input?.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
