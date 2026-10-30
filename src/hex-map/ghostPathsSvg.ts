/**
 * The neighbours' roads and rivers on the strip past a map's edges, drawn
 * read-only as one SVG (ghostPaths.ts says which stretches; HexMapView
 * measures where). In em: one user unit = 1em of the grid, so it scales
 * with zoom like the strip's hexes. A dot marks where a path ends.
 */

import type { PathType } from "../types";
import { smoothPath } from "./hexGeometry";

type P = { cx: number; cy: number };

export interface GhostLine {
  /** The neighbour map it belongs to. */
  map: string;
  pt: Pick<PathType, "color" | "width" | "lineStyle">;
  pts: P[];
  /** Where it really ends (a dot each). */
  ends: P[];
}

const DASH: Record<string, number[]> = { dashed: [8, 4], dotted: [2, 4] };

/** Append the SVG to `layer` (nothing when there's nothing to draw). */
export function drawGhostPaths(layer: HTMLElement, lines: readonly GhostLine[], gridWEm: number, gridHEm: number, em: number): void {
  if (!lines.length || gridWEm <= 0 || gridHEm <= 0) return;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = activeDocument.createElementNS(svgNS, "svg");
  svg.classList.add("duckmage-region-shadow-paths");
  svg.setAttribute("viewBox", `0 0 ${gridWEm} ${gridHEm}`);
  svg.setAttribute("preserveAspectRatio", "none");
  for (const { map, pt, pts, ends } of lines) {
    const path = activeDocument.createElementNS(svgNS, "path");
    path.setAttribute("d", smoothPath(pts));
    path.setAttribute("stroke", pt.color);
    path.setAttribute("stroke-width", String(pt.width / em));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("fill", "none");
    const dash = DASH[pt.lineStyle];
    if (dash) path.setAttribute("stroke-dasharray", dash.map((d) => d / em).join(" "));
    path.setAttribute("data-region", map);
    svg.appendChild(path);
    for (const end of ends) {
      const dot = activeDocument.createElementNS(svgNS, "circle");
      dot.setAttribute("class", "duckmage-region-shadow-path-end");
      dot.setAttribute("cx", String(end.cx));
      dot.setAttribute("cy", String(end.cy));
      dot.setAttribute("r", String(Math.max(3, pt.width * 0.9) / em));
      dot.setAttribute("fill", pt.color);
      svg.appendChild(dot);
    }
  }
  layer.appendChild(svg);
}
