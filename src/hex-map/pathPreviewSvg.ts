import type { PathType } from "../types";

// ── Mini hex SVG preview for a path type ─────────────────────────────────────

export function buildPathPreviewSvg(pt: PathType): SVGElement {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = activeDocument.createElementNS(svgNS, "svg");
  svg.setAttribute("width", "36");
  svg.setAttribute("height", "36");
  svg.setAttribute("viewBox", "0 0 36 36");

  // Hex polygon: radius 14, center (18,18), starting at 0° (right vertex)
  // Vertices: V0(32,18) right, V1(25,30) lower-right, V2(11,30) lower-left,
  //           V3(4,18) left,   V4(11,6) upper-left,  V5(25,6) upper-right
  const r = 14;
  const cx = 18, cy = 18;
  const hexPts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    hexPts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  const hex = activeDocument.createElementNS(svgNS, "polygon");
  hex.setAttribute("points", hexPts.join(" "));
  hex.setAttribute("fill", "var(--background-secondary)");
  hex.setAttribute("stroke", "var(--background-modifier-border)");
  hex.setAttribute("stroke-width", "1");
  svg.appendChild(hex);

  // Path line — shape depends on routing mode
  const DASH_ARRAYS: Record<string, string> = { solid: "", dashed: "4 2", dotted: "1.5 2" };
  const strokeW = String(Math.max(1, Math.min(pt.width, 4)) * 0.6);
  const dash = DASH_ARRAYS[pt.lineStyle] ?? "";

  let pathD: string;
  if (pt.routing === "edge") {
    // One vertex per shared edge: enters from left, hugs the lower-left boundary vertex,
    // crosses to the lower-right boundary vertex, exits right — one corner per hex.
    pathD = "M 4 18 L 11 30 L 32 18";
  } else if (pt.routing === "meander") {
    // Gentle curve through the lower third of the hex
    pathD = "M 4 18 Q 18 26 32 18";
  } else {
    // "through": straight line through hex center
    pathD = "M 4 18 L 32 18";
  }

  const pathEl = activeDocument.createElementNS(svgNS, "path");
  pathEl.setAttribute("d", pathD);
  pathEl.setAttribute("stroke", pt.color);
  pathEl.setAttribute("stroke-width", strokeW);
  pathEl.setAttribute("stroke-linecap", "round");
  pathEl.setAttribute("stroke-linejoin", "round");
  pathEl.setAttribute("fill", "none");
  if (dash) pathEl.setAttribute("stroke-dasharray", dash);
  svg.appendChild(pathEl);

  return svg;
}

