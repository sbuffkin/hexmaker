/** The Fog of war module's runtime: its service and its hooks on the party and the map. */

import type { ModuleRuntime } from "../types";
import { setFog } from "../../fog/context";
import { FogService } from "../../fog/FogService";
import { fogFrontier, fogHexMenu, fogLook, fogPartyClick, fogPartyControls, fogStep, fogViewOf } from "../../fog/fogHooks";

export const fogRuntime: ModuleRuntime = {
  id: "fog",
  stores(plugin) {
    setFog(plugin, new FogService(plugin));
    return [];
  },
  play: {
    onEnter: fogStep,
    // The party's own hex clicked: a look around where it stands (HF11).
    partyClick: fogPartyClick,
    onLook: fogLook,
    partyControls: fogPartyControls,
    // A finished map explored by revealing it (HF11).
    fog: fogViewOf,
  },
  hexMenu: fogHexMenu,
  unchartedKeys: fogFrontier,
};
