/**
 * World maps' parts of the Maps modal (src/hex-map/MapModal.ts): the
 * "New overworld…" tab button and, on a map with joined-up regions, the
 * Regions tab's "Make the missing regions" and "Generate overworld…" rows.
 * Reached through the module's hooks (src/modules/world-maps/api.ts).
 */

import type { App } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { MapData } from "../types";
import { canReshape } from "../workMode";
import { addGodOffer } from "../hex-map/godOffer";
import { meshes } from "../maps/submaps";
import { missingRegionHexes } from "./regionsVault";
import { GenerateRegionsModal, NewOverworldModal } from "./OverworldModals";
import { REGENERATE_LOCKED_HINT } from "./overworldGen";

/** "New overworld…": a World biomes map with its region settings (and its regions). */
export function openNewOverworld(plugin: HexmakerPlugin): void {
  // The form picks biomes from the notes: the shipped ones go in first (DJ-Q4).
  void plugin.ensureOverworldBiomes().then(() => new NewOverworldModal(plugin.app, plugin, (name) => void plugin.showMap(name)).open());
}

/** The tab bar's "New overworld…" button (beside New map…). */
export function addNewOverworldTab(tabBar: HTMLElement, plugin: HexmakerPlugin, close: () => void): void {
  tabBar.createEl("button", { text: "New overworld…", cls: "duckmage-rt-mode-tab duckmage-map-new-btn", attr: { title: "A map of biomes whose hexes open into regions that join up" } })
    .addEventListener("click", () => {
      close();
      openNewOverworld(plugin);
    });
}

export interface RegionsTabHost {
  app: App;
  plugin: HexmakerPlugin;
  render(): void;
  changed(): void;
  close(): void;
}

/** The Regions tab's overworld rows for `map` (nothing unless its regions join up). */
export function renderOverworldRegionRows(el: HTMLElement, host: RegionsTabHost, map: MapData): void {
  const { app, plugin } = host;
  if (!meshes(map.regions)) return;
  const missing = missingRegionHexes(plugin, map.name).length;
  const row = el.createDiv({ cls: "duckmage-region-row" });
  const btn = row.createEl("button", { text: missing ? `Make the missing regions (${missing})…` : "Every painted hex has a region" });
  btn.disabled = !missing;
  row.createSpan({ cls: "duckmage-map-origin-desc", text: "One region per painted hex, each blending with its neighbours." });
  btn.addEventListener("click", () => {
    new GenerateRegionsModal(app, plugin, map.name, () => {
      host.render();
      host.changed();
    }).open();
  });
  // The first pass again, over the whole map (God only; locked hexes kept).
  const genRow = el.createDiv({ cls: "duckmage-region-row" });
  const gen = genRow.createEl("button", { text: "Generate overworld…" });
  const genDesc = genRow.createSpan({ cls: "duckmage-map-origin-desc", text: canReshape(map) ? "Lay out biomes from a pool again and remake the regions. Locked hexes stay." : REGENERATE_LOCKED_HINT });
  if (!canReshape(map)) addGodOffer(genDesc, plugin, map.name, REGENERATE_LOCKED_HINT, () => host.render());
  gen.addEventListener("click", () => {
    host.close();
    new NewOverworldModal(app, plugin, () => host.changed(), map.name).open();
  });
}
