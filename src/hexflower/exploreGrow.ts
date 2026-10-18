/**
 * The map grows as the party nears its edge (owner HF4, plan-hf4-map-grows):
 * after a step (or the party's Reveal), every hex within sight + 1 of the
 * party (what it sees, and the "?" ring beyond) must be on the map. A side
 * that is short grows by enough for sight + 3, a few rows at a time, so
 * the map isn't redrawn on every step.
 *
 * Blank hexes only: growing writes no cells and no hex notes. Explored maps
 * only, unless the map's `explore-grow: off`; never on a map with
 * neighbouring regions (they all share one size), and never past the
 * biggest map (MAX_GRID_SIDE a side, owner C2: it stops there, said once a
 * session). The growth is one undo entry ("grid"), in the step's group.
 */
import { Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { UndoItem } from "../hex-map/undoItems";
import { applyGridChange } from "../hex-map/gridChange";
import { capGrowth, describeGrowth, gridBoxOf, grownGrid, growthFor, hasRoom } from "../maps/gridGrowth";
import { MAX_GRID_SIDE } from "../sizeInput";
import { canDo } from "../modeGate";
import type { ExploreMap } from "./exploreFields";

/** Hexes beyond sight that must be on the map (the "?" ring). */
export const GROW_NEED = 1;
/** Room a side is given when it grows, beyond sight. */
export const GROW_ROOM = 3;

/** Is growing turned off on this map (`explore-grow: off`)? */
export function growOff(map: ExploreMap): boolean {
  return /^(off|no|false|0)$/i.test(String(map.exploreGrow ?? "").trim());
}

/** Maps told this session that they can't grow (once each). */
const told = new Set<string>();
/** Maps told this session that they're at the biggest size (once each). */
const toldMax = new Set<string>();

export const AT_MAX_SIZE = "This map is at the largest size; it won't grow further.";

/**
 * Make room around `hex` for a party that sees `sight` rings. Returns the
 * undo entry and the notice line, or undefined when nothing grew.
 */
export function makeRoom(
  plugin: Pick<HexmakerPlugin, "settings" | "getMap" | "saveSettings">,
  map: ExploreMap,
  hex: string,
  sight: number,
  tell: (text: string) => void = (t) => new Notice(t),
): { undo: UndoItem; line: string } | undefined {
  if (growOff(map) || !canDo(map.name, "grow-while-exploring")) return undefined;
  const stagger = map.staggerOffset ?? plugin.settings.staggerOffset ?? "odd";
  const before = gridBoxOf(map);
  const room = growthFor(before, hex, sight + GROW_NEED, sight + GROW_ROOM, plugin.settings.hexOrientation, stagger);
  if (hasRoom(room)) return undefined;
  if (map.world) {
    if (!told.has(map.name)) {
      told.add(map.name);
      tell("This map has neighbouring regions, so it can't grow.");
    }
    return undefined;
  }
  const capped = capGrowth(before, room, MAX_GRID_SIDE);
  if (capped.cut && !toldMax.has(map.name)) {
    toldMax.add(map.name);
    tell(AT_MAX_SIZE);
  }
  if (hasRoom(capped.room)) return undefined;
  const after = grownGrid(before, capped.room);
  if (!applyGridChange(plugin, map.name, after)) return undefined;
  return { undo: { kind: "grid", mapName: map.name, before, after }, line: describeGrowth(capped.room) };
}
