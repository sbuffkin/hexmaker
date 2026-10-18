/**
 * New map's generator list: one card per generator that fits, the picked
 * one ticked. Where a map joins a neighbour, each card says whether it
 * carries on the neighbour's edge.
 */

import type { TerrainColor } from "../../types";
import { describeKind, type TerrainGeneratorKind } from "../registry";

export interface GeneratorCardsOptions {
  kinds: readonly TerrainGeneratorKind[];
  terrains: TerrainColor[];
  selected: string;
  /** A card's text when it isn't the generator's own (Region detail for this hex). */
  describe?(kind: TerrainGeneratorKind): string | undefined;
  /** Next to a map: its name, for "Continues X's edge". */
  neighbour?: string;
  pick(kind: TerrainGeneratorKind): void;
}

/** Draw the cards into `list` (emptied first). */
export function renderGeneratorCards(list: HTMLElement, o: GeneratorCardsOptions): void {
  list.empty();
  for (const k of o.kinds) {
    const on = k.id === o.selected;
    const card = list.createEl("button", {
      cls: `duckmage-setup-gen${on ? " is-active" : ""}`,
      attr: { role: "radio", "aria-checked": on ? "true" : "false" },
    });
    card.createDiv({ cls: "duckmage-setup-gen-title", text: k.label + (k.source === "learned" ? " (learned)" : "") });
    card.createDiv({ cls: "duckmage-setup-gen-desc", text: o.describe?.(k) ?? describeKind(k, o.terrains) });
    if (o.neighbour !== undefined) {
      card.createDiv({
        cls: `duckmage-setup-gen-seam${k.continuesNeighbours ? " is-continues" : ""}`,
        text: `${k.continuesNeighbours ? "Continues" : "Ignores"} ${o.neighbour}'s edge`,
      });
    }
    card.addEventListener("click", () => o.pick(k));
  }
}
