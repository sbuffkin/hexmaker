/**
 * Map → hexcrawl manual PDF: a printable gazetteer in the usual hexcrawl
 * layout (see manual/manualHtml.ts). Sits next to the "PDF with reference
 * table" export, which is unchanged.
 *
 * Reads the map's hex notes, keeps only hexes with something beyond terrain,
 * drops unedited template hint text, renders each note's sections through
 * Obsidian's markdown renderer, and prints with the manual's own stylesheet
 * (not the user's theme) so the result looks the same in every vault.
 */

import { Component, MarkdownRenderer, Notice, TFile } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { exportToPdfBytes } from "../pdfExporter";
import { ensureExportFolder } from "../exportFolder";
import { renderMapToPngBlob } from "../mapPngRenderer";
import { getAllSectionData } from "../../sections";
import { getHexNameFromFile, getHexRegionFromFile, getTerrainFromFile } from "../../frontmatter";
import { getIconUrl, normalizeFolder } from "../../utils";
import { parseRandomTable, getDieRanges } from "../../random-tables/randomTable";
import DEFAULT_HEX_TEMPLATE from "../../defaultHexTemplate.md";
import {
  blobToDataUri,
  computeSubdivisions,
  enumerateSections,
  openInVault,
  sanitiseFilename,
  writeBinaryToVault,
} from "./mapWithTable";
import { hexNumbering } from "../manual/hexNumber";
import { pluginVersion } from "../../compat";
import { mapLabel } from "../../maps/mapTree";
import { PlaceholderFilter } from "../manual/placeholders";
import { buildManualHtml, isKeyed, MANUAL_CSS, tableResultText } from "../manual/manualHtml";
import type { ManualData, ManualHex, ManualLinks, ManualPart, ManualSection, ManualTable } from "../manual/manualModel";
import { exportedMessage } from "../exportFolder";

export interface ManualExportOptions {
  /** Filename stem (no extension). Defaults to "<map> manual". */
  outputName?: string;
  /** Leave out hidden and secret text. */
  player?: boolean;
  pageSize?: "A4" | "Letter";
  /** Hex radius for the map images (print resolution). Default 60. */
  hexRadius?: number;
  showIcons?: boolean;
  showPaths?: boolean;
  showFactionOverlay?: boolean;
  showRegionOverlay?: boolean;
  /** Hex names on the maps. Default true. */
  showHexNames?: boolean;
  /** Tokens (and their names) on the maps. Default false. */
  showTokens?: boolean;
  /** Optional parts to leave out. */
  omit?: ManualPart[];
}

/** Usable map area on a portrait page with the manual's margins, in CSS px. */
const SECTION_MAP_PX = { width: 700, height: 410 };
/** Smallest hex on a section map, in CSS px, before it's split further. */
const MIN_HEX_PX = 34;

