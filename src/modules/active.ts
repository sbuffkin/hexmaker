/**
 * The runtime halves compiled into this build, for module code. ./runtime.ts
 * hands its list over here when it loads, so a module's own code can ask
 * for another module's api (genPage(), worldMaps()) or walk the list
 * without importing ./runtime.ts, which imports every module (an import
 * cycle; tests/importCycles.test.ts). Read only inside functions.
 *
 * Types only besides the list: safe to import from anywhere.
 */

import { logError } from "../log";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { UndoItem } from "../hex-map/undoItems";
import type { GenPageApi, ModuleRuntime, PartyAt } from "./types";
import type { WorldMapsApi } from "./world-maps/api";

let runtimes: readonly ModuleRuntime[] = [];

/** Called once by ./runtime.ts with MODULE_RUNTIMES (the same array, so tests that add a fake module see it here too). */
export function setActiveRuntimes(list: readonly ModuleRuntime[]): void {
  runtimes = list;
}

/** The runtime halves of the modules in this build, in module order. */
export function activeRuntimes(): readonly ModuleRuntime[] {
  return runtimes;
}

/** The generator page (undefined in a build without the module that provides it). */
export function genPage(): GenPageApi | undefined {
  for (const m of runtimes) if (m.genPage) return m.genPage();
  return undefined;
}

/** World maps' hooks into the map surfaces (undefined in a build without the World maps slice). */
export function worldMaps(): WorldMapsApi | undefined {
  for (const m of runtimes) if (m.worldMaps) return m.worldMaps();
  return undefined;
}

/**
 * The party looks around where it stands (its own hex clicked in Play, or a
 * Look button): each module's onLook, in module order; the undo entries of
 * what they wrote. A hook that fails is logged and skipped.
 */
export async function runPartyLooked(plugin: HexmakerPlugin, party: PartyAt): Promise<UndoItem[]> {
  const out: UndoItem[] = [];
  for (const m of runtimes) {
    if (!m.play?.onLook) continue;
    try {
      out.push(...await m.play.onLook(plugin, party));
    } catch (e) {
      logError(`${m.id} party look`, e);
    }
  }
  return out;
}
