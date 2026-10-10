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
import { openExported } from "../exportFolder";

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

export async function exportSingleNoteAsMarkdown(
  plugin: HexmakerPlugin,
  file: TFile,
): Promise<void> {
  const md = await buildSingleNoteMarkdown(plugin.app, file);
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