export async function exportMapAsManual(plugin: HexmakerPlugin, mapName: string, opts: ManualExportOptions = {}): Promise<void> {
  const folder = await ensureExportFolder(plugin);
  const stem = (opts.outputName ?? `${mapName} manual`).trim() || `${mapName} manual`;
  const outPath = `${folder}/${sanitiseFilename(stem)}.pdf`;
  const notice = new Notice(`Building ${stem}.pdf…`, 0);
  try {
    const data = await collectManualData(plugin, mapName, opts, (msg) => notice.setMessage(`${stem}.pdf: ${msg}`));
    notice.setMessage(`${stem}.pdf: printing…`);
    const bytes = await exportToPdfBytes(
      { bodyHtml: buildManualHtml(data), css: MANUAL_CSS, title: data.title },
      {
        pageSize: opts.pageSize ?? "Letter",
        landscape: false,
        margins: { top: 0.6, bottom: 0.7, left: 0.65, right: 0.65 },
        displayHeaderFooter: true,
        footerTemplate: `<div style="width:100%;font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:7.5px;color:#8a8174;padding:0 0.65in;display:flex;justify-content:space-between;"><span>${escapeHtml(data.title)}${data.player ? " · Player edition" : ""}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      },
    );
    const replaced = plugin.app.vault.getAbstractFileByPath(outPath) instanceof TFile;
    await writeBinaryToVault(plugin.app, outPath, bytes);
    new Notice(exportedMessage(outPath, replaced));
    void openInVault(plugin.app, outPath);
  } catch (err) {
    console.error(err);
    new Notice(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    notice.hide();
  }
}

/** Read everything the manual needs from the vault. */
export async function collectManualData(
  plugin: HexmakerPlugin,
  mapName: string,
  opts: ManualExportOptions,
  progress: (msg: string) => void = () => {},
): Promise<ManualData> {
  const app = plugin.app;
  const map = plugin.settings.maps.find((m) => m.name === mapName);
  if (!map) throw new Error(`Map "${mapName}" not found`);
  const player = !!opts.player;
  const { x: ox, y: oy } = map.gridOffset;
  const { cols, rows } = map.gridSize;
  const numbering = hexNumbering(map.gridOffset, map.gridSize);
  const palette = plugin.getPaletteByName(map.paletteName)?.terrains ?? plugin.settings.terrainPalettes[0]?.terrains ?? [];
  const paletteByName = new Map(palette.map((t) => [t.name, t]));

  // Template hint text to ignore: the configured template plus the built-in one.
  const templates = [DEFAULT_HEX_TEMPLATE];
  const templatePath = normalizeFolder(plugin.settings.templatePath ?? "");
  const templateFile = templatePath ? app.vault.getAbstractFileByPath(templatePath) : null;
  if (templateFile instanceof TFile) templates.push(await app.vault.cachedRead(templateFile));
  const placeholders = new PlaceholderFilter(templates);

  const component = new Component();
  component.load();
  const renderHost = activeDocument.body.createDiv({ cls: "duckmage-export-render-host markdown-rendered" });
  const render = async (md: string, sourcePath: string): Promise<string> => {
    if (!md) return "";
    renderHost.empty();
    await MarkdownRenderer.render(app, md, renderHost, sourcePath, component);
    return renderHost.innerHTML;
  };

  const terrainCounts = new Map<string, number>();
  const regionCounts = new Map<string, number>();
  const factions = new Map<string, { hexCount: number; regions: Set<string> }>();
  const tableUse = new Map<string, number>();
  const indexes: Record<"Named hexes" | "Towns" | "Dungeons" | "Features" | "Quests", Map<string, string[]>> = {
    "Named hexes": new Map(), Towns: new Map(), Dungeons: new Map(), Features: new Map(), Quests: new Map(),
  };
  const keyedByKey = new Map<string, ManualHex>();
  let hexCount = 0;

  try {
    progress("reading hex notes…");
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col + ox, y = row + oy;
        const path = plugin.hexPath(x, y, mapName);
        // Terrain and region are map data: count every hex, noted or not
        // (most painted hexes have no note). Only noted hexes have content.
        const terrain = getTerrainFromFile(app, path) ?? "";
        const region = getHexRegionFromFile(app, path) ?? "";
        if (terrain) terrainCounts.set(terrain, (terrainCounts.get(terrain) ?? 0) + 1);
        if (region) regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1);
        const file = app.vault.getAbstractFileByPath(path);
        // A named hex is keyed even without a note (its name is map data).
        const name = getHexNameFromFile(path) ?? undefined;
        if (!(file instanceof TFile) && !name) continue;
        hexCount++;

        const { text, links } = file instanceof TFile
          ? await getAllSectionData(app, path, await app.vault.cachedRead(file))
          : { text: new Map<string, string>(), links: new Map<string, string[]>() };
        const names = (key: string) => (links.get(key) ?? []).map(basename);
        const hexLinks: ManualLinks = {
          towns: names("towns"),
          dungeons: names("dungeons"),
          features: names("features"),
          quests: names("quests"),
          factions: names("factions"),
        };
        for (const f of hexLinks.factions) {
          const e = factions.get(f) ?? { hexCount: 0, regions: new Set<string>() };
          e.hexCount++;
          if (region) e.regions.add(region);
          factions.set(f, e);
        }
        for (const target of links.get("encounters table") ?? []) {
          const dest = app.metadataCache.getFirstLinkpathDest(target, path);
          if (dest) tableUse.set(dest.path, (tableUse.get(dest.path) ?? 0) + 1);
        }

        const raw = {
          landmark: placeholders.clean(text.get("landmark")),
          description: placeholders.clean(text.get("description")),
          hidden: placeholders.clean(text.get("hidden")),
          secret: placeholders.clean(text.get("secret")),
          weather: placeholders.clean(text.get("weather")),
          hooks: placeholders.clean(text.get("hooks & rumors")),
        };
        const candidate = { x, y, name, terrain, region, ...raw, links: hexLinks };
        if (!isKeyed(candidate, player)) continue;

        const number = numbering.number(x, y);
        if (name) indexes["Named hexes"].set(name, [...(indexes["Named hexes"].get(name) ?? []), number]);
        for (const [cat, key] of [["Towns", "towns"], ["Dungeons", "dungeons"], ["Features", "features"], ["Quests", "quests"]] as const) {
          for (const name of hexLinks[key]) indexes[cat].set(name, [...(indexes[cat].get(name) ?? []), number]);
        }
        keyedByKey.set(`${x}_${y}`, {
          number,
          x,
          y,
          name,
          terrain,
          terrainColor: paletteByName.get(terrain)?.color,
          region: region || undefined,
          landmark: await render(raw.landmark, path),
          description: await render(raw.description, path),
          hidden: player ? "" : await render(raw.hidden, path),
          secret: player ? "" : await render(raw.secret, path),
          weather: await render(raw.weather, path),
          hooks: await render(raw.hooks, path),
          links: hexLinks,
        });
      }
    }
  } finally {
    component.unload();
    renderHost.remove();
  }

  // Maps: an overview, then one per section of the key.
  const mapOpts = {
    hexRadius: opts.hexRadius ?? 60,
    showIcons: opts.showIcons ?? true,
    showPaths: opts.showPaths ?? true,
    showFactionOverlay: opts.showFactionOverlay ?? false,
    showRegionOverlay: opts.showRegionOverlay ?? false,
    showHexNames: opts.showHexNames ?? true,
    showTokens: opts.showTokens ?? false,
    showCoords: true,
    coordLabel: (x: number, y: number) => numbering.number(x, y),
    coordColor: "#1f1c17",
    coordHalo: "rgba(255,255,255,0.85)",
    background: "#ffffff",
    borderColor: "#3d372e",
  };
  progress("drawing the overview map…");
  const overviewMapUri = await blobToDataUri(await renderMapToPngBlob(plugin, mapName, { ...mapOpts, showCoords: cols * rows <= 900 }), "image/png");
  const layout = computeSubdivisions({
    gridCols: cols,
    gridRows: rows,
    pageWidthPx: SECTION_MAP_PX.width,
    pageHeightPx: SECTION_MAP_PX.height,
    minHexPxOnPage: MIN_HEX_PX,
  });
  const sections: ManualSection[] = [];
  const parts = enumerateSections(layout, map.gridSize);
  for (const [i, s] of parts.entries()) {
    progress(`drawing section map ${i + 1} of ${parts.length}…`);
    const png = await renderMapToPngBlob(plugin, mapName, {
      ...mapOpts,
      subgrid: { colStart: s.colStart, colEnd: s.colEnd, rowStart: s.rowStart, rowEnd: s.rowEnd },
    });
    const hexes: ManualHex[] = [];
    for (let row = s.rowStart; row < s.rowEnd; row++)
      for (let col = s.colStart; col < s.colEnd; col++) {
        const h = keyedByKey.get(`${col + ox}_${row + oy}`);
        if (h) hexes.push(h);
      }
    // Key order is by hex number (column, then row), as printed manuals do.
    hexes.sort((a, b) => a.number.localeCompare(b.number));
    sections.push({
      label: s.label,
      range: `${numbering.number(s.colStart + ox, s.rowStart + oy)}–${numbering.number(s.colEnd - 1 + ox, s.rowEnd - 1 + oy)}`,
      mapUri: await blobToDataUri(png, "image/png"),
      hexes,
    });
  }

  progress("reading encounter tables…");
  const tables: ManualTable[] = [];
  for (const [tablePath, usedBy] of [...tableUse].sort((a, b) => b[1] - a[1])) {
    const file = app.vault.getAbstractFileByPath(tablePath);
    if (!(file instanceof TFile)) continue;
    const table = parseRandomTable(await app.vault.cachedRead(file));
    if (!table.entries.length || table.entries.every((e) => /^example result\b/i.test(e.result.trim()))) continue;
    const total = table.entries.reduce((n, e) => n + e.weight, 0) || 1;
    const ranges = table.dice > 0 ? getDieRanges(table) : table.entries.map((e) => `${Math.round((e.weight / total) * 100)}%`);
    tables.push({
      name: file.basename,
      die: table.dice > 0 ? `d${table.dice}` : "",
      rows: table.entries.map((e, i) => ({ roll: ranges[i] ?? "", result: escapeHtml(tableResultText(e.result)) })),
      usedBy,
    });
  }

  progress("drawing the legend…");
  const legend = [];
  for (const [name, count] of [...terrainCounts].sort((a, b) => b[1] - a[1])) {
    const entry = paletteByName.get(name);
    legend.push({
      name,
      color: entry?.color ?? "#999999",
      iconUri: entry?.icon ? await iconDataUri(getIconUrl(plugin, entry.icon)) : undefined,
      hexCount: count,
    });
  }
  const pathTypes = new Map(plugin.getMapPathTypes(map.name).map((t) => [t.name, t]));
  const pathCounts = new Map<string, number>();
  for (const c of map.pathChains ?? []) pathCounts.set(c.typeName, (pathCounts.get(c.typeName) ?? 0) + c.hexes.length);
  const paths = [...pathCounts].map(([name, count]) => {
    const t = pathTypes.get(name);
    return {
      name,
      color: t?.color ?? "#2b6cb0",
      width: t?.width ?? 3,
      dash: t?.lineStyle === "dashed" ? "6 4" : t?.lineStyle === "dotted" ? "1 4" : undefined,
      count,
    };
  });

  const keyedCount = keyedByKey.size;
  return {
    title: mapLabel(plugin.settings.maps.find((m) => m.name === mapName), mapName),
    version: pluginVersion(plugin),
    date: new Date().toISOString().slice(0, 10),
    hexCount,
    keyedCount,
    player,
    numberDigits: numbering.digits,
    overviewMapUri,
    legend,
    paths,
    tables,
    factions: [...factions]
      .map(([name, f]) => ({ name, hexCount: f.hexCount, regions: [...f.regions].sort() }))
      .sort((a, b) => b.hexCount - a.hexCount),
    regions: [...regionCounts].map(([name, hexCount]) => ({ name, hexCount })).sort((a, b) => b.hexCount - a.hexCount),
    sections,
    index: (Object.keys(indexes) as (keyof typeof indexes)[]).map((category) => ({
      category,
      entries: [...indexes[category]]
        .map(([name, hexes]) => ({ name, hexes: [...new Set(hexes)].sort() }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })),
    omit: opts.omit,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────

function basename(target: string): string {
  const stem = target.slice(target.lastIndexOf("/") + 1);
  return stem.replace(/\.md$/i, "").split("#")[0];
}


function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Terrain icons as data URIs so the print page needs no vault access. */
async function iconDataUri(url: string): Promise<string | undefined> {
  if (url.startsWith("data:")) return url;
  try {
    const img = createEl("img");
    img.src = url;
    await img.decode();
    const canvas = createEl("canvas");
    canvas.width = img.naturalWidth || 64;
    canvas.height = img.naturalHeight || 64;
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  }
}
