/**
 * Map properties → Exploring (plan-hex-flower): on a map the party
 * explores, its rules (one per line, top to bottom), what a step reveals,
 * and filling every blank hex now. Nothing on other maps (no nag).
 */

import { Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import type { MapPropertiesSection } from "../modules/types";
import { isExploreMap } from "./exploreFields";
import { parseFlowerAt, parseReveal, parseRule } from "./explore";
import { exploreOf } from "./context";

export const EXPLORE_PROPS: MapPropertiesSection = {
  id: "exploring",
  render(el: HTMLElement, plugin: HexmakerPlugin, map: MapData, rerender: () => void): void {
    if (!isExploreMap(map)) return;
    const box = el.createDiv({ cls: "duckmage-explore-props" });
    box.createEl("h4", { text: "Exploring" });
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
    reveal.createEl("option", { text: "The hex entered", value: "entered" });
    reveal.createEl("option", { text: "The blank hexes around it too", value: "neighbours" });
    reveal.value = parseReveal(map.exploreReveal);
    reveal.addEventListener("change", () => {
      if (reveal.value === "neighbours") map.exploreReveal = "neighbours";
      else delete map.exploreReveal;
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
  },
};
