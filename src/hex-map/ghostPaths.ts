/**
 * Neighbouring maps' roads and rivers in the dimmed "ghost strip" past this
 * map's edges. Round 4: the strip showed only terrain, so a tester lined up
 * a road with the neighbour's by eye and couldn't confirm the join from one
 * view. Pure: which stretches of each neighbour path fall in the strip, in
 * this map's coordinates; HexMapView draws them (read-only).
 */

/** A hex in the strip: this map's key "x_y" → which map and hex it really is. */
export interface ShadowRef {
  map: string;
  x: number;
  y: number;
}

export interface ChainLike {
  typeName: string;
  hexes: readonly string[];
}

export interface GhostRun {
  /** The neighbour map the path belongs to. */
  map: string;
  typeName: string;
  /**
   * Hex keys in THIS map's frame. When `stubStart`/`stubEnd` is set, the
   * first/last key is the next hex of the path beyond the strip (deeper in
   * the neighbour), so the line can be drawn heading that way: draw only
   * half of that last segment.
   */
  hexes: string[];
  stubStart: boolean;
  stubEnd: boolean;
}

const parse = (key: string): [number, number] => {
  const [x, y] = key.split("_").map(Number);
  return [x, y];
};

/**
 * The stretches of neighbouring maps' paths that cross the strip. A
 * neighbour's hexes map into this map's frame by a fixed offset (maps in a
 * world sit edge to edge on one grid), read off any strip hex of that map.
 */
export function ghostPathRuns(
  shadow: ReadonlyMap<string, ShadowRef>,
  chainsOf: (map: string) => readonly ChainLike[] | undefined,
): GhostRun[] {
  const offsets = new Map<string, { dx: number; dy: number }>();
  for (const [key, ref] of shadow) {
    if (offsets.has(ref.map)) continue;
    const [x, y] = parse(key);
    offsets.set(ref.map, { dx: x - ref.x, dy: y - ref.y });
  }

  const runs: GhostRun[] = [];
  for (const [map, { dx, dy }] of offsets) {
    const inStrip = (key: string) => shadow.get(key)?.map === map;
    for (const chain of chainsOf(map) ?? []) {
      const local = chain.hexes.map((k) => {
        const [x, y] = parse(k);
        return `${x + dx}_${y + dy}`;
      });
      let i = 0;
      while (i < local.length) {
        if (!inStrip(local[i])) {
          i++;
          continue;
        }
        let j = i;
        while (j + 1 < local.length && inStrip(local[j + 1])) j++;
        const stubStart = i > 0;
        const stubEnd = j < local.length - 1;
        const hexes = local.slice(stubStart ? i - 1 : i, stubEnd ? j + 2 : j + 1);
        if (hexes.length >= 2) runs.push({ map, typeName: chain.typeName, hexes, stubStart, stubEnd });
        i = j + 1;
      }
    }
  }
  return runs;
}

/** Polyline points for a run: hex centres, with a stub end cut to the
 *  midpoint toward the hex beyond the strip. */
export function ghostRunPoints<P extends { cx: number; cy: number }>(
  run: GhostRun,
  centre: (key: string) => P,
): { cx: number; cy: number }[] {
  const pts: { cx: number; cy: number }[] = run.hexes.map((k) => {
    const p = centre(k);
    return { cx: p.cx, cy: p.cy };
  });
  const mid = (a: { cx: number; cy: number }, b: { cx: number; cy: number }) => ({
    cx: (a.cx + b.cx) / 2,
    cy: (a.cy + b.cy) / 2,
  });
  if (run.stubStart && pts.length >= 2) pts[0] = mid(pts[0], pts[1]);
  if (run.stubEnd && pts.length >= 2) pts[pts.length - 1] = mid(pts[pts.length - 1], pts[pts.length - 2]);
  return pts;
}
