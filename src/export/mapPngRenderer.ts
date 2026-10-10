/**
 * Hex-map PNG renderer (Phase 1, item 1.3).
 *
 * Independent of HexMapView's DOM rendering — re-implements the layout in
 * canvas so the output is a clean raster at user-chosen resolution, ignoring
 * pan/zoom and unaffected by CSS layout quirks. Geometry is shared with the
 * overlay code via `hex-map/hexGeometry.ts`.
 *
 * Pipeline:
 *   for each (col, row) → resolve hex note → terrain + optional icon →
 *   draw hex polygon + fill + border + icon + optional coord label →
 *   then draw all path chains via the same routing helpers HexMapView uses.
 */

import { Notice, TFile, type App } from "obsidian";
import {
  hexCenter,
  hexPolygonPoints,
  buildEdgePts,
  buildMeanderPts,
  smoothPath,
  sharpPath,
  offsetPolyline,
  computeLaneOffsets,
} from "../hex-map/hexGeometry";
import { ensureExportFolder } from "./exportFolder";
import {
  getTerrainFromFile,
  getIconOverrideFromFile,
  getFactionColorFromFile,
  getRegionColorFromFile,
  getFactionStyleFromFile,
  getRegionStyleFromFile,
  getHexRegionFromFile,
  getHexNameFromFile,
  getTokenDataFromCache,
  type OverlayStyle,
} from "../frontmatter";
import { pngHexNamePx, pngHexNameY, pngTokenRadius, pngTokenSpread } from "./handoutLabels";
import { DEFAULT_TOKEN_FILL, groupSize, tokenGroupOffsets, tokenNamePlacement } from "../hex-map/tokenDefaults";
import { getIconUrl, normalizeFolder } from "../utils";
import { drawPatternTile } from "../overlayPatterns";
import { coordHaloColor, pngCoordFontFamily, pngCoordFontPx, pngCoordY } from "../coordStyle";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { TerrainColor, MapData, TokenEntry } from "../types";

export interface MapPngRenderOptions {
  /** Pixel radius of each hex. Larger = higher-resolution output. Default 50. */
  hexRadius?: number;
  /** Padding in pixels around the grid. Default 40. */
  padding?: number;
  /** Background colour. Default dark grey. */
  background?: string;
  /** Hex border colour. Default near-black. */
  borderColor?: string;
  /** Coordinate label colour. Default: the coordinate colour setting. */
  coordColor?: string;
  /** Draw coordinate labels in each hex. Default true. */
  showCoords?: boolean;
  /**
   * Label text per hex instead of "x,y" (the hexcrawl manual prints XXYY hex
   * numbers). When set, the label sits near the top edge, the usual place
   * for hex numbers on printed maps.
   */
  coordLabel?: (x: number, y: number) => string;
  /** Outline drawn behind labels so they read on any terrain colour.
   *  Default: dark behind light text, light behind dark (coordHaloColor). */
  coordHalo?: string;
  /** Draw terrain icons. Default true. */
  showIcons?: boolean;
  /** Include road/river/path chains. Default true. */
  showPaths?: boolean;
  /**
   * Restrict rendering to a sub-rectangle of the grid. When set, only hexes
   * inside the half-open range `[colStart, colEnd) × [rowStart, rowEnd)` are
   * drawn, and the canvas is sized to fit just those. Used by the map PDF
   * exporter to render section views.
   */
  subgrid?: {
    colStart: number;
    colEnd: number;
    rowStart: number;
    rowEnd: number;
  };
  /** Draw each named hex's name (N1). Default false. */
  showHexNames?: boolean;
  /** Draw the map's tokens (hidden ones never), with their names. Default false. */
  showTokens?: boolean;
  /** Tint hexes by their linked factions. Default false. */
  showFactionOverlay?: boolean;
  /** Tint hexes by their region. Default false. */
  showRegionOverlay?: boolean;
  /**
   * Deprecated. Overlay opacity is now read per faction/region from
   * frontmatter (faction-pattern-opacity / region-pattern-opacity).
   */
  overlayOpacity?: number;
}

/**
 * Render the named map to a PNG blob. Returns the blob; caller writes it.
 * Throws if the map name isn't found in settings.
 */
