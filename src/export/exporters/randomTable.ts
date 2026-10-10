/**
 * Random table exporter (Phase 1, item 1.1).
 *
 * Generates a printable one-pager from a random table file:
 *   # Table name
 *   *d100*
 *   description
 *   | d20 | Result | Weight |   (| # | Result | … | with no die)
 *   ...
 *
 * Two output paths share the same generated markdown:
 *   - PDF:  renderMarkdownToHtml → exportToPdfBytes → vault.createBinary
 *   - MD:   write the markdown directly
 */

import { Notice, TFile, type App } from "obsidian";
import { exportToPdfBytes } from "../pdfExporter";
import { renderMarkdownToHtml } from "../htmlRenderer";
import { ensureExportFolder } from "../exportFolder";
import { serializeMarkdown, stripFrontmatter } from "../mdSerializer";
import {
  type RandomTable,
  type RandomTableEntry,
  parseRandomTable,
  rangeCellTexts,
  dieLabel,
} from "../../random-tables/randomTable";
import { escapeTableCell } from "../../textUtils";
import { normalizeFolder } from "../../utils";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { openExported } from "../exportFolder";

/** A linked note resolved to its display name + content (frontmatter stripped). */
export interface LinkedNote {
  name: string;
  content: string;
}

export async function exportRandomTableAsPdf(
  plugin: HexmakerPlugin,
  file: TFile,
): Promise<void> {
  const md = await buildExportMarkdown(plugin.app, file);
  const folder = await ensureExportFolder(plugin);
  const outPath = `${folder}/${file.basename}.pdf`;

  const notice = new Notice(`Exporting ${file.basename}.pdf…`, 0);
  try {
    const rendered = await renderMarkdownToHtml({
      app: plugin.app,
      title: file.basename,
      sourcePath: file.path,
      markdown: md,
    });
    const bytes = await exportToPdfBytes(rendered, {
      pageSize: "Letter",
      displayHeaderFooter: true,
      footerTemplate: `<div style="width: 100%; font-size: 9px; text-align: center; color: #666;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
    await writeBinaryToVault(plugin.app, outPath, bytes);
    new Notice(`Exported to ${outPath}`);
    void openInVault(plugin.app, outPath);
  } catch (err) {
    console.error(err);
    new Notice(`Export failed: ${(err as Error).message ?? err}`);
  } finally {
    notice.hide();
  }
}

export async function exportRandomTableAsMarkdown(
  plugin: HexmakerPlugin,
  file: TFile,
): Promise<void> {
  const md = await buildExportMarkdown(plugin.app, file);
  const folder = await ensureExportFolder(plugin);
  const outPath = `${folder}/${file.basename}.md`;

  try {
    const finalMd = serializeMarkdown(md, { wikilinks: "preserve" });
    await writeTextToVault(plugin.app, outPath, finalMd);
    new Notice(`Exported to ${outPath}`);
    void openInVault(plugin.app, outPath);
  } catch (err) {
    console.error(err);
    new Notice(`Export failed: ${(err as Error).message ?? err}`);
  }
}

/** Generate the export markdown for a random table file. */
async function buildExportMarkdown(app: App, file: TFile): Promise<string> {
  const content = await app.vault.read(file);
  const table = parseRandomTable(content);
  const baseMd = formatRandomTableMarkdown(file.basename, table);
  const linkedNotes = await loadLinkedNotesForTable(app, file, table);
  const appendix = formatLinkedNotesAppendix(linkedNotes);
  return appendix ? `${baseMd}\n\n${appendix}` : baseMd;
}

/**
 * Resolve each table entry to its backing note (if any) and read the content.
 * Order is preserved; unresolved entries are skipped silently. Frontmatter is
 * stripped from each note so the embed reads as content, not metadata.
 */
async function loadLinkedNotesForTable(
  app: App,
  sourceFile: TFile,
  table: RandomTable,
): Promise<LinkedNote[]> {
  const out: LinkedNote[] = [];
  for (const entry of table.entries) {
    const file = resolveEntryNote(app, table, entry, sourceFile.path);
    if (!file) continue;
    try {
      const raw = await app.vault.read(file);
      out.push({ name: file.basename, content: stripFrontmatter(raw) });
    } catch (err) {
      console.warn(`Failed to read linked note ${file.path}:`, err);
    }
  }
  return out;
}

/**
 * Resolve a single entry to its TFile, handling both wiki-link entries and
 * linkedFolder-driven tables. Returns null when no matching file exists.
 */
function resolveEntryNote(
  app: App,
  table: RandomTable,
  entry: RandomTableEntry,
  sourcePath: string,
): TFile | null {
  if (table.linkedFolder) {
    const folder = normalizeFolder(table.linkedFolder);
    // Strip any .md the user may have included in the entry.
    const stem = entry.result.replace(/\.md$/i, "");
    const path = folder ? `${folder}/${stem}.md` : `${stem}.md`;
    const f = app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? f : null;
  }
  if (entry.isLink) {
    return app.metadataCache.getFirstLinkpathDest(entry.result, sourcePath);
  }
  return null;
}

/**
 * Format a list of linked notes as a markdown appendix. Each entry is wrapped
 * in a `<section class="duckmage-export-note">` so the whole entry (heading +
 * content + any images) can be kept together via `break-inside: avoid-page`
 * — preventing the heading from being orphaned at the bottom of a page when
 * the rest of the content wouldn't fit.
 *
 * The first section is tagged with an extra class so its top border can
 * visually mark the appendix-start (separating it from the table above).
 * Subsequent sections use a lighter border for inter-entry separation; all
 * styling lives in printScaffold.ts.
 *
 * Pure — exported for unit + integration tests.
 */
export function formatLinkedNotesAppendix(notes: LinkedNote[]): string {
  if (notes.length === 0) return "";
  const sections = notes.map((n, i) => {
    const cls = i === 0
      ? "duckmage-export-note duckmage-export-note-first"
      : "duckmage-export-note";
    return (
      `<section class="${cls}">\n\n` +
      `## ${n.name}\n\n` +
      `${n.content.trim()}\n\n` +
      `</section>`
    );
  });
  return sections.join("\n\n");
}

