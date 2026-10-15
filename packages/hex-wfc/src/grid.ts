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

/**
 * Position of the hex centre in a plane where neighbouring centres are
 * √3 apart (unit hex size). Used for shape measurements, not drawing.
 */
export function hexCenter(x: number, y: number, orientation: Orientation, stagger: Stagger = "odd"): [number, number] {
  const isShifted = (n: number) => (stagger === "odd" ? n % 2 !== 0 : n % 2 === 0);
  const r3 = Math.sqrt(3);
  return orientation === "flat"
    ? [x * 1.5, y * r3 + (isShifted(x) ? r3 / 2 : 0)]
    : [x * r3 + (isShifted(y) ? r3 / 2 : 0), y * 1.5];
}

/**
 * Neighbour indices (into the hexNeighbors() result) in clockwise ring
 * order. The index → compass direction mapping is the same for shifted and
 * unshifted hexes, so a heading can be kept as an index into this ring.
 */
export function directionRing(orientation: Orientation): number[] {
  // flat: 0 N, 2 NE, 3 SE, 1 S, 5 SW, 4 NW; pointy: 0 E, 5 SE, 4 SW, 1 W, 2 NW, 3 NE
  return orientation === "flat" ? [0, 2, 3, 1, 5, 4] : [0, 5, 4, 1, 2, 3];
}

/** Offset coords → axial (q, r), matching hexNeighbors' stagger rules. */
export function toAxial(x: number, y: number, orientation: Orientation, stagger: Stagger = "odd"): [number, number] {
  // "odd": odd columns (flat) / rows (pointy) are shifted. x & 1 is 0/1 for negatives too.
  if (orientation === "flat") {
    const shift = stagger === "odd" ? (x - (x & 1)) / 2 : (x + (x & 1)) / 2;
    return [x, y - shift];
  }
  const shift = stagger === "odd" ? (y - (y & 1)) / 2 : (y + (y & 1)) / 2;
  return [x - shift, y];
}

/** Axial (q, r) → offset coords; the inverse of toAxial. */
export function fromAxial(q: number, r: number, orientation: Orientation, stagger: Stagger = "odd"): [number, number] {
  if (orientation === "flat") {
    const shift = stagger === "odd" ? (q - (q & 1)) / 2 : (q + (q & 1)) / 2;
    return [q, r + shift];
  }
  const shift = stagger === "odd" ? (r - (r & 1)) / 2 : (r + (r & 1)) / 2;
  return [q + shift, r];
}

/** Number of steps between two hexes. */
export function hexDistance(
  a: [number, number],
  b: [number, number],
  orientation: Orientation,
  stagger: Stagger = "odd",
): number {
  const [q1, r1] = toAxial(a[0], a[1], orientation, stagger);
  const [q2, r2] = toAxial(b[0], b[1], orientation, stagger);
  const dq = q1 - q2, dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Accept either a Map or a plain object of "x_y" → terrain. */
export function toCellMap(cells: Map<string, string> | Record<string, string>): Map<string, string> {
  return cells instanceof Map ? cells : new Map(Object.entries(cells));
}
