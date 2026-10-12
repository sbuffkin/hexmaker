/**
 * Map properties: what happens on arrival (GM4), for the open map and
 * everything under it. One select per line, so a change is two clicks
 * ("easy, modular and as low-click as possible"). Modules add their own
 * sections (Space: Generator tables, src/space/roleTablesSection.ts).
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import { ARRIVAL_MODE_TEXT, ARRIVAL_MODE_WORDS, parseArrivalMode, type ArrivalMode } from "../arrival/arrival";

/** "Arriving somewhere new": make places, or not; blank follows the map above. */
export function renderArrivalSetting(el: HTMLElement, plugin: HexmakerPlugin, map: MapData, rerender: () => void): void {
  el.createEl("h4", { text: "Arriving somewhere new" });
  el.createDiv({
    cls: "duckmage-map-origin-desc",
    text: "Going into a hex that has no map yet (Go there in the hex menu, or Ctrl+click). Making the place works in Play too; the new place can be rerolled until you lock it. Maps under this one do the same unless they set their own.",
  });
  const row = el.createDiv({ cls: "duckmage-region-row" });
  const select = row.createEl("select", { attr: { "aria-label": "Arriving somewhere new" } });
  const parent = plugin.parentOf(map.name)?.map;
  const inherited = parent ? plugin.arrivalModeFor(parent) : { mode: "off" as ArrivalMode };
  select.createEl("option", {
    value: "",
    text: parent && inherited.from ? `Same as ${plugin.mapLabel(inherited.from)} (${ARRIVAL_MODE_TEXT[inherited.mode].toLowerCase()})` : `${ARRIVAL_MODE_TEXT.off} (default)`,
  });
  for (const m of ["make", "off"] as ArrivalMode[]) select.createEl("option", { value: m, text: ARRIVAL_MODE_TEXT[m] });
  select.value = parseArrivalMode(map.arrivalMode) ?? "";
  select.addEventListener("change", () => {
    const v = select.value as ArrivalMode | "";
    if (v) map.arrivalMode = ARRIVAL_MODE_WORDS[v];
    else delete map.arrivalMode;
    void plugin.saveSettings().then(rerender);
  });
}
