/**
 * The party controls (owner HF3, 2026-10-16): a small bar over the map
 * while a party token is selected in Play, with the modules' controls for
 * it (Hex flower: Reveal 1 · 2 · 3, fill the blank hexes that many rings
 * around the party, any time after a step). Each button's writes are one
 * undo. Nothing is shown when no module has a control for this map (no
 * nag).
 */
import type HexmakerPlugin from "../../HexmakerPlugin";
import { modulePartyControls } from "../../modules/runtime";
import type { PartyAt } from "../../modules/types";
import { logError } from "../../log";
import type { UndoItem } from "../undoItems";
import { gridBoxOf, sameGrid, type GridBox } from "../../maps/gridGrowth";

export const PARTY_CONTROLS_CLS = "duckmage-party-controls";

export interface PartyControlsHost {
  controlsEl(): HTMLElement | null;
  /** Record what a button wrote as one undo on map `map`. */
  pushUndo(item: UndoItem, map: string): void;
  renderGrid(): void;
  /** After the grid went from `before` to `after` and was redrawn: keep the view still. */
  keepViewStill(before: GridBox, after: GridBox): void;
}

/** Draw (or clear) the party controls for `party` (undefined: none selected). */
export function drawPartyControls(plugin: HexmakerPlugin, host: PartyControlsHost, party: (PartyAt & { title: string }) | undefined): void {
  const parent = host.controlsEl();
  if (!parent) return;
  parent.querySelector(`:scope > .${PARTY_CONTROLS_CLS}`)?.remove();
  if (!party) return;
  const controls = modulePartyControls(plugin, party);
  if (!controls.length) return;
  const bar = parent.createDiv({ cls: PARTY_CONTROLS_CLS, attr: { role: "toolbar", "aria-label": `${party.title}: party controls` } });
  bar.createSpan({ cls: "duckmage-party-controls-name", text: party.title });
  const buttons: HTMLButtonElement[] = [];
  for (const c of controls) {
    const group = bar.createDiv({ cls: "duckmage-party-control", attr: { "data-control": c.id } });
    group.createSpan({ cls: "duckmage-party-control-label", text: c.label, attr: c.title ? { title: c.title } : {} });
    for (const b of c.buttons) {
      const btn = group.createEl("button", { text: b.label, attr: { title: b.title, "aria-label": `${c.label} ${b.label}` } });
      buttons.push(btn);
      btn.addEventListener("click", () => {
        buttons.forEach((x) => (x.disabled = true));
        const map = plugin.getMap(party.map);
        const before = map ? gridBoxOf(map) : undefined;
        void b.run()
          .then((undo) => {
            if (undo.length) host.pushUndo(undo.length === 1 ? undo[0] : { kind: "group", items: undo }, party.map);
            host.renderGrid();
            // A Reveal near the edge grows the map (HF4): keep what's on screen still.
            const after = map ? gridBoxOf(map) : undefined;
            if (before && after && !sameGrid(before, after)) host.keepViewStill(before, after);
          })
          .catch((e) => logError(`party control ${c.id}`, e))
          .finally(() => buttons.forEach((x) => (x.disabled = false)));
      });
    }
  }
}
