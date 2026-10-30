/**
 * Single-note exporter (Phase 1, item 1.2).
 *
 * Targets any markdown note in the vault. Same code path for towns, dungeons,
 * quests, features, factions, hex notes — they're all just `.md` files.
 *
 * The export pipeline:
 *   1. Read the file
 *   2. Strip frontmatter (metadata, not content)
 *   3. Prepend `# {basename}` if the note has no leading H1 (so every export
 *      has a styled title at the top)
 *   4. PDF path:  renderMarkdownToHtml → exportToPdfBytes → vault.createBinary
 *   5. MD path:   serializeMarkdown (wikilink mode) → vault.create
 */

import { Notice, TFile, type App } from "obsidian";
import { exportToPdfBytes } from "../pdfExporter";
import { renderMarkdownToHtml } from "../htmlRenderer";
import { ensureExportFolder } from "../exportFolder";
import { serializeMarkdown, stripFrontmatter } from "../mdSerializer";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { withExportProvenance } from "../exportFolder";
import { announceExport, reportExportFailure, saveExport } from "../vaultWrite";

export async function exportSingleNoteAsPdf(
  plugin: HexmakerPlugin,
  file: TFile,
): Promise<void> {
  const md = await buildSingleNoteMarkdown(plugin.app, file);
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
    announceExport(plugin.app, await saveExport(plugin.app, outPath, bytes));
  } catch (err) {
    reportExportFailure(err);
  } finally {
    notice.hide();
  }
}

export async function exportSingleNoteAsMarkdown(
  plugin: HexmakerPlugin,
  file: TFile,
): Promise<void> {
  const md = await buildSingleNoteMarkdown(plugin.app, file);
  const folder = await ensureExportFolder(plugin);
  const outPath = `${folder}/${file.basename}.md`;

  try {
    const finalMd = serializeMarkdown(md, { wikilinks: "preserve" });
    // Where it came from, in its frontmatter (X1).
    announceExport(plugin.app, await saveExport(plugin.app, outPath, withExportProvenance(finalMd, file.path, "note")));
  } catch (err) {
    reportExportFailure(err);
  }
}

/**
 * Read the note, strip frontmatter, and prepend a title if missing. Exported
 * indirectly via `ensureLeadingTitle` for test coverage.
 */
async function buildSingleNoteMarkdown(app: App, file: TFile): Promise<string> {
  const raw = await app.vault.read(file);
  return ensureLeadingTitle(raw, file.basename);
}

/**
 * Strip frontmatter and ensure the note begins with an `# H1` title. If the
 * content already starts with an H1, keep it as-is. Otherwise prepend
 * `# {basename}` so every exported note gets a styled title.
 *
 * Pure — exported for unit tests.
 */
export function ensureLeadingTitle(raw: string, basename: string): string {
  const stripped = stripFrontmatter(raw).replace(/^\s+/, "");
  if (/^# /.test(stripped)) return stripped;
  if (stripped.length === 0) return `# ${basename}`;
  return `# ${basename}\n\n${stripped}`;
}