export async function renderMapToPngBlob(
  plugin: HexmakerPlugin,
  mapName: string,
  opts: MapPngRenderOptions = {},
): Promise<Blob> {
  const map = plugin.settings.maps.find((m) => m.name === mapName);
  if (!map) throw new Error(`Map "${mapName}" not found`);

  const R = opts.hexRadius ?? 50;
  const padding = opts.padding ?? 40;
  const showCoords = opts.showCoords ?? true;
  const showIcons = opts.showIcons ?? true;
  const showPaths = opts.showPaths ?? true;
  const showFactionOverlay = opts.showFactionOverlay ?? false;
  const showRegionOverlay = opts.showRegionOverlay ?? false;
  const showHexNames = opts.showHexNames ?? false;
  const showTokens = opts.showTokens ?? false;
  const background = opts.background ?? "#1a1a1a";
  const borderColor = opts.borderColor ?? "#222";
  // Labels follow the coordinate settings, with a contrast halo, so they
  // read on light terrain (round 4: tiny grey labels on pale hexes).
  const coordColor = opts.coordColor ?? plugin.settings.coordFontColor ?? "#ffffff";
  const coordHalo = opts.coordHalo ?? coordHaloColor(coordColor);
  const coordPx = pngCoordFontPx(R, plugin.settings.coordFontSize);
  const coordFamily = pngCoordFontFamily(plugin.settings.coordFontFamily);
  const coordPlacement = plugin.settings.coordPlacement;

  const orientation = plugin.settings.hexOrientation;
  const isFlat = orientation === "flat";
  const stagger = map.staggerOffset ?? plugin.settings.staggerOffset;
  const palette = plugin.settings.terrainPalettes.find(
    (p) => p.name === map.paletteName,
  );
  // First-occurrence wins, matching HexMapView's `.find()` behaviour. Users
  // can end up with duplicate-named entries in their palette (e.g. after
  // copy-paste edits in settings); the first one is canonical.
  const terrainByName = new Map<string, TerrainColor>();
  for (const t of palette?.terrains ?? []) {
    if (!terrainByName.has(t.name)) terrainByName.set(t.name, t);
  }

  const { cols, rows } = map.gridSize;
  const { x: ox, y: oy } = map.gridOffset;

  // Clamp the subgrid range to the actual grid bounds. When unset, the range
  // covers everything → equivalent to the previous behaviour.
  const colStart = Math.max(0, opts.subgrid?.colStart ?? 0);
  const colEnd = Math.min(cols, opts.subgrid?.colEnd ?? cols);
  const rowStart = Math.max(0, opts.subgrid?.rowStart ?? 0);
  const rowEnd = Math.min(rows, opts.subgrid?.rowEnd ?? rows);

  // Step 1: pre-compute centres for every cell IN RANGE. centerMap is keyed
  // by the "x_y" hex coord (the same scheme path chains use).
  const centerMap = new Map<string, { cx: number; cy: number }>();
  for (let row = rowStart; row < rowEnd; row++) {
    for (let col = colStart; col < colEnd; col++) {
      const c = hexCenter(col, row, orientation, R, stagger);
      centerMap.set(`${col + ox}_${row + oy}`, c);
    }
  }

  // Step 2: pixel-shift all centres so the grid sits at (padding, padding).
  const allCenters = Array.from(centerMap.values());
  const minX = Math.min(...allCenters.map((c) => c.cx)) - R;
  const minY = Math.min(...allCenters.map((c) => c.cy)) - R;
  const maxX = Math.max(...allCenters.map((c) => c.cx)) + R;
  const maxY = Math.max(...allCenters.map((c) => c.cy)) + R;
  const shifted = new Map<string, { cx: number; cy: number }>();
  for (const [k, c] of centerMap) {
    shifted.set(k, { cx: c.cx - minX + padding, cy: c.cy - minY + padding });
  }
  const W = Math.ceil(maxX - minX + padding * 2);
  const H = Math.ceil(maxY - minY + padding * 2);

  // Step 3a: build colour maps for overlays (faction-basename → hex colour,
  // region-name → hex colour). Empty if the respective overlay is off.
  const factionColorMap = showFactionOverlay
    ? buildFactionColorMap(plugin)
    : new Map<string, string>();
  const regionColorMap = showRegionOverlay
    ? buildRegionColorMap(plugin)
    : new Map<string, string>();
  const factionStyleMap = showFactionOverlay
    ? buildFactionStyleMap(plugin)
    : new Map<string, OverlayStyle>();
  const regionStyleMap = showRegionOverlay
    ? buildRegionStyleMap(plugin)
    : new Map<string, OverlayStyle>();

  // Step 3b: collect every hex's terrain + icon override + overlay info before
  // drawing so we can pre-load icon images once each. We also track which
  // factions / regions are actually present on this map so the legend at the
  // end can show just those (not the entire vault folder).
  interface HexState {
    key: string;
    cx: number;
    cy: number;
    terrain?: TerrainColor;
    iconName?: string;
    /** Tint applied to terrain icons (mirrors the on-screen mask-image
     *  tint in createIconEl). Override icons render untinted, as on-screen. */
    iconTint?: string;
    factions: { color: string; style: OverlayStyle }[];
    region?: { color: string; style: OverlayStyle };
    name?: string;
  }
  const hexes: HexState[] = [];
  const iconsNeeded = new Set<string>();
  interface LegendEntry { color: string; style: OverlayStyle }
  const factionsUsed = new Map<string, LegendEntry>(); // name → entry
  const regionsUsed = new Map<string, string>(); // name → color
  // Per-region hex centres, used to position the on-map region label at the
  // cluster centroid (with PCA-derived rotation). Same approach as the
  // on-screen `renderRegionOverlay` in HexMapView.
  const regionHexCenters = new Map<string, { cx: number; cy: number }[]>();
  for (let row = rowStart; row < rowEnd; row++) {
    for (let col = colStart; col < colEnd; col++) {
      const hx = col + ox;
      const hy = row + oy;
      const key = `${hx}_${hy}`;
      const c = shifted.get(key);
      if (!c) continue;
      const notePath = plugin.hexPath(hx, hy, mapName);
      const file = plugin.app.vault.getAbstractFileByPath(notePath);

      let terrain: TerrainColor | undefined;
      let iconOverride: string | undefined;
      const factions: { color: string; style: OverlayStyle }[] = [];
      let region: { color: string; style: OverlayStyle } | undefined;
      // Terrain, icon and region are map data (map note): read them for
      // every hex, noted or not — most painted hexes have no note.
      const terrainName = getTerrainFromFile(plugin.app, notePath);
      if (terrainName) terrain = terrainByName.get(terrainName);
      // Unpainted hexes draw as the map's base terrain, matching the
      // on-screen map.
      if (!terrain && map?.baseTerrain) terrain = terrainByName.get(map.baseTerrain);
      iconOverride = getIconOverrideFromFile(plugin.app, notePath) ?? undefined;
      {
        // Faction links live in the hex note's body.
        if (showFactionOverlay && file instanceof TFile) {
          for (const fName of getHexFactionLinks(plugin.app, file)) {
            const c = factionColorMap.get(fName);
            const s = factionStyleMap.get(fName);
            if (c && s) {
              factions.push({ color: c, style: s });
              factionsUsed.set(fName, { color: c, style: s });
            }
          }
        }
        if (showRegionOverlay) {
          const regionName = getHexRegionFromFile(plugin.app, notePath);
          if (regionName) {
            const c = regionColorMap.get(regionName);
            const s = regionStyleMap.get(regionName);
            if (c && s) {
              region = { color: c, style: s };
              regionsUsed.set(regionName, c);
              const center = shifted.get(`${hx}_${hy}`);
              if (center) {
                if (!regionHexCenters.has(regionName)) {
                  regionHexCenters.set(regionName, []);
                }
                regionHexCenters.get(regionName)!.push(center);
              }
            }
          }
        }
      }
      const iconName = iconOverride ?? terrain?.icon;
      if (iconName && showIcons) iconsNeeded.add(iconName);
      hexes.push({
        key,
        cx: c.cx,
        cy: c.cy,
        terrain,
        iconName,
        iconTint: iconOverride ? undefined : terrain?.iconColor,
        factions,
        region,
        name: showHexNames ? getHexNameFromFile(notePath) ?? undefined : undefined,
      });
    }
  }

  // Tokens on this map, grouped per hex (visible ones only, as on screen).
  const tokensByHex = new Map<string, TokenEntry[]>();
  if (showTokens) {
    for (const file of plugin.app.vault.getMarkdownFiles()) {
      const t = getTokenDataFromCache(plugin.app, file);
      if (!t || t.map !== mapName || !t.visible || !shifted.has(t.hex)) continue;
      tokensByHex.set(t.hex, [...(tokensByHex.get(t.hex) ?? []), t]);
      if (t.icon) iconsNeeded.add(t.icon);
    }
  }

  const iconCache = await loadIcons(plugin, iconsNeeded);

  // Tinted icon variants — canvas equivalent of the on-screen CSS
  // mask-image tint (solid colour in the shape of the icon's alpha).
  // Cached per (icon, colour) so each variant is composited once.
  const tintedIconCache = new Map<string, OffscreenCanvas>();
  const tintedIcon = (
    img: HTMLImageElement,
    name: string,
    color: string,
  ): OffscreenCanvas => {
    const cacheKey = `${name}|${color}`;
    let tinted = tintedIconCache.get(cacheKey);
    if (!tinted) {
      const w = img.naturalWidth || img.width || 1;
      const h = img.naturalHeight || img.height || 1;
      tinted = new OffscreenCanvas(w, h);
      const tctx = tinted.getContext("2d")!;
      tctx.drawImage(img, 0, 0, w, h);
      tctx.globalCompositeOperation = "source-in";
      tctx.fillStyle = color;
      tctx.fillRect(0, 0, w, h);
      tintedIconCache.set(cacheKey, tinted);
    }
    return tinted;
  };

  // Step 4: render to canvas. OffscreenCanvas is reliable in Obsidian's
  // Electron Chromium; convertToBlob() is Promise-based.
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");

  // Background
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);

  // Pattern cache: (pattern|color|scale) → CanvasPattern. Built lazily as
  // distinct overlays are encountered during the hex loop.
  const patternCache = new Map<string, CanvasPattern | null>();
  const getPattern = (style: OverlayStyle, color: string): CanvasPattern | null => {
    if (style.pattern === "solid") return null;
    const key = `${style.pattern}|${color}|${style.scale}`;
    if (patternCache.has(key)) return patternCache.get(key) ?? null;
    const tile = new OffscreenCanvas(style.scale, style.scale);
    const tctx = tile.getContext("2d");
    if (!tctx) { patternCache.set(key, null); return null; }
    drawPatternTile(tctx, { pattern: style.pattern, color, scale: style.scale });
    const pat = ctx.createPattern(tile, "repeat");
    patternCache.set(key, pat);
    return pat;
  };

  // Hexes — base fill + overlay tints + icons + coords
  for (const hex of hexes) {
    drawHex(
      ctx,
      hex.cx,
      hex.cy,
      R,
      orientation,
      hex.terrain?.color ?? "#2a2a2a",
      borderColor,
    );
    // Region overlay first (under faction): regions are larger, factions
    // are usually narrower local groups, so faction tint reads on top.
    if (showRegionOverlay && hex.region) {
      const pat = getPattern(hex.region.style, hex.region.color);
      fillHexPolygon(
        ctx, hex.cx, hex.cy, R, orientation,
        pat ?? hex.region.color, hex.region.style.opacity,
      );
    }
    if (showFactionOverlay) {
      for (const f of hex.factions) {
        const pat = getPattern(f.style, f.color);
        fillHexPolygon(
          ctx, hex.cx, hex.cy, R, orientation,
          pat ?? f.color, f.style.opacity,
        );
      }
    }
    if (showIcons && hex.iconName) {
      const img = iconCache.get(hex.iconName);
      if (img) {
        const size = R * 0.9;
        const src = hex.iconTint
          ? tintedIcon(img, hex.iconName, hex.iconTint)
          : img;
        ctx.drawImage(src, hex.cx - size / 2, hex.cy - size / 2, size, size);
      }
    }
    if (showCoords) {
      const [hxStr, hyStr] = hex.key.split("_");
      const custom = opts.coordLabel;
      const text = custom ? custom(Number(hxStr), Number(hyStr)) : `${hxStr},${hyStr}`;
      const y = custom ? hex.cy - R * 0.52 : pngCoordY(coordPlacement, hex.cy, R);
      const px = custom ? Math.round(R * 0.24) : coordPx;
      ctx.font = custom ? `600 ${px}px sans-serif` : `700 ${px}px ${coordFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(3, px * 0.3);
      ctx.strokeStyle = coordHalo;
      ctx.strokeText(text, hex.cx, y);
      ctx.fillStyle = coordColor;
      ctx.fillText(text, hex.cx, y);
    }
  }

  // Region labels — drawn over the map at each region's centroid, rotated
  // along the cluster's principal axis. Same algorithm as the on-screen
  // `renderRegionOverlay`.
  if (showRegionOverlay && regionHexCenters.size > 0) {
    for (const [regionName, centers] of regionHexCenters) {
      drawRegionLabel(ctx, regionName, centers, R);
    }
  }

  // Faction key — a labelled swatch panel at the bottom-left. Only lists
  // factions actually used on this map.
  if (showFactionOverlay && factionsUsed.size > 0) {
    const fontSize = Math.max(11, Math.round(R * 0.28));
    const legendPadding = 16;
    const size = drawLegend(
      ctx,
      padding,
      0,
      "Factions",
      sortedEntries(factionsUsed),
      fontSize,
      legendPadding,
      true, // measure pass first to anchor from the bottom
      orientation,
    );
    drawLegend(
      ctx,
      padding,
      H - padding - size.height,
      "Factions",
      sortedEntries(factionsUsed),
      fontSize,
      legendPadding,
      false,
      orientation,
    );
  }

  // Paths — flatten in draw order, then offset chains that share a route into
  // parallel lanes so a road and a river on the same hexes render side by side
  // (issue #30), matching HexMapView's on-screen behaviour.
  if (showPaths) {
    const renderables = plugin.settings.pathTypes.flatMap((pt) =>
      map.pathChains
        .filter((c) => c.typeName === pt.name)
        .map((chain) => ({ chain, pt })),
    );
    const laneOffset = computeLaneOffsets(
      renderables.map((r) => ({
        hexes: r.chain.hexes,
        width: r.pt.width,
        typeName: r.pt.name,
      })),
    );
    renderables.forEach(({ chain, pt }, idx) => {
      const dash = dashFor(pt.lineStyle);
      let pts;
      let smooth: boolean;
      if (pt.routing === "edge") {
        pts = buildEdgePts(chain.hexes, shifted, isFlat, R);
        smooth = false;
      } else if (pt.routing === "meander") {
        pts = buildMeanderPts(chain.hexes, shifted);
        smooth = true;
      } else {
        pts = chain.hexes
          .map((k) => shifted.get(k))
          .filter((p): p is { cx: number; cy: number } => !!p);
        smooth = true;
      }
      if (pts.length < 2) return;
      pts = offsetPolyline(pts, laneOffset[idx]);
      drawPath(ctx, pts, pt.color, pt.width, dash, smooth);
    });
  }

  // Hex names, over paths, on the side of the hex away from its coordinates.
  if (showHexNames) {
    const px = pngHexNamePx(R);
    ctx.font = `700 ${px}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, px * 0.3);
    for (const hex of hexes) {
      if (!hex.name) continue;
      const y = pngHexNameY(coordPlacement, showCoords && !!opts.coordLabel, hex.cy, R);
      ctx.strokeStyle = coordHalo;
      ctx.strokeText(hex.name, hex.cx, y);
      ctx.fillStyle = coordColor;
      ctx.fillText(hex.name, hex.cx, y);
    }
  }

  // Tokens last, on top of everything, each with its name underneath.
  if (showTokens) {
    const spread = pngTokenSpread(R);
    for (const [key, tokens] of tokensByHex) {
      const c = shifted.get(key)!;
      const offsets = tokenGroupOffsets(tokens.length);
      tokens.forEach((t, i) => {
        const [dx, dy] = offsets[i];
        drawToken(ctx, t, c.cx + dx * spread, c.cy + dy * spread, pngTokenRadius(t.size, R), iconCache);
      });
      // Names under the tokens; tokens sharing a hex list theirs one per
      // line under the group, as on the map.
      const r = pngTokenRadius(tokens.length > 1 ? groupSize(tokens) : tokens[0].size, R);
      const namePx = Math.max(10, Math.round(r * 0.75));
      tokens.forEach((t, i) => {
        const place = tokenNamePlacement(offsets, i);
        drawTokenName(ctx, t.title, c.cx + place.dx * spread, c.cy + place.dy * spread + r + 3 + place.line * namePx * 1.15, namePx, coordColor, coordHalo);
      });
    }
  }

  return canvas.convertToBlob({ type: "image/png" });
}

