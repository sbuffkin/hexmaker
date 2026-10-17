/**
 * Changing a map's grid size from code (plan-hf4-map-grows): a map that
 * grows as the party nears its edge, and undoing / redoing that ("grid"
 * undo entries). Growth writes no cells and no hex notes, so undoing it
 * takes the rows back only while every hex in them is still blank: no map
 * data, no hex note, no token. Otherwise the rows stay.
 *
 * The map view keeps what's on screen still afterwards (view/gridResize.ts).
 */
import { TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { bandKeys, gridBoxOf, sameGrid, type GridBox } from "../maps/gridGrowth";
import { getTokenDataFromCache } from "../tokens/tokenNotes";
import type { UndoDirection } from "../undoBook";
import type { UndoItem } from "./undoItems";
import { hexPair } from "../hexKey";

type GridItem = Extract<UndoItem, { kind: "grid" }>;
export type GridChangeHost = Pick<HexmakerPlugin, "app" | "getMap" | "saveSettings" | "mapStore" | "hexPath">;

/** Set map `mapName`'s grid to `next` and save it (false: no such map). */
export function applyGridChange(plugin: Pick<HexmakerPlugin, "getMap" | "saveSettings">, mapName: string, next: GridBox): boolean {
  const map = plugin.getMap(mapName);
  if (!map) return false;
  map.gridOffset = { x: next.x, y: next.y };
  map.gridSize = { cols: next.cols, rows: next.rows };
  void plugin.saveSettings();
  return true;
}

/** Are the hexes of `bigger` outside `smaller` all blank (no map data, hex note or token)? */
export function bandIsBlank(plugin: GridChangeHost, mapName: string, bigger: GridBox, smaller: GridBox): boolean {
  const band = bandKeys(bigger, smaller);
  if (!band.length) return true;
  const keys = new Set(band);
  for (const k of band) {
    const h = plugin.mapStore.get(mapName, k);
    if (h && Object.keys(h).length) return false;
    const [x, y] = hexPair(k);
    if (plugin.app.vault.getAbstractFileByPath(plugin.hexPath(x, y, mapName)) instanceof TFile) return false;
  }
  for (const file of plugin.app.vault.getMarkdownFiles()) {
    const t = getTokenDataFromCache(plugin.app, file);
    if (t && t.map === mapName && keys.has(t.hex)) return false;
  }
  return true;
}

/** A grid change still in place (the map shows its "after" for undo, "before" for redo)? */
export function prepareGrid(plugin: Pick<HexmakerPlugin, "getMap">, item: GridItem, dir: UndoDirection): GridItem | null {
  const map = plugin.getMap(item.mapName);
  if (!map) return null;
  return sameGrid(gridBoxOf(map), dir === "undo" ? item.after : item.before) ? item : null;
}

/**
 * Undo (back to "before") or redo (to "after") a grid change. Checked when
 * applied, not when prepared: a step's group undoes its fills first, so
 * the band is blank again by the time the rows go. Rows with content since
 * stay. Returns whether the grid changed.
 */
export function applyGridUndo(plugin: GridChangeHost, item: GridItem, dir: UndoDirection): boolean {
  const map = plugin.getMap(item.mapName);
  if (!map) return false;
  const now = gridBoxOf(map);
  const target = dir === "undo" ? item.before : item.after;
  if (sameGrid(now, target)) return false;
  if (!bandIsBlank(plugin, item.mapName, now, target)) return false;
  return applyGridChange(plugin, item.mapName, target);
}
