/**
 * Single-hex exporter (Phase 1, item 1.5).
 *
 * Renders one hex note as a fully-structured PDF with each section as its own
 * generously-spaced block. Unlike the generic single-note exporter (1.2), this
 * one *knows* about hex semantics:
 *
 *   - Coordinate + terrain header at the top (pulled from filename + frontmatter)
 *   - Each section wrapped in `<section class="duckmage-hex-section">` with
 *     CSS spacing + break-inside: avoid-page so a section never splits across
 *     a page boundary
 *   - GM-only sections (Hidden, Secret) gated behind an explicit toggle
 *   - Section rendering order driven by HEX_SECTIONS — the extension point
 *     for adding more (e.g. related random tables, rolled encounter samples)
 */

import { Notice, TFile, type App } from "obsidian";
import { exportToPdfBytes } from "../pdfExporter";
import { renderMarkdownToHtml } from "../htmlRenderer";
import { ensureExportFolder } from "../exportFolder";
import { serializeMarkdown } from "../mdSerializer";
import { getAllSectionData } from "../../sections";
import { getTerrainFromFile } from "../../frontmatter";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { openExported } from "../exportFolder";

/**
 * Hex section descriptor. To add a new section to the export:
 *   1. Add an entry here in the order you want it to appear
 *   2. If it needs data beyond what `getAllSectionData` returns, extend
 *      `HexSectionContext` and pass the data in via the builder
 *   3. If it's GM-only (private), set `gmOnly: true`
 */
export interface HexSectionDef {
  /** Lowercase id — matches `getAllSectionData`'s key */
  id: string;
  /** Display heading shown in the PDF */
  title: string;
  /** Whether the section content is text (raw markdown) or a link list */
  kind: "text" | "links";
  /** True for private / GM-only sections (Hidden, Secret) */
  gmOnly?: boolean;
}

export const HEX_SECTIONS: HexSectionDef[] = [
  { id: "description", title: "Description", kind: "text" },
  { id: "landmark", title: "Landmark", kind: "text" },
  { id: "weather", title: "Weather", kind: "text" },
  { id: "hooks & rumors", title: "Hooks & Rumors", kind: "text" },
  { id: "hidden", title: "Hidden", kind: "text", gmOnly: true },
  { id: "secret", title: "Secret", kind: "text", gmOnly: true },
  { id: "towns", title: "Towns", kind: "links" },
  { id: "dungeons", title: "Dungeons", kind: "links" },
  { id: "features", title: "Features", kind: "links" },
  { id: "quests", title: "Quests", kind: "links" },
  { id: "factions", title: "Factions", kind: "links" },
  { id: "encounters table", title: "Encounters Table", kind: "links" },
];

export interface SingleHexExportOptions {
  /** Filename stem (no extension). Defaults to hex file basename. */
  outputName?: string;
  /** Include GM-only sections (Hidden, Secret). Default false. */
  includeGmSections?: boolean;
  /** Section ids to skip explicitly. Default empty. */
  excludeSections?: Set<string>;
}