export function formatRandomTableMarkdown(name: string, table: RandomTable): string {
  const lines: string[] = [];
  lines.push(`# ${name}`);
  lines.push("");
  if (table.dice > 0) {
    lines.push(`*Roll d${table.dice}*`);
    lines.push("");
  }
  if (table.description) {
    lines.push(table.description.trim());
    lines.push("");
  }

  // The ranges the table rolls (as stored in the note, blanks filled), so
  // the export reads back as the same table (round trip).
  const ranges = table.dice > 0 ? rangeCellTexts(table.dice, table.entries, "keep") : null;
  // With a die the Weight column is always kept: ranges alone don't carry it.
  const hasWeights = !!ranges || table.entries.some((e) => e.weight !== 1);

  // Columns: dN (die range) OR # (row index), Result, Weight.
  // Odds are intentionally omitted — readers can eyeball the ranges/weights.
  const headerCells = ranges ? [dieLabel(table.dice), "Result"] : ["#", "Result"];
  if (hasWeights) headerCells.push("Weight");

  lines.push(`| ${headerCells.join(" | ")} |`);
  lines.push(`| ${headerCells.map(() => "---").join(" | ")} |`);

  table.entries.forEach((entry, i) => {
    const firstCol = ranges ? ranges[i] : String(i + 1);
    const cells = [firstCol, escapeTableCell(entry.isLink ? `[[${entry.result}]]` : entry.result)];
    if (hasWeights) cells.push(String(entry.weight));
    lines.push(`| ${cells.join(" | ")} |`);
  });

  return lines.join("\n");
}


async function writeBinaryToVault(
  app: App,
  path: string,
  data: Uint8Array,
): Promise<void> {
  // vault.createBinary / modifyBinary require a plain ArrayBuffer.
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
