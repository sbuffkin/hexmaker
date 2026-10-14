/**
 * The Hex flower module's runtime (plan-hex-flower): the flower notes'
 * store and folder setting, and the code block that draws a flower in its
 * note.
 */

import type HexmakerPlugin from "../../HexmakerPlugin";
import type { ModuleRuntime, ModuleStore } from "../types";
import { FlowerStore } from "../../hexflower/FlowerStore";
import { FLOWER_BLOCK } from "../../hexflower/flowerNote";
import { flowerStoreOf, setExplore, setFlowerStore, terrainColors } from "../../hexflower/context";
import { ExploreService } from "../../hexflower/ExploreService";
import { exploreFrontier, exploreHexMenu, exploreStep } from "../../hexflower/exploreHooks";
import { drawFlowerList, renderFlowerPanel } from "../../hexflower/FlowerPanel";
import { HEX_FLOWER_GENERATOR_ID, hexFlowerGenerator } from "../../hexflower/flowerGenerator";
import { EXPLORE_PROPS } from "../../hexflower/exploreProps";
import { drawFlower } from "../../hexflower/flowerView";

function stores(plugin: HexmakerPlugin): ModuleStore[] {
  // The flower drawn where its note says ```duckmage-hex-flower``` (registered when the store starts).
  const store = new FlowerStore(plugin, undefined, () => plugin.registerMarkdownCodeBlockProcessor(FLOWER_BLOCK, (_source, el, ctx) => {
    const entry = flowerStoreOf(plugin)?.get(ctx.sourcePath);
    if (!entry) {
      el.createDiv({ cls: "duckmage-flower-missing", text: "This hex flower is drawn once its note is in the hex flowers folder." });
      return;
    }
    drawFlower(el, entry.flower, { colors: terrainColors(plugin, entry.flower.palette), cls: "is-note" });
  }));
  setFlowerStore(plugin, store);
  setExplore(plugin, new ExploreService(plugin));
  return [store];
}

export const hexFlowerRuntime: ModuleRuntime = {
  id: "hex-flower",
  stores,
  // The Hex flower card, on every map scale right after Blank.
  generators: (plugin, helpers) => [hexFlowerGenerator(plugin, helpers)],
  newMapOptionIds: { [HEX_FLOWER_GENERATOR_ID]: { party: "NewMap.flowerParty", reveal: "NewMap.flowerReveal" } },
  mapProperties: [EXPLORE_PROPS],
  play: { onEnter: exploreStep },
  hexMenu: exploreHexMenu,
  unchartedKeys: exploreFrontier,
  // The generator page's third library tab: the flowers and their editor.
  generatorPage: [{
    id: "hex-flowers",
    label: "Hex flowers",
    count: (plugin) => flowerStoreOf(plugin)?.list().length ?? 0,
    drawList: drawFlowerList,
    renderPanel: renderFlowerPanel,
  }],
  folderSettings: [{
    id: "Settings.hexFlowersFolder",
    key: "hexFlowersFolder",
    name: "Hex flowers folder",
    placeholder: "World/hex flowers",
    desc: "Where hex flower notes live (blank: the world folder's hex flowers).",
    changed: (plugin) => void flowerStoreOf(plugin)?.reload(),
  }],
};
