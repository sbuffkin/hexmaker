import type { MarkdownPostProcessorContext } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { PathType } from "../types";
import { buildPathPreviewSvg } from "../hex-map/pathPreviewSvg";
import { createIconEl, getIconUrl } from "../utils";
import { parsePaletteNote, PALETTE_NOTE_MARKER } from "./paletteNote";
import { parsePathTypes } from "./pathTypeTable";

// Reading view for palette notes: a colour swatch beside each Color cell, an
// icon thumbnail beside each Icon cell, and a line-style preview in the Path
// types table. Display only: the note's text is never changed, and the
// tables are read with the same parsers the plugin uses, so what's drawn is
// what the plugin takes from the note.

/** A table as plain text, rebuilt as markdown so the note parsers can read it. */
export function tableMarkdown(headers: string[], rows: string[][]): string {
  const esc = (c: string) => c.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  return [
    `| ${headers.map(esc).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
  ].join("\n");
}

export type PaletteTableView =
  | {
      kind: "terrains";
      color: number;
      icon: number;
      /** Icon tint per row (by terrain name, lower case). */
      tints: Map<string, string>;
      name: number;
    }
  | { kind: "paths"; name: number; types: Map<string, PathType> }
  | null;

const headerIndex = (headers: string[], re: RegExp) => headers.findIndex((h) => re.test(h.trim()));

/**
 * What a table in a palette note is (the terrain table, the path types
 * table, or neither) and where its decorated columns are.
 */
export function classifyPaletteTable(headers: string[], rows: string[][]): PaletteTableView {
  const md = tableMarkdown(headers, rows);
  const terrains = parsePaletteNote(md);
  if (terrains) {
    return {
      kind: "terrains",
      name: headerIndex(headers, /^(terrain|name)$/i),
      color: headerIndex(headers, /^colou?r$/i),
      icon: headerIndex(headers, /^icon$/i),
      tints: new Map(terrains.filter((t) => t.iconColor).map((t) => [t.name.toLowerCase(), t.iconColor!])),
    };
  }
  const paths = parsePathTypes(md);
  if (paths) {
    return {
      kind: "paths",
      name: headerIndex(headers, /^(path|paths|path type|name|type)$/i),
      types: new Map(paths.types.map((t) => [t.name, t])),
    };
  }
  return null;
}

/** Whether a note (by its frontmatter) is a palette note. */
export function isPaletteFrontmatter(fm: unknown): boolean {
  return !!fm && typeof fm === "object" && PALETTE_NOTE_MARKER in fm;
}

function decorateTable(plugin: HexmakerPlugin, table: HTMLTableElement): void {
  if (table.hasClass("duckmage-palette-table")) return;
  const headers = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
  const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
  const cellsOf = (tr: Element) => Array.from(tr.querySelectorAll("td"));
  const rows = bodyRows.map((tr) => cellsOf(tr).map((td) => td.textContent?.trim() ?? ""));
  const view = classifyPaletteTable(headers, rows);
  if (!view) return;
  table.addClass("duckmage-palette-table");
  bodyRows.forEach((tr, r) => {
    const tds = cellsOf(tr);
    if (view.kind === "terrains") {
      const color = rows[r][view.color];
      const colorCell = tds[view.color];
      // An unreadable colour leaves the swatch empty (the custom property is
      // invalid, so the background falls back to transparent).
      if (colorCell && color) {
        const swatch = colorCell.createSpan({ cls: "duckmage-palette-swatch", attr: { "aria-hidden": "true" } });
        swatch.setCssProps({ "--duckmage-palette-swatch": color });
        colorCell.prepend(swatch);
        colorCell.addClass("duckmage-palette-color-cell");
      }
      const icon = view.icon >= 0 ? rows[r][view.icon] : "";
      const iconCell = tds[view.icon];
      if (iconCell && icon) {
        const holder = iconCell.createSpan({ cls: "duckmage-palette-icon" });
        const tint = view.tints.get((rows[r][view.name] ?? "").toLowerCase());
        createIconEl(holder, getIconUrl(plugin, icon), icon, tint, "duckmage-palette-icon-img");
        iconCell.prepend(holder);
      }
    } else {
      const pt = view.types.get(rows[r][view.name] ?? "");
      const nameCell = tds[view.name];
      if (pt && nameCell) {
        const holder = nameCell.createSpan({ cls: "duckmage-palette-path-preview", attr: { "aria-hidden": "true" } });
        holder.appendChild(buildPathPreviewSvg(pt));
        nameCell.prepend(holder);
      }
    }
  });
}

/** Register the reading-view decorations for palette notes. */
export function registerPaletteReadingView(plugin: HexmakerPlugin): void {
  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const tables = el.querySelectorAll("table");
    if (!tables.length) return;
    const fm: unknown = ctx.frontmatter ?? plugin.app.metadataCache.getCache(ctx.sourcePath)?.frontmatter;
    if (!isPaletteFrontmatter(fm)) return;
    tables.forEach((t) => decorateTable(plugin, t));
  });
}
