/**
 * The "Map data" callout in a region or faction note (R1): where the map
 * uses it, written into the note so the raw text shows it.
 *
 *   > [!hexmaker] Map data
 *   > Maps: [[_the-coast|The Coast]] (12 hexes), [[_hills|Hills]] (1 hex)
 *   > Encounter table: [[world/tables/regions/Dustbowl|Dustbowl]]
 *
 * Regions: the hexes whose Region is this note's name, per map, and the
 * region's encounter table. Factions: the hex notes that link the faction,
 * per map. The map notes and hex notes are the truth; this is a copy the
 * plugin refreshes when the note is opened and by the "Update map data in
 * region and faction notes" command (which also adds it to notes that
 * lack one). Hand edits inside it are overwritten; nothing outside it is
 * touched. Pure: no Obsidian imports.
 */

import { MAP_DATA_CALLOUT } from "./hexMapData";

export interface MapUse {
  /** Map (folder) name, for the link to its map note. */
  map: string;
  /** The map's display name. */
  label: string;
  hexes: number;
}

export interface RegionMapDataView {
  kind: "region" | "faction";
  /** Maps using it, with how many hexes (maps with none left out). */
  maps: MapUse[];
  /** Regions: link text of the region's encounter table, if it has one. */
  encounterTable?: string;
}

const NONE = "—";
const clean = (s: string) => s.replace(/[|[\]]/g, "");

/** The callout's lines. */
export function regionMapDataLines(v: RegionMapDataView): string[] {
  const maps = v.maps.length
    ? v.maps.map((m) => `[[_${m.map}|${clean(m.label)}]] (${m.hexes} ${m.hexes === 1 ? "hex" : "hexes"})`).join(", ")
    : NONE;
  const lines = [`> ${MAP_DATA_CALLOUT} Map data`, `> Maps: ${maps}`];
  if (v.kind === "region") {
    const t = v.encounterTable;
    lines.push(`> Encounter table: ${t ? `[[${t}|${clean(t.split("/").pop() ?? t)}]]` : NONE}`);
  }
  return lines;
}

interface Span { start: number; end: number }

function findCallout(lines: string[]): Span | null {
  const start = lines.findIndex((l) => /^\s*>\s*\[!hexmaker\]/i.test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && /^\s*>/.test(lines[end])) end++;
  return { start, end };
}

/** Does the note have a Map data callout? */
export function hasRegionMapData(content: string): boolean {
  return findCallout(content.replace(/\r\n?/g, "\n").split("\n")) !== null;
}

/**
 * The note with its Map data callout showing `v`. Without one, the note is
 * returned unchanged unless `insert`, when the callout goes under the
 * title (or the frontmatter). Unchanged content is returned as is.
 */
export function setRegionMapData(content: string, v: RegionMapDataView, insert = false): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const block = regionMapDataLines(v);
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
  const before = at > 0 && lines[at - 1]?.trim() !== "" ? [""] : [];
  const after = lines[at] !== undefined && lines[at].trim() !== "" ? [""] : [];
  lines.splice(at, 0, ...before, ...block, ...after);
  return lines.join(eol);
}

/**
 * How many hexes of each map have this region (by name, ignoring case and
 * a [[link]] around it). Maps are in the order given; maps with none are
 * left out.
 */
export function regionUse(
  region: string,
  maps: { name: string; label: string }[],
  hexesOf: (map: string) => Iterable<{ region?: string }>,
): MapUse[] {
  const want = normRegion(region);
  const out: MapUse[] = [];
  const seen = new Set<string>();
  for (const m of maps) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    let n = 0;
    for (const h of hexesOf(m.name)) if (h.region && normRegion(h.region) === want) n++;
    if (n) out.push({ map: m.name, label: m.label, hexes: n });
  }
  return out;
}

/** A Region value compared by name: "[[regions/Dustbowl|Dust]]" and "dustbowl" are the same. */
export function normRegion(v: string): string {
  const link = /^\s*\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]\s*$/.exec(v);
  const name = link ? link[1].split("/").pop()! : v;
  return name.replace(/\.md$/i, "").trim().toLowerCase();
}

/**
 * The Region value to write when a region note is renamed, or null when
 * `value` isn't that region. A plain name becomes the new name; a link
 * keeps its form with the new name (Obsidian's own link updating covers
 * links in note text, not values in map notes).
 */
export function renamedRegionValue(value: string, oldName: string, newName: string): string | null {
  if (normRegion(value) !== normRegion(oldName)) return null;
  const link = /^(\s*\[\[)([^\]|#]+)((?:[#|][^\]]*)?\]\]\s*)$/.exec(value);
  if (!link) return newName;
  const parts = link[2].split("/");
  parts[parts.length - 1] = newName;
  return `${link[1]}${parts.join("/")}${link[3]}`;
}

/**
 * The `token-map` value after a map is renamed, or null when it names
 * another map. Accepts the map's name or a link to its map note
 * ("[[_name]]"), keeping the form it found.
 */
export function renamedTokenMap(value: unknown, oldName: string, newName: string): string | null {
  if (typeof value !== "string") return null;
  if (value.trim() === oldName) return newName;
  const link = /^(\s*\[\[)([^\]|#]+)((?:[#|][^\]]*)?\]\]\s*)$/.exec(value);
  if (!link) return null;
  const parts = link[2].split("/");
  const base = parts[parts.length - 1].replace(/\.md$/i, "");
  if (base !== `_${oldName}` && base !== oldName) return null;
  parts[parts.length - 1] = base.startsWith("_") ? `_${newName}` : newName;
  return `${link[1]}${parts.join("/")}${link[3]}`;
}

/** What renameRegionInStore needs from the map store (its public reads and set). */
export interface RegionStore {
  all(map: string): ReadonlyMap<string, { region?: string }>;
  set(map: string, key: string, patch: { region?: string | null }): void;
}

/**
 * A region note was renamed: every hex whose Region named it gets the new
 * name, through the store's set (so the map notes are rewritten the usual
 * way). Returns how many hexes changed.
 */
export function renameRegionInStore(store: RegionStore, maps: string[], oldName: string, newName: string): number {
  if (!oldName || !newName || oldName === newName) return 0;
  let n = 0;
  for (const map of new Set(maps)) {
    for (const [key, h] of [...store.all(map)]) {
      if (!h.region) continue;
      const next = renamedRegionValue(h.region, oldName, newName);
      if (next === null || next === h.region) continue;
      store.set(map, key, { region: next });
      n++;
    }
  }
  return n;
}
