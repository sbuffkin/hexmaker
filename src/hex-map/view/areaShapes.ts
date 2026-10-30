/**
 * Area outlines (L2e): the faction and region overlays' shared drawing,
 * one filled, outlined blob per area (hexes grouped by area name), merged
 * across shared hex edges and split into islands.
 *
 * Read-then-write (CLAUDE.md): every hex centre is measured first, then
 * the SVG is built detached; the caller inserts it.
 */
import type { OverlayStyle } from "../../frontmatter";
import { buildSvgPattern, colorToIdToken, type OverlayPatternKey } from "../../overlayPatterns";

type Pt = [number, number];

/** An area drawn: its colour and style, and the centres of its hexes (grid px). */
export interface DrawnArea {
  name: string;
  color: string;
  style: OverlayStyle;
  centers: { cx: number; cy: number }[];
}

export interface AreaSvgOpts {
  /** The SVG's class. */
  svgClass: string;
  /** Extra width/height past the grid, px. */
  pad: number;
  /** Pattern id prefix (ids are unique per overlay). */
  patternPrefix: string;
  flat: boolean;
}

const DEFAULT_STYLE: OverlayStyle = { pattern: "solid", scale: 16, opacity: 0.45, outlineWidth: 1.5 };

/**
 * Build the overlay SVG for `areas` (area name → hex keys "x_y"), coloured by
 * `colorOf` (an area with no colour is skipped). Null when nothing is drawn.
 */