// ── Drawing primitives ──────────────────────────────────────────────────────

/** One token: its shape in its fill (and border ring), icon or initial. */
function drawToken(
  ctx: OffscreenCanvasRenderingContext2D,
  t: TokenEntry,
  cx: number,
  cy: number,
  r: number,
  icons: Map<string, HTMLImageElement>,
): void {
  ctx.save();
  ctx.beginPath();
  if (t.shape === "square") {
    ctx.rect(cx - r, cy - r, r * 2, r * 2);
  } else if (t.shape === "hexagon") {
    // Pointy-top, like the on-screen clip-path.
    const pts = hexPolygonPoints(cx, cy, "pointy", r);
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = t.color ?? DEFAULT_TOKEN_FILL;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = Math.max(2, r * 0.2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  if (t.border) {
    ctx.lineWidth = Math.max(2, r * 0.18);
    ctx.strokeStyle = t.border;
    ctx.stroke();
  }
  const img = t.icon ? icons.get(t.icon) : undefined;
  if (img) {
    const s = r * 1.4;
    ctx.drawImage(img, cx - s / 2, cy - s / 2, s, s);
  } else {
    const px = Math.max(9, Math.round(r));
    ctx.font = `700 ${px}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(t.title.charAt(0).toUpperCase(), cx, cy);
  }
  ctx.restore();
}

/** A token's name, top-centred at (x, y), with a halo like the coordinates. */
function drawTokenName(
  ctx: OffscreenCanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  px: number,
  color: string,
  halo: string,
): void {
  ctx.font = `600 ${px}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, px * 0.3);
  ctx.strokeStyle = halo;
  ctx.strokeText(name, x, y);
  ctx.fillStyle = color;
  ctx.fillText(name, x, y);
}

function drawHex(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  orientation: "flat" | "pointy",
  fillColor: string,
  borderColor: string,
): void {
  const pts = hexPolygonPoints(cx, cy, orientation, radius);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineWidth = Math.max(1, radius * 0.04);
  ctx.strokeStyle = borderColor;
  ctx.stroke();
}

function drawPath(
  ctx: OffscreenCanvasRenderingContext2D,
  pts: { cx: number; cy: number }[],
  color: string,
  width: number,
  dash: number[],
  smooth: boolean,
): void {
  // Re-use the SVG-style path string from hexGeometry; Path2D parses the
  // same `M / L / Q` commands so we don't need to duplicate path math.
  const d = smooth ? smoothPath(pts) : sharpPath(pts);
  const path = new Path2D(d);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (dash.length > 0) ctx.setLineDash(dash);
  else ctx.setLineDash([]);
  ctx.stroke(path);
}

/**
 * Draw a region's name label centred over its hex cluster, rotated to match
 * the cluster's principal axis. Ports the algorithm from
 * `HexMapView.renderRegionOverlay`:
 *
 *  - Centroid = mean of hex centres
 *  - Angle = `atan2(2*sxy, sxx - syy) / 2` (PCA on covariance matrix)
 *  - Font size scales with √(hexCount), then again with hexRadius/40 so the
 *    label keeps its visual prominence at any export resolution
 *  - White text with a dark stroke for legibility on any base colour
 */
function drawRegionLabel(
  ctx: OffscreenCanvasRenderingContext2D,
  name: string,
  centers: Array<{ cx: number; cy: number }>,
  hexRadius: number,
): void {
  const n = centers.length;
  if (n === 0) return;

  const mx = centers.reduce((s, p) => s + p.cx, 0) / n;
  const my = centers.reduce((s, p) => s + p.cy, 0) / n;

  let angleDeg = 0;
  if (n > 1) {
    const sxx = centers.reduce((s, p) => s + (p.cx - mx) ** 2, 0);
    const syy = centers.reduce((s, p) => s + (p.cy - my) ** 2, 0);
    const sxy = centers.reduce((s, p) => s + (p.cx - mx) * (p.cy - my), 0);
    let ang = (Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI / 2;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    angleDeg = ang;
  }

  const baseFont = Math.min(10 + 3 * Math.sqrt(n), 52);
  // Scale font with hexRadius so labels keep their on-screen weight when
  // exporting at high resolutions. R=40 matches the on-screen calibration.
  const fontSize = Math.max(12, Math.round(baseFont * (hexRadius / 40)));

  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Dark outline → white fill = readable across light and dark backgrounds.
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, fontSize * 0.18);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
  ctx.strokeText(name, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(name, 0, 0);

  ctx.restore();
}

function sortedEntries<V>(m: Map<string, V>): Array<[string, V]> {
  return Array.from(m.entries()).sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { sensitivity: "base" }),
  );
}

/**
 * Draw (or measure) a legend box. When `measureOnly` is true, no pixels are
 * touched and only the bounding-box size is returned — useful for laying out
 * multiple stacked legends bottom-up.
 */
function drawLegend(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  title: string,
  entries: Array<[string, { color: string; style: OverlayStyle }]>,
  fontSize: number,
  pad: number,
  measureOnly: boolean,
  orientation: "flat" | "pointy" = "flat",
): { width: number; height: number } {
  if (entries.length === 0) return { width: 0, height: 0 };

  const swatch = Math.round(fontSize * 1.7);
  const lineHeight = Math.max(Math.round(fontSize * 1.45), swatch + 4);
  const gap = Math.round(fontSize * 0.5);

  // Measure widths. We need to set the font for accurate measurements.
  ctx.save();
  ctx.font = `bold ${fontSize}px sans-serif`;
  const titleWidth = ctx.measureText(title).width;
  ctx.font = `${fontSize}px sans-serif`;
  let widestEntry = 0;
  for (const [name] of entries) {
    const w = ctx.measureText(name).width;
    if (w > widestEntry) widestEntry = w;
  }
  ctx.restore();

  const contentWidth = Math.ceil(
    Math.max(titleWidth, swatch + gap + widestEntry),
  );
  const width = contentWidth + pad * 2;
  // Title + entries, each on its own line.
  const height = pad * 2 + lineHeight + lineHeight * entries.length;

  if (measureOnly) return { width, height };

  // Background panel — readable on both dark terrain and bright overlays.
  ctx.save();
  ctx.fillStyle = "rgba(20, 20, 20, 0.86)";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  // Title row.
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle = "#fff";
  ctx.fillText(title, x + pad, y + pad);

  // Entry rows.
  ctx.font = `${fontSize}px sans-serif`;
  let entryY = y + pad + lineHeight;
  // Shrink pattern tile so more repeats are visible in the small swatch
  // (user's scale slider is sized for on-map hexes ~96 px wide).
  const LEGEND_PATTERN_MULT = swatch / 96;
  const MIN_EFFECTIVE_SCALE = 4;
  for (const [name, entry] of entries) {
    const { color, style } = entry;
    const swatchY = entryY + Math.round((lineHeight - swatch) / 2);
    // Build pattern fill if non-solid
    let fill: string | CanvasPattern = color;
    if (style.pattern !== "solid") {
      const effectiveScale = Math.max(
        MIN_EFFECTIVE_SCALE,
        style.scale * LEGEND_PATTERN_MULT,
      );
      const tile = new OffscreenCanvas(effectiveScale, effectiveScale);
      const tctx = tile.getContext("2d");
      if (tctx) {
        drawPatternTile(tctx, {
          pattern: style.pattern,
          color,
          scale: effectiveScale,
        });
        const pat = ctx.createPattern(tile, "repeat");
        if (pat) fill = pat;
      }
    }
    // Hex polygon swatch
    const cx = x + pad + swatch / 2;
    const cy = swatchY + swatch / 2;
    const r = swatch / 2 - 1;
    const pts = hexPolygonPoints(cx, cy, orientation, r);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = style.opacity;
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.globalAlpha = prevAlpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.fillText(name, x + pad + swatch + gap, entryY);
    entryY += lineHeight;
  }
  ctx.restore();

  return { width, height };
}

/**
 * Fill a hex polygon with a colour at the given opacity. Used for overlay
 * tints; doesn't stroke a border (the base hex's border is already drawn).
 */
function fillHexPolygon(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  orientation: "flat" | "pointy",
  fill: string | CanvasPattern,
  opacity: number,
): void {
  const pts = hexPolygonPoints(cx, cy, orientation, radius);
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = opacity;
  ctx.fill();
  ctx.globalAlpha = prev;
}

// ── Overlay helpers ────────────────────────────────────────────────────────

/**
 * Walk every markdown file in the factions folder, read its `faction-color`
 * frontmatter, return a map of basename → colour.
 */
function buildFactionColorMap(plugin: HexmakerPlugin): Map<string, string> {
  const out = new Map<string, string>();
  const folder = normalizeFolder(plugin.settings.factionsFolder ?? "");
  for (const f of plugin.app.vault.getMarkdownFiles()) {
    if (folder && !f.path.startsWith(folder + "/")) continue;
    if (f.basename.startsWith("_")) continue;
    const color = getFactionColorFromFile(plugin.app, f.path);
    if (color) out.set(f.basename, color);
  }
  return out;
}

/**
 * Walk every markdown file in the regions folder, read its `region-color`
 * frontmatter, return a map of basename → colour.
 */
function buildRegionColorMap(plugin: HexmakerPlugin): Map<string, string> {
  const out = new Map<string, string>();
  const folder = normalizeFolder(plugin.settings.regionsFolder ?? "");
  for (const f of plugin.app.vault.getMarkdownFiles()) {
    if (folder && !f.path.startsWith(folder + "/")) continue;
    if (f.basename.startsWith("_")) continue;
    const color = getRegionColorFromFile(plugin.app, f.path);
    if (color) out.set(f.basename, color);
  }
  return out;
}

function buildFactionStyleMap(plugin: HexmakerPlugin): Map<string, OverlayStyle> {
  const out = new Map<string, OverlayStyle>();
  const folder = normalizeFolder(plugin.settings.factionsFolder ?? "");
  for (const f of plugin.app.vault.getMarkdownFiles()) {
    if (folder && !f.path.startsWith(folder + "/")) continue;
    if (f.basename.startsWith("_")) continue;
    out.set(f.basename, getFactionStyleFromFile(plugin.app, f.path));
  }
  return out;
}

function buildRegionStyleMap(plugin: HexmakerPlugin): Map<string, OverlayStyle> {
  const out = new Map<string, OverlayStyle>();
  const folder = normalizeFolder(plugin.settings.regionsFolder ?? "");
  for (const f of plugin.app.vault.getMarkdownFiles()) {
    if (folder && !f.path.startsWith(folder + "/")) continue;
    if (f.basename.startsWith("_")) continue;
    out.set(f.basename, getRegionStyleFromFile(plugin.app, f.path));
  }
  return out;
}

/**
 * Read the wiki-link basenames listed under `### Factions` in a hex note,
 * using the metadata cache directly (no DOM dependency).
 */
function getHexFactionLinks(app: App, file: TFile): string[] {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) return [];
  const headings = cache.headings ?? [];
  const factionHeading = headings.find(
    (h) => h.heading === "Factions" && h.level === 3,
  );
  if (!factionHeading) return [];
  const factionStart = factionHeading.position.start.offset;
  const nextHeading = headings.find(
    (h) => h.position.start.offset > factionStart && h.level <= 3,
  );
  const factionEnd = nextHeading?.position.start.offset ?? Infinity;
  return (cache.links ?? [])
    .filter(
      (lk) =>
        lk.position.start.offset > factionStart &&
        lk.position.start.offset < factionEnd,
    )
    .map((lk) => {
      const target = lk.link.split("|")[0].split("#")[0].trim();
      const slash = target.lastIndexOf("/");
      const stem = slash >= 0 ? target.slice(slash + 1) : target;
      return stem.replace(/\.md$/i, "");
    });
}


