/**
 * Map → PDF with reference table exporter (Phase 1, item 1.4).
 *
 * Document structure:
 *   Page 1   — Title + full map rendered as large as fits on the page
 *   Page 2   — Table of contents listing each section + its hex range
 *   Pages 3+ — One page per section: cropped map view + hex reference table
 *              filtered to that section's hexes
 *
 * Subdivision picks the smallest number of sections such that each section's
 * hexes render at least `minHexPxOnPage` wide on the section page. For small
 * maps this is 1×1 (no subdivision); for large maps it scales up.
 *
 * The hex table captures every link section (Towns, Dungeons, Features,
 * Quests, Factions, Encounters Table) plus terrain and description so the
 * printed PDF is a complete offline reference for the map.
 */

import { Notice, TFile, type App } from "obsidian";
import { exportToPdfBytes } from "../pdfExporter";
import { renderMarkdownToHtml } from "../htmlRenderer";
import { ensureExportFolder } from "../exportFolder";
import {
  renderMapToPngBlob,
  type MapPngRenderOptions,
} from "../mapPngRenderer";
import { getAllSectionData } from "../../sections";
import { getTerrainFromFile } from "../../frontmatter";
import { escapeTableCell } from "../../textUtils";
import type HexmakerPlugin from "../../HexmakerPlugin";

export interface MapPdfExportOptions extends MapPngRenderOptions {
  /** Filename stem (no extension). Defaults to mapName. */
  outputName?: string;
  /** Orientation. Defaults to landscape (better for map-heavy docs). */
  landscape?: boolean;
  /** Page size. Defaults to Letter. */
  pageSize?: "A4" | "Letter" | "Legal" | "Tabloid";
  /**
   * Minimum pixel width of a single hex when displayed on a section page.
   * Drives the subdivision count. Default 60.
   */
  minHexPxOnPage?: number;
}

const DEFAULT_MIN_HEX_PX = 60;
// Approximate usable area on a landscape Letter page (after margins) for the
// section-page map view. Tuned with the actual print CSS in printScaffold.ts.
const SECTION_MAP_PAGE_PX = { width: 950, height: 360 };

