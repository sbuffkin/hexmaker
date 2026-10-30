/**
 * The generator page module's runtime: the page's view, its command, and
 * the page api the core and other modules open it through (genPage()).
 */

import type HexmakerPlugin from "../../HexmakerPlugin";
import type { BiomeStore } from "../../overworld/BiomeStore";
import type { GenPageApi, ModuleRuntime } from "../types";
import { onDebugModeChange } from "../../ui/debugMode";
import { GeneratorView, VIEW_TYPE_GENERATOR } from "./GeneratorView";
import { generatorPageState } from "./generatorPageState";

/** Redraw every open generator page. */
function refreshPages(plugin: HexmakerPlugin): void {
  for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE_GENERATOR)) {
    if (leaf.view instanceof GeneratorView) leaf.view.refresh();
  }
}

/**
 * Open the generator page (or bring it forward), optionally with a map and
 * generator selected, or a biome (#50): a blend-field biome opens as
 * "Biome (blend field)", a generator-backed one opens its generator (the
 * page says which biomes use it).
 */
export async function openGenPage(plugin: HexmakerPlugin, select: { mapName?: string; generatorPath?: string; paletteName?: string; biome?: string } = {}): Promise<void> {
  if (select.mapName) generatorPageState.mapName = select.mapName;
  if (select.paletteName) generatorPageState.paletteName = select.paletteName;
  if (select.generatorPath) {
    generatorPageState.selectedPath = select.generatorPath;
    generatorPageState.biome = "";
  }
  if (select.biome) {
    const b = (plugin.moduleStore("biomes") as BiomeStore | undefined)?.get(select.biome);
    const { vault, metadataCache } = plugin.app;
    const file = b?.generator ? vault.getAbstractFileByPath(`${b.generator}.md`) ?? vault.getAbstractFileByPath(b.generator) ?? metadataCache.getFirstLinkpathDest(b.generator, "") : null;
    if (b && file) {
      generatorPageState.selectedPath = file.path;
      generatorPageState.biome = "";
    } else if (b && !b.generator) generatorPageState.biome = b.id;
  }
  const existing = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_GENERATOR)[0];
  if (existing) {
    await plugin.app.workspace.revealLeaf(existing);
    if (existing.view instanceof GeneratorView) existing.view.refresh();
    return;
  }
  await plugin.app.workspace.getLeaf("tab").setViewState({ type: VIEW_TYPE_GENERATOR, active: true });
}

const api: GenPageApi = { open: openGenPage, refresh: refreshPages };

export const genPageRuntime: ModuleRuntime = {
  id: "gen-page",
  views: [{ type: VIEW_TYPE_GENERATOR, create: (leaf, plugin) => new GeneratorView(leaf, plugin) }],
  commands: [{
    id: "open-terrain-generator",
    name: "Open terrain generator",
    placementId: "Plugin.cmd.openTerrainGenerator",
    run: (plugin) => openGenPage(plugin),
  }],
  genPage: () => api,
  // The page has Debug-only parts: redraw it when debug mode changes.
  lifecycle: { onload: (plugin) => { plugin.register(onDebugModeChange(() => refreshPages(plugin))); } },
};
