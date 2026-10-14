/**
 * The hex flower module's per-plugin pieces (the store, the explore
 * service), made once by its runtime and found here by the rest of it.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import type { FlowerStore } from "./FlowerStore";

interface Parts {
  store?: FlowerStore;
}

const parts = new WeakMap<object, Parts>();

function of(plugin: HexmakerPlugin): Parts {
  let p = parts.get(plugin);
  if (!p) { p = {}; parts.set(plugin, p); }
  return p;
}

export function flowerStoreOf(plugin: HexmakerPlugin): FlowerStore | undefined {
  return parts.get(plugin)?.store;
}

export function setFlowerStore(plugin: HexmakerPlugin, store: FlowerStore): void {
  of(plugin).store = store;
}

/** The palette's terrain colours by name (lower case). */
export function terrainColors(plugin: HexmakerPlugin, palette: string | undefined): Map<string, string> {
  const terrains = palette ? plugin.getPaletteOrPresetTerrains(palette) : [];
  return new Map(terrains.map((t) => [t.name.trim().toLowerCase(), t.color]));
}