function dashFor(style: "solid" | "dashed" | "dotted"): number[] {
  switch (style) {
    case "dashed":
      return [12, 8];
    case "dotted":
      return [2, 6];
    default:
      return [];
  }
}

// ── Icon loading ───────────────────────────────────────────────────────────

async function loadIcons(
  plugin: HexmakerPlugin,
  names: Set<string>,
): Promise<Map<string, HTMLImageElement>> {
  const cache = new Map<string, HTMLImageElement>();
  const tasks: Promise<void>[] = [];
  for (const name of names) {
    const url = getIconUrl(plugin, name);
    tasks.push(
      loadImage(url)
        .then((img) => {
          cache.set(name, img);
        })
        .catch(() => {
          console.warn(`Map export: failed to load icon ${name}`);
        }),
    );
  }
  await Promise.all(tasks);
  return cache;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// ── Public exporter (used by the MapModal Export tab) ──────────────────────

/**
 * Options for the `exportMapAsPng` wrapper. Extends pure rendering options
 * with file-naming concerns the wrapper layer cares about.
 */
export interface MapPngExportOptions extends MapPngRenderOptions {
  /**
   * Filename stem to write to the export folder (no extension). Defaults to
   * `mapName`. Sanitised to strip vault-illegal characters.
   */
  outputName?: string;
}

export async function exportMapAsPng(
  plugin: HexmakerPlugin,
  mapName: string,
  opts: MapPngExportOptions = {},
): Promise<void> {
  const folder = await ensureExportFolder(plugin);
  const stem = (opts.outputName ?? mapName).trim() || mapName;
  const outPath = `${folder}/${sanitiseFilename(stem)}.png`;

  // Name the file being written (not the map), matching the export form.
  const notice = new Notice(`Exporting ${sanitiseFilename(stem)}.png…`, 0);
  try {
    const blob = await renderMapToPngBlob(plugin, mapName, opts);
    const buf = new Uint8Array(await blob.arrayBuffer());
    await writeBinaryToVault(plugin, outPath, buf);
    new Notice(`Exported to ${outPath}`);
    void openInVault(plugin, outPath);
  } catch (err) {
    console.error(err);
    new Notice(`Map export failed: ${(err as Error).message ?? err}`);
  } finally {
    notice.hide();
  }
}

function sanitiseFilename(name: string): string {
  // Strip vault-illegal characters from the map name when used as a filename.
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

async function writeBinaryToVault(
  plugin: HexmakerPlugin,
  path: string,
  data: Uint8Array,
): Promise<void> {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const existing = plugin.app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await plugin.app.vault.modifyBinary(existing, buf);
  } else {
    await plugin.app.vault.createBinary(path, buf);
  }
}

async function openInVault(
  plugin: HexmakerPlugin,
  path: string,
): Promise<void> {
  const file = plugin.app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    await plugin.app.workspace.getLeaf(false).openFile(file);
  }
}

// Re-export so the renderer's surface is self-contained.
export type { MapData };
