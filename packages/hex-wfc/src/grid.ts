/**
 * Offset-coordinate hex grid helpers.
 *
 * Flat-top grids stagger columns (odd-q / even-q); pointy-top grids stagger
 * rows (odd-r / even-r). "odd" means odd columns/rows are pushed down/right.
 */

export type Orientation = "flat" | "pointy";
export type Stagger = "odd" | "even";

export const cellKey = (x: number, y: number): string => `${x}_${y}`;

/** Parse an "x_y" key. Returns null for anything that isn't two integers. */
export function parseCellKey(key: string): [number, number] | null {
  const m = /^(-?\d+)_(-?\d+)$/.exec(key);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** The six neighbours of (x, y), in a fixed order. */
export function hexNeighbors(
  x: number,
  y: number,
  orientation: Orientation,
  stagger: Stagger = "odd",
): [number, number][] {
  const isShifted = (n: number) => (stagger === "odd" ? n % 2 !== 0 : n % 2 === 0);

  if (orientation === "flat") {
    return !isShifted(x)
      ? [[x, y - 1], [x, y + 1], [x + 1, y - 1], [x + 1, y], [x - 1, y - 1], [x - 1, y]]
      : [[x, y - 1], [x, y + 1], [x + 1, y], [x + 1, y + 1], [x - 1, y], [x - 1, y + 1]];
  }
  return !isShifted(y)
    ? [[x + 1, y], [x - 1, y], [x - 1, y - 1], [x, y - 1], [x - 1, y + 1], [x, y + 1]]
    : [[x + 1, y], [x - 1, y], [x, y - 1], [x + 1, y - 1], [x, y + 1], [x + 1, y + 1]];
}

/** Accept either a Map or a plain object of "x_y" → terrain. */
export function toCellMap(cells: Map<string, string> | Record<string, string>): Map<string, string> {
  return cells instanceof Map ? cells : new Map(Object.entries(cells));
}