export function buildAreaSvg(
  gridContainer: HTMLElement,
  hexEls: HTMLElement[],
  areas: Map<string, string[]>,
  colorOf: (name: string) => { color: string; style?: OverlayStyle } | undefined,
  opts: AreaSvgOpts,
): { svg: SVGSVGElement; drawn: DrawnArea[] } | null {
  // ── Build center map (reads only) ─────────────────────────────────────────
  let hexW = 0, hexH = 0, gapPx = 0;
  const centerMap = new Map<string, { cx: number; cy: number }>();
  for (const hexEl of hexEls) {
    if (hexW === 0) {
      hexW = hexEl.offsetWidth;
      hexH = hexEl.offsetHeight;
      gapPx = parseFloat(window.getComputedStyle(hexEl).marginTop) || 0;
    }
    let ox = hexEl.offsetWidth / 2, oy = hexEl.offsetHeight / 2;
    let cur: HTMLElement | null = hexEl;
    // Walk to gridContainer (NOT viewportEl) so overlay coords are
    // gridContainer-relative — the SVG is appended inside gridContainer
    // so it inherits any gridDisplay transform.
    while (cur && cur !== gridContainer) {
      ox += cur.offsetLeft;
      oy += cur.offsetTop;
      cur = cur.offsetParent as HTMLElement | null;
    }
    centerMap.set(`${hexEl.dataset.x}_${hexEl.dataset.y}`, { cx: ox, cy: oy });
  }

  // ── SVG setup ─────────────────────────────────────────────────────────────
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = activeDocument.createElementNS(svgNS, "svg");
  svg.classList.add(opts.svgClass);
  const w = gridContainer.offsetLeft + gridContainer.offsetWidth + opts.pad;
  const h = gridContainer.offsetTop + gridContainer.offsetHeight + opts.pad;
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));

  const isFlat = opts.flat;
  const W = hexW, H = hexH;
  const r = isFlat ? W / 2 : H / 2;
  // Expanded vertices: adjacent same-area hexes' shared vertices coincide exactly
  const scale = r > 0 ? (r + gapPx) / r : 1;

  const hexVerts = (cx: number, cy: number): Pt[] => {
    const pts = isFlat
      ? [ [-W/4, -H/2], [W/4, -H/2], [W/2, 0], [W/4, H/2], [-W/4, H/2], [-W/2, 0] ]
      : [ [0, -H/2], [W/2, -H/4], [W/2, H/4], [0, H/2], [-W/2, H/4], [-W/2, -H/4] ];
    return pts.map(([dx, dy]) => [cx + dx * scale, cy + dy * scale]);
  };

  const vk = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const ek = (v1: Pt, v2: Pt) => {
    const k1 = vk(v1[0], v1[1]), k2 = vk(v2[0], v2[1]);
    return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
  };

  const drawn: DrawnArea[] = [];

  // ── Shared <defs> for SVG patterns (deduped by key|color|scale) ───────────
  const defsEl = activeDocument.createElementNS(svgNS, "defs");
  svg.appendChild(defsEl);
  const patternIds = new Map<string, string>();
  const ensurePattern = (key: OverlayPatternKey, color: string, scale: number): string | null => {
    if (key === "solid") return null;
    const cacheKey = `${key}|${color}|${scale}`;
    const cached = patternIds.get(cacheKey);
    if (cached) return cached;
    const id = `${opts.patternPrefix}-${key}-${colorToIdToken(color)}-${scale}`;
    const el = buildSvgPattern(activeDocument, { id, pattern: key, color, scale });
    if (!el) return null;
    defsEl.appendChild(el);
    patternIds.set(cacheKey, id);
    return id;
  };

  for (const [name, hexKeys] of areas) {
    const look = colorOf(name);
    if (!look) continue;
    const color = look.color;
    const style = look.style ?? DEFAULT_STYLE;
    const patternId = ensurePattern(style.pattern, color, style.scale);
    const fillVal = patternId ? `url(#${patternId})` : color;

    // ── Edge counting ─────────────────────────────────────────────────────
    type EdgeEntry = { v1: Pt; v2: Pt; count: number };
    const edgeCounts = new Map<string, EdgeEntry>();
    const centers: { cx: number; cy: number }[] = [];

    for (const key of hexKeys) {
      const pos = centerMap.get(key);
      if (!pos) continue;
      centers.push(pos);
      const verts = hexVerts(pos.cx, pos.cy);
      for (let i = 0; i < 6; i++) {
        const v1 = verts[i], v2 = verts[(i + 1) % 6];
        const k = ek(v1, v2);
        const ex = edgeCounts.get(k);
        if (ex) { ex.count++; } else { edgeCounts.set(k, { v1, v2, count: 1 }); }
      }
    }

    // ── Build vertex adjacency from boundary edges ─────────────────────────
    const coordOf = new Map<string, Pt>();
    type AdjEntry = { key: string; coord: Pt; edgeKey: string };
    const vertAdj = new Map<string, AdjEntry[]>();

    for (const { v1, v2, count } of edgeCounts.values()) {
      if (count !== 1) continue;
      const k1 = vk(v1[0], v1[1]), k2 = vk(v2[0], v2[1]);
      const edgeKey = ek(v1, v2);
      coordOf.set(k1, v1); coordOf.set(k2, v2);
      if (!vertAdj.has(k1)) vertAdj.set(k1, []);
      if (!vertAdj.has(k2)) vertAdj.set(k2, []);
      vertAdj.get(k1)!.push({ key: k2, coord: v2, edgeKey });
      vertAdj.get(k2)!.push({ key: k1, coord: v1, edgeKey });
    }

    if (coordOf.size === 0) continue;

    // ── Walk all closed rings (handles disconnected islands) ──────────────
    const usedEdges = new Set<string>();
    const rings: Pt[][] = [];

    for (const { v1, v2, count } of edgeCounts.values()) {
      if (count !== 1) continue;
      const initKey = ek(v1, v2);
      if (usedEdges.has(initKey)) continue;

      usedEdges.add(initKey);
      const ring: Pt[] = [v1, v2];
      const startK = vk(v1[0], v1[1]);
      let curK = vk(v2[0], v2[1]);

      let safety = 0;
      while (curK !== startK && safety++ < 10_000) {
        const next = (vertAdj.get(curK) ?? []).find(
          (e) => !usedEdges.has(e.edgeKey),
        );
        if (!next) break;
        usedEdges.add(next.edgeKey);
        if (next.key === startK) break;
        ring.push(next.coord);
        curK = next.key;
      }

      if (ring.length >= 3) rings.push(ring);
    }

    if (rings.length === 0) continue;

    // ── Render filled blob(s) ─────────────────────────────────────────────
    const g = activeDocument.createElementNS(svgNS, "g");
    g.setAttribute("opacity", String(style.opacity));
    svg.appendChild(g);

    for (const ring of rings) {
      const d =
        ring
          .map(
            (c, i) =>
              `${i === 0 ? "M" : "L"}${c[0].toFixed(1)},${c[1].toFixed(1)}`,
          )
          .join(" ") + " Z";
      const path = activeDocument.createElementNS(svgNS, "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", fillVal);
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", String(style.outlineWidth));
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("paint-order", "stroke fill");
      g.appendChild(path);
    }

    drawn.push({ name, color, style, centers });
  }

  return drawn.length ? { svg, drawn } : null;
}

/** An area name's angle (deg, within ±90) along its hexes' main axis (PCA), and its centre. */
export function areaLabelPlacement(centers: { cx: number; cy: number }[]): { mx: number; my: number; angle: number } {
  const n = centers.length;
  const mx = centers.reduce((s, p) => s + p.cx, 0) / n;
  const my = centers.reduce((s, p) => s + p.cy, 0) / n;
  let angle = 0;
  if (n > 1) {
    const sxx = centers.reduce((s, p) => s + (p.cx - mx) ** 2, 0);
    const syy = centers.reduce((s, p) => s + (p.cy - my) ** 2, 0);
    const sxy = centers.reduce((s, p) => s + (p.cx - mx) * (p.cy - my), 0);
    let ang = (Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI / 2;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    angle = ang;
  }
  return { mx, my, angle };
}
