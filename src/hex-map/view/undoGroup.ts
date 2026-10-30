/**
 * Undo entries made of other entries ("group": a party step and what it
 * filled, undone as one) and map setting changes ("map-field": a map-note
 * key). Split out of HexMapView's prepareUndo / applyUndo.
 */
import type HexmakerPlugin from "../../HexmakerPlugin";
import { sameValue, type UndoDirection } from "../../undoBook";
import type { UndoItem } from "../undoItems";

type Group = Extract<UndoItem, { kind: "group" }>;
type MapField = Extract<UndoItem, { kind: "map-field" }>;

/** The parts of a group still in place (each prepared on its own); null when none is. */
export async function prepareGroup(
  item: Group,
  dir: UndoDirection,
  prepare: (it: UndoItem, dir: UndoDirection) => Promise<UndoItem | null>,
): Promise<UndoItem | null> {
  const items: UndoItem[] = [];
  for (const it of item.items) {
    const ready = await prepare(it, dir);
    if (ready) items.push(ready);
  }
  return items.length ? { kind: "group", items } : null;
}

/** Apply a group: undo runs its parts last first, redo first first. */
export async function applyGroup(item: Group, dir: UndoDirection, apply: (it: UndoItem, dir: UndoDirection) => Promise<void>): Promise<void> {
  for (const it of dir === "undo" ? [...item.items].reverse() : item.items) await apply(it, dir);
}

/** A map setting change still in place (the map shows its "after" for undo, "before" for redo)? */
export function prepareMapField(plugin: Pick<HexmakerPlugin, "getMap">, item: MapField, dir: UndoDirection): MapField | null {
  const map = plugin.getMap(item.mapName) as unknown as Record<string, unknown> | undefined;
  if (!map) return null;
  return sameValue(map[item.field], dir === "undo" ? item.after : item.before) ? item : null;
}

/** Set the map setting back (undo) or again (redo), and save. */
export function applyMapField(plugin: Pick<HexmakerPlugin, "getMap" | "saveSettings">, item: MapField, dir: UndoDirection): void {
  const map = plugin.getMap(item.mapName) as unknown as Record<string, unknown> | undefined;
  if (!map) return;
  const v = dir === "undo" ? item.before : item.after;
  if (v === undefined) delete map[item.field];
  else map[item.field] = v;
  void plugin.saveSettings();
}
