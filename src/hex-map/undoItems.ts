/**
 * What the map's undo queues hold (src/undoBook.ts: one queue per map per
 * work mode). Each entry knows its "after" state, so an entry whose target
 * changed since in another mode can be skipped instead of reverting the
 * newer change (HexMapView.prepareUndo).
 */
import type { PinRecord } from "../paths/routePins";
import type { MapPath, TokenShape, TokenSize } from "../types";
import type { HexData } from "../maps/mapNote";
import type { CellEdit } from "../undoBook";
import type { ProjectionUndo } from "../overworld/overworldPaths";

export type TerrainUndoEntry = {
  x: number;
  y: number;
  path: string;
  oldTerrain: string | null;
  newTerrain: string | null;
};
export type IconUndoEntry = {
  x: number;
  y: number;
  path: string;
  oldIcon: string | null;
  newIcon: string | null;
  isGm: boolean;
  /** Full GM-icon list before/after the stroke. Only populated when
   *  isGm=true and the new painter (multi-add) path mutated this hex.
   *  Undo restores the full list; legacy oldIcon/newIcon kept for
   *  back-compat with strokes recorded before the multi-add change. */
  oldGmList?: string[];
  newGmList?: string[];
};
export type FactionUndoEntry = {
  hexPath: string;
  factionBasename: string;
  factionFilePath: string;
  /** Whether the faction link was present before this stroke began. */
  wasPresent: boolean;
};
export type RegionUndoEntry = {
  hexPath: string;
  oldRegion: string | null;
  newRegion: string | null;
};
/** A sub-hex painted in an overworld's full view: a hex of a region map. */
export type SubHexUndoEntry = {
  map: string;
  key: string;
  oldTerrain: string | null;
  oldLocked: boolean;
  newTerrain: string | null;
};
export interface CalibrateSnapshot {
  bg?: { offsetX: number; offsetY: number; scale: number; rotation: number; opacity: number };
  grid: { scaleX: number; scaleY: number; offsetX: number; offsetY: number; legacyScale: number };
}

/** A token's place on the map, and (for one that was made or removed) its look. */
export interface TokenSnap {
  hex: string;
  map: string;
  visible?: boolean;
  look?: {
    icon?: string;
    shape?: TokenShape;
    size?: TokenSize;
    color?: string;
    border?: string;
    tokenLink?: string;
    description?: string;
  };
}

export type UndoItem =
  /** `pins`: anchors the stroke made paths gain to keep their routes (undone with it). */
  | { kind: "terrain"; entries: TerrainUndoEntry[]; pins?: PinRecord[] }
  | { kind: "icon"; entries: IconUndoEntry[] }
  | { kind: "faction"; entries: FactionUndoEntry[] }
  | { kind: "region"; entries: RegionUndoEntry[] }
  | { kind: "subhex"; entries: SubHexUndoEntry[] }
  /** `after`: the two hexes' map data after the swap (null: not checked). */
  | { kind: "swap"; x1: number; y1: number; x2: number; y2: number; after?: [HexData | null, HexData | null] }
  | { kind: "path"; mapName: string; before: MapPath[]; after: MapPath[] }
  | { kind: "calibrate"; mapName: string; before: CalibrateSnapshot; after: CalibrateSnapshot }
  /** Any map data edit recorded field by field (hex editor, biome and region actions). */
  | { kind: "cells"; edits: CellEdit[] }
  /** An overworld path confirmed into (or taken out of) its regions: paths of several maps and the terrain carved. */
  | ProjectionUndo
  /** A token moved, placed or removed (null: not a token on a map). */
  | { kind: "token"; path: string; before: TokenSnap | null; after: TokenSnap | null };
