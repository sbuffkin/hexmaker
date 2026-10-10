/**
 * Pure hex-geometry and path-math functions — no Obsidian or DOM dependencies.
 * Extracted from HexMapView.ts so the rendering class stays focused on UI.
 */

type Pt = { cx: number; cy: number };

const SQRT3 = Math.sqrt(3);

// ── Hex sizing ────────────────────────────────────────────────────────────────

/**
 * Compute the (width, height) of a single hex of the given radius and orientation.
 * Radius = distance from hex centre to any vertex.
 *
 * - Flat-top  hex:  width = 2R,         height = √3·R
 * - Pointy-top hex: width = √3·R,       height = 2R
 */
export function hexSize(
  hexRadius: number,
  orientation: "flat" | "pointy",
): { w: number; h: number } {
  return orientation === "flat"
    ? { w: 2 * hexRadius, h: SQRT3 * hexRadius }
    : { w: SQRT3 * hexRadius, h: 2 * hexRadius };
}

/**
 * Centre pixel of the hex at grid (col, row) when the grid's top-left corner is
 * pinned to (0, 0). Caller should add any padding by translating the result.
 *
 * - Flat-top:  column spacing = 1.5R,    row spacing = √3·R.  Shifted columns
 *              push the cell DOWN by half a hex height.
 * - Pointy-top: row spacing = 1.5R,      column spacing = √3·R.  Shifted rows
 *              push the cell RIGHT by half a hex width.
 *
 * `staggerOffset` controls which parity is the shifted one — "odd" (default)
 * means odd columns/rows are shifted; "even" inverts.
 */
export function hexCenter(
  col: number,
  row: number,
  orientation: "flat" | "pointy",
  hexRadius: number,
  staggerOffset: "odd" | "even" = "odd",
): Pt {
  const { w, h } = hexSize(hexRadius, orientation);
  const isShifted = (n: number) =>
    staggerOffset === "odd" ? n % 2 !== 0 : n % 2 === 0;

  if (orientation === "flat") {
    const cx = hexRadius + col * 1.5 * hexRadius;
    const cy = h / 2 + row * h + (isShifted(col) ? h / 2 : 0);
    return { cx, cy };
  }
  const cy = hexRadius + row * 1.5 * hexRadius;
  const cx = w / 2 + col * w + (isShifted(row) ? w / 2 : 0);
  return { cx, cy };
}

/**
 * The six vertices of a hex centred at (cx, cy), in clockwise order starting
 * from the rightmost vertex for flat-top (or upper-right for pointy-top).
 */
export function hexPolygonPoints(
  cx: number,
  cy: number,
  orientation: "flat" | "pointy",
  hexRadius: number,
): { x: number; y: number }[] {
  const vStart = orientation === "flat" ? 0 : Math.PI / 6;
  return Array.from({ length: 6 }, (_, i) => {
    const a = vStart + (i * Math.PI) / 3;
    return {
      x: cx + hexRadius * Math.cos(a),
      y: cy + hexRadius * Math.sin(a),
    };
  });
}

/**
 * Compute the pixel bounding box for an entire grid of hexes. Useful for
 * sizing a canvas to fit all hexes plus optional padding.
 */
export function gridBoundingBox(
  cols: number,
  rows: number,
  orientation: "flat" | "pointy",
  hexRadius: number,
  staggerOffset: "odd" | "even" = "odd",
): { width: number; height: number } {
  // Walk the four corners + one staggered cell to find the extent.
  // Cheaper than checking every cell since the grid is regular.
  let maxRight = 0;
  let maxBottom = 0;
  const check = (col: number, row: number) => {
    const c = hexCenter(col, row, orientation, hexRadius, staggerOffset);
    if (c.cx + hexRadius > maxRight) maxRight = c.cx + hexRadius;
    if (c.cy + hexRadius > maxBottom) maxBottom = c.cy + hexRadius;
  };
  check(cols - 1, rows - 1);
  // Also check the staggered-row/col extreme cell, which may protrude further.
  if (cols > 0 && rows > 0) {
    check(cols - 1, rows - 2 >= 0 ? rows - 2 : 0);
    check(cols - 2 >= 0 ? cols - 2 : 0, rows - 1);
  }
  return { width: Math.ceil(maxRight), height: Math.ceil(maxBottom) };
}

// ── Neighbor calculation ──────────────────────────────────────────────────────

export function hexNeighbors(
  x: number,
  y: number,
  orientation: "flat" | "pointy",
  staggerOffset: "odd" | "even" = "odd",
): [number, number][] {
  // isShifted = true when the hex sits on the staggered (shifted) row/col.
  // Default "odd" stagger means odd cols (flat-top) or odd rows (pointy-top) are shifted.
  const isShifted = (n: number) =>
    staggerOffset === "odd" ? n % 2 !== 0 : n % 2 === 0;

  if (orientation === "flat") {
    return !isShifted(x)
      ? [
          [x, y - 1],
          [x, y + 1],
          [x + 1, y - 1],
          [x + 1, y],
          [x - 1, y - 1],
          [x - 1, y],
        ]
      : [
          [x, y - 1],
          [x, y + 1],
          [x + 1, y],
          [x + 1, y + 1],
          [x - 1, y],
          [x - 1, y + 1],
        ];
  }
  return !isShifted(y)
    ? [
        [x + 1, y],
        [x - 1, y],
        [x - 1, y - 1],
        [x, y - 1],
        [x - 1, y + 1],
        [x, y + 1],
      ]
    : [
        [x + 1, y],
        [x - 1, y],
        [x, y - 1],
        [x + 1, y - 1],
        [x, y + 1],
        [x + 1, y + 1],
      ];
}

