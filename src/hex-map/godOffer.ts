/**
 * The inline God offer (owner, 2026-10-11): God sits in the mode switch's
 * Advanced ▸ submenu, so where someone tries an action only God may do
 * (reroll a locked place, change a placed biome, regenerate, swap, shrink,
 * delete), the "Switch to God…" hint becomes a button that switches the map
 * there and then. Hints for Build stay plain text; nothing is offered
 * anywhere else. The decision is godOfferText (src/workMode.ts, pure).
 */
import { Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { GOD_OFFER, godOfferText } from "../workMode";

/**
 * A "Switch to God for this map" button after a locked hint, when the hint
 * names God (else nothing). `after` runs once the map is in God (e.g.
 * re-render the form so the unlocked controls show).
 */
export function addGodOffer(parent: HTMLElement, plugin: HexmakerPlugin, mapName: string, hint: string | null | undefined, after?: () => void): HTMLButtonElement | null {
  const text = godOfferText(hint);
  if (!text) return null;
  const btn = parent.createEl("button", { cls: "duckmage-god-offer", text: GOD_OFFER, attr: { title: text } });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    plugin.setMapWorkMode(mapName, "god");
    after?.();
  });
  return btn;
}

/**
 * Show a locked hint as a Notice; when it names God, the Notice carries the
 * switch button (and stays up a little longer so it can be clicked).
 */
export function lockedNotice(plugin: HexmakerPlugin, mapName: string, hint: string, after?: () => void): void {
  if (!godOfferText(hint)) {
    new Notice(hint);
    return;
  }
  // Up a little longer, so the button can be clicked.
  const notice = new Notice(hint, 8000);
  const el = (notice as Partial<Notice>).messageEl;
  if (!el) return;
  el.addClass("duckmage-god-offer-notice");
  addGodOffer(el, plugin, mapName, hint, () => {
    notice.hide();
    after?.();
  });
}