export async function exportMapAsPdf(
  plugin: HexmakerPlugin,
  mapName: string,
  opts: MapPdfExportOptions = {},
): Promise<void> {
  const folder = await ensureExportFolder(plugin);
  const stem = (opts.outputName ?? mapName).trim() || mapName;
  const outPath = `${folder}/${sanitiseFilename(stem)}.pdf`;

  const notice = new Notice(`Exporting ${stem}.pdf…`, 0);
  try {
    const map = plugin.settings.maps.find((m) => m.name === mapName);
    if (!map) throw new Error(`Map "${mapName}" not found`);

    // 1. Compute subdivisions
    const subdivisions = computeSubdivisions({
      gridCols: map.gridSize.cols,
      gridRows: map.gridSize.rows,
      pageWidthPx: SECTION_MAP_PAGE_PX.width,
      pageHeightPx: SECTION_MAP_PAGE_PX.height,
      minHexPxOnPage: opts.minHexPxOnPage ?? DEFAULT_MIN_HEX_PX,
    });

    // 2. Render the full map for the cover page
    const fullPng = await renderMapToPngBlob(plugin, mapName, opts);
    const fullDataUri = await blobToDataUri(fullPng, "image/png");

    // 3. Render each section's cropped PNG
    const sections = enumerateSections(subdivisions, map.gridSize);
    const sectionImages: string[] = [];
    for (const section of sections) {
      const sectionPng = await renderMapToPngBlob(plugin, mapName, {
        ...opts,
        subgrid: {
          colStart: section.colStart,
          colEnd: section.colEnd,
          rowStart: section.rowStart,
          rowEnd: section.rowEnd,
        },
      });
      sectionImages.push(await blobToDataUri(sectionPng, "image/png"));
    }

    // 4. Build the markdown document
    const md = await buildMapPdfMarkdown(
      plugin,
      mapName,
      fullDataUri,
      sections,
      sectionImages,
    );

    // 5. Render to HTML and PDF
    const rendered = await renderMarkdownToHtml({
      app: plugin.app,
      title: mapName,
      sourcePath: `${mapName}.export.md`,
      markdown: md,
    });
    const pdfBytes = await exportToPdfBytes(rendered, {
      pageSize: opts.pageSize ?? "Letter",
      landscape: opts.landscape ?? true,
      displayHeaderFooter: true,
      footerTemplate: `<div style="width: 100%; font-size: 9px; text-align: center; color: #666;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });

    await writeBinaryToVault(plugin.app, outPath, pdfBytes);
    new Notice(`Exported to ${outPath}`);
    void openInVault(plugin.app, outPath);
  } catch (err) {
    console.error(err);
    new Notice(`Export failed: ${(err as Error).message ?? err}`);
  } finally {
    notice.hide();
  }
}

// ── Subdivision math ──────────────────────────────────────────────────────

export interface SubdivisionParams {
  gridCols: number;
  gridRows: number;
  pageWidthPx: number;
  pageHeightPx: number;
  minHexPxOnPage: number;
}

export interface SubdivisionLayout {
  colSections: number;
  rowSections: number;
  /** Hexes per section (in cols × rows). The last section in each axis may
   *  be smaller; this is the ceiling. */
  hexesPerSectionCol: number;
  hexesPerSectionRow: number;
}

/**
 * Pick the minimum number of sections such that each section's hexes have at
 * least `minHexPxOnPage` of horizontal space on the printed page. Pure.
 */
export function computeSubdivisions(p: SubdivisionParams): SubdivisionLayout {
  const SQRT3_2 = Math.sqrt(3) / 2;
  // The map view on a section page has bounded width/height. Pick the smallest
  // subdivision such that the page can fit (hexesPerSectionCol × hexPx) in
  // its width AND (hexesPerSectionRow × hexPx × √3/2) in its height.
  const maxHexesPerWidth = Math.max(
    1,
    Math.floor(p.pageWidthPx / p.minHexPxOnPage),
  );
  const maxHexesPerHeight = Math.max(
    1,
    Math.floor(p.pageHeightPx / (p.minHexPxOnPage * SQRT3_2)),
  );
  const colSections = Math.max(1, Math.ceil(p.gridCols / maxHexesPerWidth));
  const rowSections = Math.max(1, Math.ceil(p.gridRows / maxHexesPerHeight));
  return {
    colSections,
    rowSections,
    hexesPerSectionCol: Math.ceil(p.gridCols / colSections),
    hexesPerSectionRow: Math.ceil(p.gridRows / rowSections),
  };
}

export interface MapSection {
  /** Human-readable label, e.g. "A1", "A2", "B1". */
  label: string;
  colStart: number;
  colEnd: number; // half-open: hexes in [colStart, colEnd)
  rowStart: number;
  rowEnd: number;
}

/**
 * Enumerate the sections produced by a subdivision in row-major order
 * (left-to-right then top-to-bottom). Labels use column letters A, B, C…
 * and row numbers 1, 2, 3… so the first section is "A1", the one to its
 * right is "B1", and so on. Pure.
 */
export function enumerateSections(
  layout: SubdivisionLayout,
  gridSize: { cols: number; rows: number },
): MapSection[] {
  const out: MapSection[] = [];
  for (let rs = 0; rs < layout.rowSections; rs++) {
    for (let cs = 0; cs < layout.colSections; cs++) {
      const colStart = cs * layout.hexesPerSectionCol;
      const rowStart = rs * layout.hexesPerSectionRow;
      out.push({
        label: `${String.fromCharCode(65 + cs)}${rs + 1}`,
        colStart,
        colEnd: Math.min(gridSize.cols, colStart + layout.hexesPerSectionCol),
        rowStart,
        rowEnd: Math.min(gridSize.rows, rowStart + layout.hexesPerSectionRow),
      });
    }
  }
  return out;
}

// ── Markdown builder ──────────────────────────────────────────────────────

/**
 * Build the full markdown document. Public for unit testing.
 */
export async function buildMapPdfMarkdown(
  plugin: HexmakerPlugin,
  mapName: string,
  fullMapImageUri: string,
  sections: MapSection[],
  sectionImageUris: string[],
): Promise<string> {
  const map = plugin.settings.maps.find((m) => m.name === mapName);
  if (!map) throw new Error(`Map "${mapName}" not found`);

  const lines: string[] = [];

  // ── Page 1: Cover with full map ───────────────────────────────────────
  lines.push(`# ${mapName}`);
  lines.push("");
  lines.push(
    `<img src="${fullMapImageUri}" alt="${escapeHtmlAttr(mapName)} full map" class="duckmage-pdf-fullmap">`,
  );
  lines.push("");

  // ── Page 2: Section TOC ───────────────────────────────────────────────
  lines.push(`<div class="duckmage-pdf-pagebreak"></div>`);
  lines.push("");
  lines.push(`## Section index`);
  lines.push("");
  lines.push("| Section | Hex range (col, row) |");
  lines.push("| --- | --- |");
  for (const s of sections) {
    const { x: ox, y: oy } = map.gridOffset;
    lines.push(
      `| **${s.label}** | (${s.colStart + ox}, ${s.rowStart + oy}) — (${s.colEnd - 1 + ox}, ${s.rowEnd - 1 + oy}) |`,
    );
  }
  lines.push("");

  // ── Pages 3+: One per section ─────────────────────────────────────────
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const imgUri = sectionImageUris[i] ?? "";
    lines.push(`<div class="duckmage-pdf-pagebreak"></div>`);
    lines.push("");
    lines.push(`## Section ${s.label}`);
    lines.push("");
    lines.push(
      `<img src="${imgUri}" alt="${escapeHtmlAttr(mapName)} section ${s.label}" class="duckmage-pdf-sectionmap">`,
    );
    lines.push("");

    const rows = await collectHexRows(plugin, mapName, s);
    if (rows.length === 0) {
      lines.push(`*No hex notes with content in this section.*`);
      continue;
    }
    const headers = [
      "Hex",
      "Terrain",
      "Towns",
      "Dungeons",
      "Features",
      "Quests",
      "Factions",
      "Encounters",
      "Description",
    ];
    lines.push(`| ${headers.join(" | ")} |`);
    lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
    for (const row of rows) {
      const cells = [
        row.hex,
        row.terrain,
        row.towns,
        row.dungeons,
        row.features,
        row.quests,
        row.factions,
        row.encounters,
        row.description,
      ].map(escapeTableCell);
      lines.push(`| ${cells.join(" | ")} |`);
    }
  }
  return lines.join("\n");
}

// ── Hex row collection ────────────────────────────────────────────────────

interface HexRow {
  hex: string;
  terrain: string;
  towns: string;
  dungeons: string;
  features: string;
  quests: string;
  factions: string;
  encounters: string;
  description: string;
}

async function collectHexRows(
  plugin: HexmakerPlugin,
  mapName: string,
  section: MapSection,
): Promise<HexRow[]> {
  const map = plugin.settings.maps.find((m) => m.name === mapName);
  if (!map) return [];

  const out: HexRow[] = [];
  const { x: ox, y: oy } = map.gridOffset;

  for (let row = section.rowStart; row < section.rowEnd; row++) {
    for (let col = section.colStart; col < section.colEnd; col++) {
      const hx = col + ox;
      const hy = row + oy;
      const path = plugin.hexPath(hx, hy, mapName);
      const file = plugin.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;

      const terrain = getTerrainFromFile(plugin.app, path) ?? "";
      const sections = await getAllSectionData(plugin.app, path);
      const description = extractDescriptionExcerpt(sections.text);
      const towns = joinBasenames(sections.links.get("towns"));
      const dungeons = joinBasenames(sections.links.get("dungeons"));
      const features = joinBasenames(sections.links.get("features"));
      const quests = joinBasenames(sections.links.get("quests"));
      const factions = joinBasenames(sections.links.get("factions"));
      const encounters = joinBasenames(
        sections.links.get("encounters table"),
      );
      const empty =
        !terrain &&
        !description &&
        !towns &&
        !dungeons &&
        !features &&
        !quests &&
        !factions &&
        !encounters;
      if (empty) continue;

      out.push({
        hex: `${hx},${hy}`,
        terrain,
        towns,
        dungeons,
        features,
        quests,
        factions,
        encounters,
        description,
      });
    }
  }
  return out;
}

// ── Pure helpers (exported for tests) ─────────────────────────────────────

/**
 * Take the `### Description` section's first paragraph, strip wikilink syntax
 * down to display text, collapse whitespace, and truncate.
 */
export function extractDescriptionExcerpt(text: Map<string, string>): string {
  const desc = text.get("description") ?? "";
  if (!desc) return "";
  const firstPara = desc.split(/\n\s*\n/)[0] ?? "";
  const stripped = firstPara.replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_m: string, target: string, alias: string | undefined) => {
      if (alias) return alias;
      const slash = target.lastIndexOf("/");
      return (slash >= 0 ? target.slice(slash + 1) : target).replace(
        /\.md$/i,
        "",
      );
    },
  );
  return truncate(stripped.replace(/\s+/g, " ").trim(), 140);
}

/**
 * Join wikilink targets down to basenames, comma-separated. Pure.
 */
export function joinBasenames(items: string[] | undefined): string {
  if (!items || items.length === 0) return "";
  return items
    .map((item) => {
      const slash = item.lastIndexOf("/");
      const stem = slash >= 0 ? item.slice(slash + 1) : item;
      return stem.replace(/\.md$/i, "");
    })
    .join(", ");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)).trimEnd() + "…";
}


function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function sanitiseFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

export async function blobToDataUri(blob: Blob, type: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return `data:${type};base64,${btoa(parts.join(""))}`;
}

export async function writeBinaryToVault(
  app: App,
  path: string,
  data: Uint8Array,
): Promise<void> {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modifyBinary(existing, buf);
  } else {
    await app.vault.createBinary(path, buf);
  }
}

export async function openInVault(app: App, path: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    await app.workspace.getLeaf(false).openFile(file);
  }
}
