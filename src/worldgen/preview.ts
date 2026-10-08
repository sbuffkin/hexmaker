/**
 * Small canvas preview of a generated map, drawn with the palette colours.
 * Used on the Generator and New map tabs before anything is written.
 */

import { hexCenter, cellKey } from "../../packages/hex-wfc/src";

/** Above this many hexes the preview waits for an explicit click. */
export const PREVIEW_AUTO_LIMIT = 4000;

/** Stable fallback colour for terrains missing from the palette. */
function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 45%, 55%)`;
}

export function drawPreview(
  canvas: HTMLCanvasElement,
  cells: Map<string, string>,
  grid: { cols: number; rows: number; offset: { x: number; y: number }; stagger: "odd" | "even" },
  orientation: "flat" | "pointy",
  colors: Map<string, string>,
  featureCells?: Set<string>,
  paths: { type: string; route?: string; hexes: string[] }[] = [],
  pathColors: Map<string, string> = new Map(),
  maxWidth = 420,
  /** Largest hex size in canvas pixels (keeps tiny maps from ballooning). */
  maxScale = 14,
  /** Route to emphasise (others are dimmed), e.g. while its table row is hovered. */
  highlightRoute?: string,
): void {
  const { cols, rows, offset, stagger } = grid;
  // Hex centres in unit space (neighbours √3 apart, circumradius 1).
  const pts: [string, number, number][] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = offset.x + i, y = offset.y + j;
      const [px, py] = hexCenter(x, y, orientation, stagger);
      pts.push([cellKey(x, y), px, py]);
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
  const spanX = maxX - minX + 2, spanY = maxY - minY + 2;
  const scale = Math.max(1, Math.min(maxWidth / spanX, maxScale));
  canvas.width = Math.ceil(spanX * scale);
  canvas.height = Math.ceil(spanY * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const corner = (k: number) => {
    const a = (Math.PI / 3) * k + (orientation === "pointy" ? Math.PI / 6 : 0);
    return [Math.cos(a), Math.sin(a)];
  };
  const corners = [0, 1, 2, 3, 4, 5].map(corner);
  for (const [key, px, py] of pts) {
    const t = cells.get(key);
    const cx = (px - minX + 1) * scale, cy = (py - minY + 1) * scale;
    ctx.beginPath();
    corners.forEach(([dx, dy], k) => {
      const X = cx + dx * scale * 1.01, Y = cy + dy * scale * 1.01;
      if (k === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.closePath();
    ctx.fillStyle = t ? (colors.get(t) ?? hashColor(t)) : "rgba(127,127,127,0.15)";
    ctx.fill();
    if (featureCells?.has(key)) {
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = Math.max(1, scale * 0.15);
      ctx.stroke();
    }
  }
  // Paths through hex centres.
  const centre = new Map(pts.map(([key, px, py]) => [key, [(px - minX + 1) * scale, (py - minY + 1) * scale]]));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const p of paths) {
    const lit = !highlightRoute || p.route === highlightRoute;
    ctx.globalAlpha = lit ? 1 : 0.2;
    ctx.beginPath();
    p.hexes.forEach((h, i) => {
      const c = centre.get(h);
      if (!c) return;
      if (i === 0) ctx.moveTo(c[0], c[1]);
      else ctx.lineTo(c[0], c[1]);
    });
    ctx.strokeStyle = pathColors.get(p.type) ?? "#2b6cb0";
    ctx.lineWidth = Math.max(1.5, scale * 0.35) * (highlightRoute && lit ? 1.8 : 1);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
