/**
 * Hex keys: the `"x_y"` string (offset coordinates) that names a hex in
 * map data, path chains, hex note file names and every Map/Set keyed by
 * hex. Pure; no obsidian.
 *
 * Malformed keys (characterised from the `key.split("_").map(Number)`
 * call sites this replaced): `hexXY` / `hexPair` never throw. Each part
 * goes through `Number`, so a non-numeric part is NaN, a missing `y`
 * (no `_`) is NaN, extra `_parts` are ignored ("1_2_3" → 1, 2), and an
 * empty part is 0 (`Number("")`, so "_4" → 0, 4). The old sites gave
 * `undefined` rather than NaN for a missing `y`; every adopted site only
 * does arithmetic, comparisons or lookups with it, where the two behave
 * the same. Use `strictHexXY` / `isHexKey` where a bad key must be told
 * apart (file names, user text).
 */
import type { HexKey } from "./types";
import { hexNeighbors } from "./hex-map/hexGeometry";

/** The key for hex (x, y): `hexKey(3, -4)` → `"3_-4"`. */
export function hexKey(x: number, y: number): HexKey {
  return `${x}_${y}`;
}

/** The coordinates in a key, leniently (see the file comment for bad keys). */
export function hexXY(key: HexKey): { x: number; y: number } {
  const [x, y] = hexPair(key);
  return { x, y };
}

/** `hexXY` as an `[x, y]` pair, for destructuring and coordinate lists. */
export function hexPair(key: HexKey): [number, number] {
  const parts = key.split("_");
  return [Number(parts[0]), Number(parts[1])];
}

/** Sort keys by row then column, like reading a map. */
export function compareHexKeys(a: HexKey, b: HexKey): number {
  const [ax, ay] = hexPair(a);
  const [bx, by] = hexPair(b);
  return ay - by || ax - bx;
}

const STRICT = /^(-?\d+)_(-?\d+)$/;

/** Is `s` exactly a hex key (integers, optional minus, one `_`)? */
export function isHexKey(s: string): boolean {
  return STRICT.test(s);
}

/** The coordinates of an exact hex key, or null for anything else (no trimming). */
export function strictHexXY(s: string): { x: number; y: number } | null {
  const m = STRICT.exec(s);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/** The keys of the hexes around `key` on a grid of this orientation and stagger. */
export function neighbourKeys(
  key: HexKey,
  orientation: "flat" | "pointy",
  stagger: "odd" | "even" = "odd",
): HexKey[] {
  const [x, y] = hexPair(key);
  return hexNeighbors(x, y, orientation, stagger).map(([nx, ny]) => hexKey(nx, ny));
}

/** Is hex `b` next to hex `a`? */
export function areNeighbours(
  a: HexKey,
  b: HexKey,
  orientation: "flat" | "pointy",
  stagger: "odd" | "even" = "odd",
): boolean {
  return neighbourKeys(a, orientation, stagger).includes(b);
}