// ── SVG path builders ─────────────────────────────────────────────────────────

/** Smooth bezier path through an ordered list of points — corners rounded via midpoints. */
export function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) {
    return `M ${pts[0].cx} ${pts[0].cy} L ${pts[1].cx} ${pts[1].cy}`;
  }
  const mx = (a: Pt, b: Pt) => (a.cx + b.cx) / 2;
  const my = (a: Pt, b: Pt) => (a.cy + b.cy) / 2;
  let d = `M ${pts[0].cx} ${pts[0].cy}`;
  d += ` L ${mx(pts[0], pts[1])} ${my(pts[0], pts[1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    d += ` Q ${pts[i].cx} ${pts[i].cy} ${mx(pts[i], pts[i + 1])} ${my(pts[i], pts[i + 1])}`;
  }
  d += ` L ${pts[pts.length - 1].cx} ${pts[pts.length - 1].cy}`;
  return d;
}

/** Sharp polyline path (straight segments between each point). */
export function sharpPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  return "M " + pts.map((p) => `${p.cx} ${p.cy}`).join(" L ");
}

/**
 * Shift every point of a polyline perpendicular to its local tangent by
 * `offset` pixels, producing a curve parallel to the original. Used to render
 * path chains that share the same hexes (e.g. a road and a river on one route)
 * side by side instead of one stroke covering the other.
 *
 * The perpendicular is canonicalised per geometric tangent (independent of the
 * direction the chain's points were stored in), so two chains tracing the same
 * route in opposite orders still separate onto opposite sides rather than
 * landing on top of each other. `offset === 0` returns the input unchanged so
 * non-overlapping paths render pixel-identically to before.
 */
export function offsetPolyline(pts: Pt[], offset: number): Pt[] {
  if (offset === 0 || pts.length < 2) return pts;
  return pts.map((p, i) => {
    const prev = pts[i === 0 ? 0 : i - 1];
    const next = pts[i === pts.length - 1 ? i : i + 1];
    let tx = next.cx - prev.cx;
    let ty = next.cy - prev.cy;
    const len = Math.hypot(tx, ty);
    if (len === 0) return p;
    tx /= len;
    ty /= len;
    // Canonicalise tangent direction so the perpendicular at a given point on
    // the route is the same no matter which way the chain runs.
    if (tx < -1e-9 || (Math.abs(tx) <= 1e-9 && ty < 0)) {
      tx = -tx;
      ty = -ty;
    }
    // Perpendicular = tangent rotated 90°: (-ty, tx).
    return { cx: p.cx + -ty * offset, cy: p.cy + tx * offset };
  });
}

/**
 * Assign each path chain a perpendicular "lane" offset (in pixels) so chains of
 * *different* types that share a route render side by side rather than one
 * stroke covering the other (issue #30).
 *
 * Two chains are considered to share a route when they share at least one
 * *segment* — an unordered pair of adjacent hexes — not merely a single hex, so
 * paths that only cross at one cell are left untouched. Chains linked through
 * shared segments are grouped (transitively, via union-find).
 *
 * Within a group, lanes are assigned **per distinct path type**, not per chain:
 * chains of the *same* type share a lane (offset) so overlaid same-type paths
 * (e.g. two rivers tracing one route) merge into a single stroke, while
 * different types fan out into separate lanes. A group containing only one type
 * gets no offset. Lanes are centred on zero: `(lane - (T-1)/2) * gap` for T
 * distinct types, where `gap` is the widest stroke in the group plus a small
 * margin. A chain sharing no segment with any other keeps offset 0, so the
 * common single-path case renders pixel-identically to before. `chains` order
 * is the draw order and decides lane order (earlier type → more negative).
 */
export function computeLaneOffsets(
  chains: { hexes: string[]; width: number; typeName: string }[],
): number[] {
  const n = chains.length;
  const offsets = new Array<number>(n).fill(0);
  if (n < 2) return offsets;

  // Canonical (direction-independent) segment keys for each chain.
  const segSets = chains.map((c) => {
    const s = new Set<string>();
    for (let i = 0; i < c.hexes.length - 1; i++) {
      const a = c.hexes[i];
      const b = c.hexes[i + 1];
      s.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
    return s;
  });

  // Union-find: group chains that share ≥1 segment.
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const segOwner = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    for (const seg of segSets[i]) {
      const owner = segOwner.get(seg);
      if (owner === undefined) segOwner.set(seg, i);
      else union(owner, i);
    }
  }

  // Bucket by group root, preserving draw order within each group.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(i);
    else groups.set(root, [i]);
  }

  for (const members of groups.values()) {
    // Distinct types in this group, in first-seen (draw) order.
    const laneOfType = new Map<string, number>();
    for (const i of members) {
      if (!laneOfType.has(chains[i].typeName)) {
        laneOfType.set(chains[i].typeName, laneOfType.size);
      }
    }
    if (laneOfType.size < 2) continue; // single type → merge, no offset
    const maxWidth = Math.max(...members.map((i) => chains[i].width));
    const gap = maxWidth + 2;
    const mid = (laneOfType.size - 1) / 2;
    for (const i of members) {
      const lane = laneOfType.get(chains[i].typeName) ?? 0;
      offsets[i] = (lane - mid) * gap;
    }
  }

  return offsets;
}

// Chain polylines (through / meander / edge) live in src/paths/pathGeometry.ts,
// in lattice units, shared by the map view and the PNG export.