export async function exportHexAsPdf(
  plugin: HexmakerPlugin,
  hexFile: TFile,
  opts: SingleHexExportOptions = {},
): Promise<void> {
  const folder = await ensureExportFolder(plugin);
  const stem =
    (opts.outputName ?? hexFile.basename).trim() || hexFile.basename;
  const outPath = `${folder}/${sanitiseFilename(stem)}.pdf`;

  const notice = new Notice(`Exporting ${stem}.pdf…`, 0);
  try {
    const md = await buildHexMarkdown(plugin, hexFile, opts);
    const rendered = await renderMarkdownToHtml({
      app: plugin.app,
      title: hexFile.basename,
      sourcePath: hexFile.path,
      markdown: md,
    });
    const pdfBytes = await exportToPdfBytes(rendered, {
      pageSize: "Letter",
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

export async function exportHexAsMarkdown(
  plugin: HexmakerPlugin,
  hexFile: TFile,
  opts: SingleHexExportOptions = {},
): Promise<void> {
  const folder = await ensureExportFolder(plugin);
  const stem =
    (opts.outputName ?? hexFile.basename).trim() || hexFile.basename;
  const outPath = `${folder}/${sanitiseFilename(stem)}.md`;
  try {
    const md = await buildHexMarkdown(plugin, hexFile, opts);
    const finalMd = serializeMarkdown(md, { wikilinks: "preserve" });
    await writeTextToVault(plugin.app, outPath, finalMd);
    new Notice(`Exported to ${outPath}`);
    void openInVault(plugin.app, outPath);
  } catch (err) {
    console.error(err);
    new Notice(`Export failed: ${(err as Error).message ?? err}`);
  }
}

/**
 * Build the markdown document for a hex export. Walks HEX_SECTIONS in order,
 * including each section that has content (and isn't gated by `gmOnly` /
 * `excludeSections`). Exported for unit tests.
 */
export async function buildHexMarkdown(
  plugin: HexmakerPlugin,
  hexFile: TFile,
  opts: SingleHexExportOptions = {},
): Promise<string> {
  const app = plugin.app;
  const lines: string[] = [];

  // Title — uses the file basename so notes with custom names show that name,
  // and "0_0" style notes fall back to their coord pattern.
  lines.push(`# ${hexFile.basename}`);
  lines.push("");

  // Metadata header: coord (parsed from basename) + terrain (frontmatter).
  // Renders as a `**key:** value` block so it's visually distinct from
  // section bodies. Markdown's two-space line-break (`  \n`) keeps the
  // entries on consecutive lines.
  const meta = collectMetadata(app, hexFile);
  if (meta.length > 0) {
    lines.push(meta.map((m) => `**${m.label}:** ${m.value}`).join("  \n"));
    lines.push("");
  }

  // Section bodies
  const data = await getAllSectionData(app, hexFile.path);
  for (const section of HEX_SECTIONS) {
    if (section.gmOnly && !opts.includeGmSections) continue;
    if (opts.excludeSections?.has(section.id)) continue;
    const block = renderSectionBlock(section, data);
    if (block) lines.push(block);
  }
  return lines.join("\n");
}

interface MetadataItem {
  label: string;
  value: string;
}

function collectMetadata(app: App, hexFile: TFile): MetadataItem[] {
  const items: MetadataItem[] = [];
  const coord = parseHexCoord(hexFile.basename);
  if (coord) items.push({ label: "Coordinate", value: `${coord.x}, ${coord.y}` });
  const terrain = getTerrainFromFile(app, hexFile.path);
  if (terrain) items.push({ label: "Terrain", value: terrain });
  return items;
}

/**
 * Render one HEX_SECTIONS entry as a markdown block, or return null when the
 * section has no content. Pure.
 */
export function renderSectionBlock(
  section: HexSectionDef,
  data: { text: Map<string, string>; links: Map<string, string[]> },
): string | null {
  if (section.kind === "text") {
    const text = (data.text.get(section.id) ?? "").trim();
    if (!text) return null;
    return wrapInSection(section.title, text);
  }
  const links = data.links.get(section.id) ?? [];
  if (links.length === 0) return null;
  const body = links.map((l) => `- [[${l}]]`).join("\n");
  return wrapInSection(section.title, body);
}

/**
 * Wrap a heading + body in a `<section class="duckmage-hex-section">` block.
 * Same approach as the linked-notes appendix: the wrapping div lets the print
 * CSS apply break-inside: avoid-page + visible separation between sections.
 */
function wrapInSection(title: string, body: string): string {
  return (
    `<section class="duckmage-hex-section">\n\n` +
    `## ${title}\n\n` +
    `${body}\n\n` +
    `</section>\n`
  );
}

/**
 * Parse a hex coord from a filename like "5_-3" → {x: 5, y: -3}. Returns
 * null for any other shape (custom-named hex notes, sub-named files, …).
 */
export function parseHexCoord(
  basename: string,
): { x: number; y: number } | null {
  const m = /^(-?\d+)_(-?\d+)$/.exec(basename);
  if (!m) return null;
  return { x: parseInt(m[1], 10), y: parseInt(m[2], 10) };
}

// ── File-IO helpers ──────────────────────────────────────────────────────

function sanitiseFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

async function writeBinaryToVault(
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

async function writeTextToVault(
  app: App,
  path: string,
  data: string,
): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, data);
  } else {
    await app.vault.create(path, data);
  }
}

async function openInVault(app: App, path: string): Promise<void> {
  await openExported(app, path);
}
