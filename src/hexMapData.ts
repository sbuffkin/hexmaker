/**
 * The "Map data" callout in a hex note: what the map says about this hex
 * (its map and coordinates, terrain, region, name), written into the note
 * so the raw text shows what the plugin shows.
 *
 *   > [!hexmaker] Map data
 *   > Map: [[_the-coast|the-coast]], hex 0, 1
 *   > Terrain: desert rocky
 *   > Region: Dustbowl
 *   > Name: —
 *
 * The map note is where these live; the callout is a copy the plugin keeps
 * up to date when it creates the note, opens it in the hex editor, or runs
 * "Update map data in hex notes". The built-in hex template has the
 * callout; notes without one only get it from that command, so a user's
 * own notes and templates aren't changed behind their back.
 */

export const MAP_DATA_CALLOUT = "[!hexmaker]";

/** Placeholder the built-in template carries until the note is filled in. */
export const MAP_DATA_TEMPLATE = `> ${MAP_DATA_CALLOUT} Map data\n> Filled in from the map by Hexmaker.`;

export interface HexMapDataView {
  /** Map (folder) name, for the link to its map note. */
  map: string;
  /** How the map is shown (its display name). */
  mapLabel: string;
  x: number;
  y: number;
  terrain?: string;
  region?: string;
  name?: string;
}

const NONE = "—";

/** The callout's lines for this hex. */
export function mapDataLines(d: HexMapDataView): string[] {
  return [
    `> ${MAP_DATA_CALLOUT} Map data`,
    `> Map: [[_${d.map}|${d.mapLabel.replace(/[|[\]]/g, "")}]], hex ${d.x}, ${d.y}`,
    `> Terrain: ${d.terrain || NONE}`,
    `> Region: ${d.region || NONE}`,
    `> Name: ${d.name || NONE}`,
  ];
}

interface CalloutSpan { start: number; end: number }

/** The callout's line span (start inclusive, end exclusive), or null. */
function findCallout(lines: string[]): CalloutSpan | null {
  const start = lines.findIndex((l) => /^\s*>\s*\[!hexmaker\]/i.test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && /^\s*>/.test(lines[end])) end++;
  return { start, end };
}

/** Does the note have a Map data callout? */
export function hasMapData(content: string): boolean {
  return findCallout(content.replace(/\r\n?/g, "\n").split("\n")) !== null;
}

/**
 * The note with its Map data callout showing `d`. A note without one is
 * returned unchanged unless `insert`, when the callout goes under the
 * title (or the frontmatter). Unchanged content is returned as is.
 */
export function setMapData(content: string, d: HexMapDataView, insert = false): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const block = mapDataLines(d);
  const span = findCallout(lines);
  if (span) {
    const current = lines.slice(span.start, span.end);
    if (current.length === block.length && current.every((l, i) => l.trimEnd() === block[i])) return content;
    lines.splice(span.start, span.end - span.start, ...block);
    return lines.join(eol);
  }
  if (!insert) return content;
  let at = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (close > 0) at = close + 1;
  }
  const title = lines.findIndex((l, i) => i >= at && /^#\s/.test(l));
  if (title >= 0) at = title + 1;
  // A blank line on each side, unless there already is one.
  const before = at > 0 && lines[at - 1]?.trim() !== "" ? [""] : [];
  const after = lines[at] !== undefined && lines[at].trim() !== "" ? [""] : [];
  lines.splice(at, 0, ...before, ...block, ...after);
  return lines.join(eol);
}

/** The values written in the callout (a person may have edited them), or null without one. */
export function readMapData(content: string): { terrain?: string; region?: string; name?: string } | null {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const span = findCallout(lines);
  if (!span) return null;
  const out: { terrain?: string; region?: string; name?: string } = {};
  for (const l of lines.slice(span.start + 1, span.end)) {
    const m = /^\s*>\s*(terrain|region|name)\s*:\s*(.*?)\s*$/i.exec(l);
    if (!m) continue;
    const v = m[2].replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_a, t: string, alias?: string) => alias ?? t).trim();
    if (v && v !== NONE && v !== "-") out[m[1].toLowerCase() as "terrain" | "region" | "name"] = v;
  }
  return out;
}
