/**
 * Map properties → Hex flower (plan-hex-flower; a map setting, owner HF8):
 * on any map, a switch to explore it with a hex flower (exploreSwitch.ts).
 * On a map the party explores: its rules (one per line, top to bottom),
 * what a step reveals (the hex, or 1–3 rings around it), whether the map
 * grows as the party nears an edge (HF4), filling every blank hex now, and
 * turning it off.
 */

import { Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import type { MapPropertiesSection } from "../modules/types";
import { isExploreMap } from "./exploreFields";
import { growOff } from "./exploreGrow";
import { formatReveal, parseFlowerAt, parseReveal, parseRule } from "./explore";
import { exploreOf, flowerStoreOf } from "./context";
import { disableExploring, enableExploring } from "./exploreSwitch";
import { NEW_FLOWER } from "./flowerGenerator";

export const EXPLORE_PROPS: MapPropertiesSection = {
  id: "exploring",
  render(el: HTMLElement, plugin: HexmakerPlugin, map: MapData, rerender: () => void): void {
    if (!isExploreMap(map)) { renderTurnOn(el, plugin, map, rerender); return; }
    const box = el.createDiv({ cls: "duckmage-explore-props" });
    box.createEl("h4", { text: "Hex flower" });
    box.createEl("p", {
      cls: "duckmage-map-origin-desc",
      text: "When the party walks into a blank hex, these roll top to bottom: a hex flower or table, then where the result goes (terrain, a section, play log). Add \", every step\" to roll on every step.",
    });
    const rules = box.createEl("textarea", { cls: "duckmage-explore-rules", attr: { rows: "4", "aria-label": "Explore with" } });
    rules.value = (map.exploreWith ?? []).join("\n");
    const problems = box.createDiv({ cls: "duckmage-map-origin-desc" });
    const check = () => {
      const bad = rules.value.split(/\r?\n/).filter((l) => l.trim() && "error" in parseRule(l));
      problems.setText(bad.length ? `Can't read: ${bad.join("; ")}` : "");
    };
    check();
    rules.addEventListener("input", check);
    rules.addEventListener("change", () => {
      map.exploreWith = rules.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      void plugin.saveSettings();
      if (!isExploreMap(map)) rerender();
    });

    const row = box.createDiv({ cls: "duckmage-region-row" });
    row.createSpan({ text: "Each step fills" });
    const reveal = row.createEl("select", { attr: { "aria-label": "Each step fills" } });
    for (const [value, text] of REVEAL_CHOICES) reveal.createEl("option", { text, value });
    reveal.value = String(parseReveal(map.exploreReveal));
    reveal.addEventListener("change", () => {
      const v = formatReveal(Number(reveal.value));
      if (v) map.exploreReveal = v;
      else delete map.exploreReveal;
      void plugin.saveSettings();
    });
    row.createSpan({ cls: "duckmage-map-origin-desc", text: "The party's Reveal button fills more at any time." });

    const growRow = box.createEl("label", { cls: "duckmage-region-row" });
    const grow = growRow.createEl("input", { type: "checkbox", attr: { "aria-label": GROW_LABEL } });
    grow.checked = !growOff(map);
    growRow.createSpan({ text: GROW_LABEL });
    if (map.world) growRow.createSpan({ cls: "duckmage-map-origin-desc", text: "Not on a map with neighbouring regions." });
    grow.addEventListener("change", () => {
      // Written only when off: an explored map grows by default.
      if (grow.checked) delete map.exploreGrow;
      else map.exploreGrow = "off";
      void plugin.saveSettings();
    });

    const at = [...parseFlowerAt(map.hexFlowerAt)];
    if (at.length) box.createDiv({ cls: "duckmage-map-origin-desc", text: `Where the walks stand: ${at.map(([f, c]) => `${f} ${c}`).join(", ")}` });

    const fill = box.createEl("button", { text: "Fill every blank hex now", attr: { title: "Fill the rest of the map outward from the explored hexes, as if the party had walked everywhere" } });
    fill.addEventListener("click", () => {
      const ex = exploreOf(plugin);
      const start = [...plugin.mapStore.all(map.name)].find(([, h]) => h.terrain)?.[0];
      if (!ex || !start) { new Notice("Explore a hex first: the rest fills outward from it."); return; }
      fill.disabled = true;
      void ex.fillAll(map.name, start).then((n) => {
        new Notice(`Filled ${n} hex${n === 1 ? "" : "es"}.`);
        plugin.refreshHexMap();
        rerender();
      });
    });

    const off = box.createEl("button", { text: "Stop exploring this map", attr: { title: "The flower note, the party and the filled hexes stay" } });
    off.addEventListener("click", () => {
      void disableExploring(plugin, map.name).then(() => { plugin.refreshHexMap(); rerender(); });
    });
  },
};

export const GROW_LABEL = "Grow the map as the party nears an edge";

/** The map-note values the "Each step fills" choice offers (0 = the hex entered). */
const REVEAL_CHOICES: [string, string][] = [
  ["0", "The hex entered"],
  ["1", "1 ring around it"],
  ["2", "2 rings around it"],
  ["3", "3 rings around it"],
];

/** On a map not explored yet: the switch to explore it with a hex flower. */
function renderTurnOn(el: HTMLElement, plugin: HexmakerPlugin, map: MapData, rerender: () => void): void {
  const box = el.createDiv({ cls: "duckmage-explore-props" });
  box.createEl("h4", { text: "Hex flower" });
  box.createEl("p", {
    cls: "duckmage-map-origin-desc",
    text: "Solo exploring: blank hexes fill in as the party walks into them, rolled on a hex flower.",
  });
  const row = box.createDiv({ cls: "duckmage-region-row" });
  row.createSpan({ text: "Flower" });
  const pick = row.createEl("select", { attr: { "aria-label": "Hex flower" } });
  pick.createEl("option", { text: "New from this map's palette", value: NEW_FLOWER });
  for (const e of flowerStoreOf(plugin)?.list() ?? []) pick.createEl("option", { text: e.flower.name, value: e.flower.name });
  const partyRow = box.createEl("label", { cls: "duckmage-region-row" });
  const party = partyRow.createEl("input", { type: "checkbox", attr: { "aria-label": "Party token" } });
  party.checked = true;
  partyRow.createSpan({ text: "Put a party token on the middle hex (if the map has none)" });
  const on = box.createEl("button", { cls: "mod-cta", text: "Explore this map" });
  on.addEventListener("click", () => {
    on.disabled = true;
    void enableExploring(plugin, map.name, { flower: pick.value, party: party.checked }).then((path) => {
      if (path) new Notice("Exploring is on: select the party, then click a hex next to it.");
      plugin.refreshHexMap();
      rerender();
    });
  });
}
