import type { MapData, PathChain } from "../types";

/**
 * Map notes: one note per map ("hexes/<map>/_<map>.md") holding the map's
 * settings in frontmatter, every hex's map data in a "Hexes" table, and its
 * roads/rivers in a "Paths" table. Hex notes only hold prose and links —
 * a hex without content has no note at all.
 *
 *   ---
 *   hexmaker-map: 2
 *   palette: Default
 *   cols: 38
 *   rows: 25
 *   parent: "[[_the-north]]"
 *   parent-hex: 3, 4
 *   …
 *   ---
 *   # The Coast
 *   > [!info]- How to edit this note
 *   ## Hexes
 *   | Hex | Name | Terrain | Icon | GM icons | Region | Submap | Locked |
 *   | 3_4 | Glass Wastes | dunes |  |  | Basin |  |  |
 *   ## Paths
 *   | Type | Hexes |
 *   | Road | 3_4 4_4 5_4 |
 *
 * Written to be read and edited by people (#42):
 * - every setting is one plain key (no JSON); other notes and images are
 *   wikilinks, so Obsidian keeps them right when files are renamed;
 * - reading is forgiving: Obsidian's Properties panel rewriting keys as
 *   block YAML, header case/spacing, column order, a missing `|---|` row,
 *   `3, 4` for `3_4`, yes/true/x/✓ … all read, and the next write puts them
 *   back in the usual form without changing any value;
 * - nothing a person typed is dropped: rows and settings that can't be read
 *   stay exactly as written and are listed in a warning callout (cleared
 *   once fixed); text outside the tables, and frontmatter keys this file
 *   doesn't own, are the user's and survive rewrites;
 * - notes written before this format (`hexmaker-map: 1`, JSON values) still
 *   read and are converted on their next write (MapStore backs them up
 *   first). The 1.5.6 compat fixture pins the old form.
 */

export const MAP_NOTE_MARKER = "hexmaker-map";
/** Format written by this build (the marker's value). 1 = JSON values. */
export const MAP_NOTE_FORMAT = 2;

/** Map data for one hex. Absent fields = nothing set. */
export interface HexData {
  /** The hex's own name ("Glass Wastes"): shown on the map, and its note's alias. */
  name?: string;
  terrain?: string;
  icon?: string;
  gmIcons?: string[];
  region?: string;
  submap?: string;
  locked?: boolean;
  /**
   * Cells of Hexes-table columns this build doesn't know (header → value),
   * in the table's column order. Kept opaque and written back unchanged, so
   * an older build rewriting the note never drops a newer build's column.
   */
  extra?: Record<string, string>;
}

/** Settings stored in a map note: MapData minus its name, paths and the
 *  per-session viewport (which stays in data.json). */
export type MapSettings = Omit<MapData, "name" | "pathChains" | "savedViewport">;

/** Something in a map note that couldn't be read. It stays in the note as written. */
export interface MapNoteProblem {
  /** "Hexes" / "Paths" table, or "settings" (frontmatter). */
  where: "Hexes" | "Paths" | "settings";
  /** The row or `key: value` line, as written. */
  text: string;
  reason: string;
  /** Settings: the frontmatter key (kept as written on rewrite). */
  key?: string;
  /** Settings: the MapData field it would have set (not reset while broken). */
  field?: string;
}

export interface MapNoteData {
  settings: Partial<MapSettings>;
  hexes: Map<string, HexData>;
  paths: PathChain[];
  /** Format the note was written in (MAP_NOTE_FORMAT, or 1 for older notes). */
  format?: number;
  /** What couldn't be read (rows, settings). Empty/absent = all of it read. */
  problems?: MapNoteProblem[];
}

export interface MapNoteReadOptions {
  /** Resolve a wikilink target to a vault path (metadataCache), if it can. */
  resolveLink?: (link: string) => string | undefined;
}

export type MapNoteRead = { ok: true; data: MapNoteData } | { ok: false; reason: string };

// ── loose YAML ───────────────────────────────────────────────────────────
//
// Frontmatter is read with a forgiving YAML subset instead of a strict
// parser: one typo must not make the whole map unreadable, and scalar
// typing stays ours (strict YAML 1.1 would read the hex `3_4` as 34).

type YNode =
  | { t: "s"; v: string; q: boolean }
  | { t: "l"; v: YNode[] }
  | { t: "m"; v: Map<string, YNode> };

interface YBlock {
  /** Top-level key, or null for comments. */
  key: string | null;
  lines: string[];
}

const indentOf = (l: string) => /^[ \t]*/.exec(l)![0].replace(/\t/g, "  ").length;
const isBlankOrComment = (l: string) => !l.trim() || /^\s*#/.test(l);
const KEY_LINE = /^\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s#:"'][^:]*?)\s*:(?:\s+(.*?))?\s*$/;

function unquoteKey(k: string): string {
  if (/^".*"$/.test(k)) { try { return JSON.parse(k) as string; } catch { return k.slice(1, -1); } }
  if (/^'.*'$/.test(k)) return k.slice(1, -1).replace(/''/g, "'");
  return k;
}

/** Split frontmatter text into top-level blocks (a key line plus its indented/list lines). */
function yamlBlocks(src: string): YBlock[] {
  const out: YBlock[] = [];
  for (const line of src.split("\n")) {
    const top = !/^\s/.test(line) && line.trim() !== "";
    const kv = top && !line.startsWith("#") && !line.startsWith("-") ? KEY_LINE.exec(line) : null;
    if (kv) out.push({ key: unquoteKey(kv[1]), lines: [line] });
    else if (out.length && (!top || line.startsWith("-"))) out[out.length - 1].lines.push(line);
    else out.push({ key: null, lines: [line] });
  }
  return out;
}

/** Split `a, "b, c", [d, e]` at top-level commas. */
function splitFlow(s: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = "", cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      cur += c;
      if (c === "\\" && quote === '"') { cur += s[++i] ?? ""; continue; }
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") { quote = c; cur += c; }
    else if (c === "[" || c === "{") { depth++; cur += c; }
    else if (c === "]" || c === "}") { depth--; cur += c; }
    else if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Index of the first `:` outside quotes/brackets (a flow-map key separator). */
function flowColon(s: string): number {
  let depth = 0, quote = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === ":" && depth === 0) return i;
  }
  return -1;
}

function scalarNode(raw: string): YNode {
  let t = raw.trim();
  if (t.startsWith('"')) {
    try { return { t: "s", v: JSON.parse(t) as string, q: true }; } catch { /* below */ }
    const end = t.lastIndexOf('"');
    if (end > 0) { try { return { t: "s", v: JSON.parse(t.slice(0, end + 1)) as string, q: true }; } catch { /* below */ } }
    return { t: "s", v: t.replace(/^"|"$/g, ""), q: true };
  }
  if (t.startsWith("'")) return { t: "s", v: t.replace(/^'|'$/g, "").replace(/''/g, "'"), q: true };
  if (t.startsWith("[") && !t.startsWith("[[") && t.endsWith("]")) {
    return { t: "l", v: splitFlow(t.slice(1, -1)).map(scalarNode) };
  }
  if (t.startsWith("{") && t.endsWith("}")) {
    const m = new Map<string, YNode>();
    for (const item of splitFlow(t.slice(1, -1))) {
      const c = flowColon(item);
      if (c < 0) continue;
      m.set(unquoteKey(item.slice(0, c).trim()), scalarNode(item.slice(c + 1)));
    }
    return { t: "m", v: m };
  }
  // "foo # comment" is YAML for "foo"; "Thornwood #2" keeps its "#2".
  t = t.replace(/\s+#\s.*$/, "");
  return { t: "s", v: t, q: false };
}

/** Parse a nested block (the lines under a `key:` with no inline value). */
function blockNode(lines: string[]): YNode | undefined {
  const body = lines.filter((l) => !isBlankOrComment(l));
  if (!body.length) return undefined;
  const ind = Math.min(...body.map(indentOf));
  const atInd = (l: string) => indentOf(l) === ind;
  if (body[0].trim().startsWith("-")) {
    const items: string[][] = [];
    for (const l of body) {
      if (atInd(l) && /^\s*-(\s|$)/.test(l)) items.push([l.replace(/^(\s*)-\s?/, "$1 ")]);
      else if (items.length) items[items.length - 1].push(l);
    }
    return {
      t: "l",
      v: items.map((it) => {
        const first = it[0].trim();
        if (KEY_LINE.test(first) && !/^["'[{]/.test(first)) return blockNode(it) ?? { t: "s", v: "", q: false };
        return it.length > 1 ? scalarNode([first, ...it.slice(1).map((l) => l.trim())].join(" ")) : scalarNode(first);
      }),
    };
  }
  const m = new Map<string, YNode>();
  let key: string | null = null;
  let rest = "";
  let kids: string[] = [];
  const finish = () => {
    if (key === null) return;
    const node = valueNode(rest, kids);
    if (node) m.set(key, node);
  };
  for (const l of body) {
    const kv = atInd(l) ? KEY_LINE.exec(l) : null;
    if (kv) { finish(); key = unquoteKey(kv[1]); rest = kv[2] ?? ""; kids = []; }
    else kids.push(l);
  }
  finish();
  return { t: "m", v: m };
}

/** The value of `key: rest` followed by `kids` (indented lines). */
function valueNode(rest: string, kids: string[]): YNode | undefined {
  const r = rest.trim();
  if (/^[|>][+-]?\d*$/.test(r)) {
    const text = kids.filter((l) => l.trim()).map((l) => l.trim());
    return { t: "s", v: text.join(r.startsWith("|") ? "\n" : " "), q: true };
  }
  if (r) {
    const more = kids.filter((l) => !isBlankOrComment(l)).map((l) => l.trim());
    return scalarNode(more.length ? [r, ...more].join(" ") : r);
  }
  return blockNode(kids);
}

function parseYamlLoose(src: string): { blocks: YBlock[]; values: Map<string, YNode> } {
  const blocks = yamlBlocks(src);
  const values = new Map<string, YNode>();
  for (const b of blocks) {
    if (b.key === null) continue;
    const kv = KEY_LINE.exec(b.lines[0])!;
    const node = valueNode(kv[2] ?? "", b.lines.slice(1));
    values.set(b.key, node ?? { t: "s", v: "", q: false });
  }
  return { blocks, values };
}

/** A plain JS value from a node (YAML core typing for unquoted scalars). */
function toJs(n: YNode): unknown {
  if (n.t === "l") return n.v.map(toJs);
  if (n.t === "m") return Object.fromEntries([...n.v].map(([k, v]) => [k, toJs(v)]));
  if (n.q) return n.v;
  const t = n.v.trim();
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  if (t === "" || t === "~" || /^null$/i.test(t)) return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}

// ── frontmatter ──────────────────────────────────────────────────────────

type Kind = "str" | "num" | "bool" | "list" | "note";

/**
 * Settings given one plain key each: [MapData field, key, kind, old keys].
 * "note" = a vault note path written as a wikilink.
 */
const SIMPLE_KEYS: [keyof MapSettings, string, Kind, string[]?][] = [
  ["displayName", "display-name", "str"],
  ["paletteName", "palette", "str"],
  ["staggerOffset", "stagger", "str"],
  ["baseTerrain", "base-terrain", "str"],
  // "Terrain theme" in the map menu: the terrain whose colour marks the map in lists.
  ["terrainType", "swatch-terrain", "str", ["terrain-theme"]],
  ["weatherTable", "weather-table", "note"],
  ["rumorsTable", "rumors-table", "note"],
  ["createdWith", "created-with", "str"],
  ["showCoords", "show-coords", "bool"],
  ["showTerrainIcons", "show-terrain-icons", "bool"],
  ["showIconOverrides", "show-icon-overrides", "bool"],
  ["showPaths", "show-paths", "bool"],
  ["showFactionOverlay", "show-faction-overlay", "bool"],
  ["showRegionOverlay", "show-region-overlay", "bool"],
  ["showGmLayer", "show-gm-layer", "bool"],
  ["showTokens", "show-tokens", "bool"],
  ["showLinkBadges", "show-link-badges", "bool"],
  ["hiddenLinkBadges", "hidden-link-badges", "list"],
  ["linkBadgeSize", "link-badge-size", "str"],
  ["showHexNames", "show-hex-names", "bool"],
  ["showTokenNames", "show-token-names", "bool"],
  ["gridDisplayScale", "grid-display-scale", "num"],
  ["gridDisplayScaleX", "grid-display-scale-x", "num"],
  ["gridDisplayScaleY", "grid-display-scale-y", "num"],
  ["gridDisplayOffsetX", "grid-display-offset-x", "num"],
  ["gridDisplayOffsetY", "grid-display-offset-y", "num"],
];

const PARENT_KEYS = ["parent", "parent-hex"];
const WORLD_KEYS = ["world", "world-x", "world-y"];
const BG_KEYS = ["background-image", "background-x", "background-y", "background-scale", "background-rotation", "background-opacity"];
const SIZE_KEYS = ["cols", "rows", "offset-x", "offset-y"];
const BIOME_KEY = "biome";
const BIOME_FROM_KEY = "biome-from";
/** Prefix for MapData fields this build doesn't know (`hexmaker-origin-x`). */
const OTHER_PREFIX = "hexmaker-";
/** Format 1's one-line JSON catch-all, still read. */
const LEGACY_EXTRA_KEY = "hexmaker-extra";
const RESERVED_OTHER = new Set(["map", "extra", "version"]);

/** Frontmatter keys this file writes or used to write. Every other key is the user's. */
function ownsKey(key: string): boolean {
  return OWNED_KEYS.has(key) || key.startsWith(OTHER_PREFIX);
}
const OWNED_KEYS = new Set<string>([
  MAP_NOTE_MARKER, ...SIZE_KEYS, ...PARENT_KEYS, ...WORLD_KEYS, ...BG_KEYS, BIOME_KEY, BIOME_FROM_KEY,
  ...SIMPLE_KEYS.flatMap(([, k, , old]) => [k, ...(old ?? [])]),
]);

/** Fields never stored in the note. */
const SKIP_FIELDS = new Set(["name", "pathChains", "savedViewport", "gridSize", "gridOffset"]);
/** Fields this file writes readably (everything else goes to `hexmaker-*` keys). */
const KNOWN_FIELDS = new Set<string>([
  ...SIMPLE_KEYS.map(([f]) => f as string), "parent", "world", "backgroundImage",
]);

/**
 * Optional map settings a map note owns: a key deleted by hand resets that
 * setting (MapStore). Required ones (palette, size, offset) keep their value.
 */
export const RESETTABLE_FIELDS: readonly string[] = [
  ...SIMPLE_KEYS.map(([f]) => f as string).filter((f) => f !== "paletteName"),
  "parent", "world", "backgroundImage", "biome",
];

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
const camel = (k: string) => k.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** `hexmaker-<name>` key for an unknown field, reversible by otherField. */
function otherKey(field: string): string {
  const k = /^[a-z][a-zA-Z0-9]*$/.test(field) && camel(kebab(field)) === field ? kebab(field) : field;
  return OTHER_PREFIX + (RESERVED_OTHER.has(k) ? `field-${k}` : k);
}
function otherField(key: string): string | null {
  let rest = key.slice(OTHER_PREFIX.length);
  if (!rest || RESERVED_OTHER.has(rest)) return null;
  if (rest.startsWith("field-") && RESERVED_OTHER.has(rest.slice(6))) rest = rest.slice(6);
  return /^[a-z][a-z0-9-]*$/.test(rest) ? camel(rest) : rest;
}

/** Plain when that reads back as the same string, else double-quoted. */
function yamlString(v: string): string {
  const plain = /^[\w][\w .,()/@'-]*$/.test(v) && !v.endsWith(" ")
    && !/^(true|false|null|yes|no|on|off|~|[-+]?(\d[\d_.eE+-]*|\.\d+))$/i.test(v);
  return plain ? v : JSON.stringify(v);
}

/** Numbers to at most 4 decimals: settings, not measurements to the atom. */
const fmtNum = (n: number) => String(Math.round(n * 10000) / 10000);

function yamlScalar(v: unknown, inList = false): string {
  if (typeof v === "number") return fmtNum(v);
  if (typeof v === "boolean") return String(v);
  if (v === null) return "null";
  const str = typeof v === "string" ? v : JSON.stringify(v);
  return inList && /[,[\]{}]/.test(str) ? JSON.stringify(str) : yamlString(str);
}

/** A YAML value: scalar, `[a, b]` list, or an indented block for objects. */
function yamlValueLines(key: string, v: unknown, indent = ""): string[] {
  if (Array.isArray(v)) {
    if (v.every((x) => x === null || typeof x !== "object")) return [`${indent}${key}: [${v.map((x) => yamlScalar(x, true)).join(", ")}]`];
    return [`${indent}${key}: ${JSON.stringify(v)}`];
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (!entries.length) return [`${indent}${key}: {}`];
    return [`${indent}${key}:`, ...entries.flatMap(([k, x]) => yamlValueLines(/^[\w-]+$/.test(k) ? k : JSON.stringify(k), x, indent + "  "))];
  }
  return [`${indent}${key}: ${yamlScalar(v)}`];
}

const linkTo = (target: string) => JSON.stringify(`[[${target}]]`);
const WIKILINK = /^!?\[\[([^\]|#]*)(?:[#|][^\]]*)?\]\]$/;

/** A wikilink's target (`[[a/b|c]]` → `a/b`), or the plain text. */
function unlink(s: string): string {
  const m = WIKILINK.exec(s.trim());
  return (m ? m[1] : s).trim();
}

/** "x_y" from `3_4`, `3, 4`, `3,4`, `(3, 4)`, `3 4` or a link to the hex note. */
export function parseHexKey(raw: string): string | null {
  let s = unlink(raw);
  s = s.slice(s.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  const m = /^\(?\s*(-?\d+)\s*(?:[_,;]|\s)\s*(-?\d+)\s*\)?$/.exec(s);
  return m ? `${Number(m[1])}_${Number(m[2])}` : null;
}

const TRUE_WORDS = /^(yes|true|y|x|on|1|✓|✔|☑)$/i;
const FALSE_WORDS = /^(no|false|n|off|0|-|)$/i;

interface FmRead {
  settings: Partial<MapSettings>;
  format: number;
  problems: MapNoteProblem[];
}

function readFrontmatter(src: string, opts: MapNoteReadOptions): FmRead {
  const { values } = parseYamlLoose(src);
  const out: Record<string, unknown> = {};
  const problems: MapNoteProblem[] = [];
  const has = (k: string) => values.has(k);
  const textOf = (k: string) => {
    const n = values.get(k);
    return n && n.t === "s" ? n.v.trim() : undefined;
  };
  const bad = (key: string, field: string, reason: string) => {
    const n = values.get(key);
    const shown = n ? (n.t === "s" ? n.v : JSON.stringify(toJs(n))) : "";
    problems.push({ where: "settings", key, field, text: `${key}: ${shown}`, reason });
  };
  const num = (key: string, field: string): number | undefined => {
    const t = textOf(key);
    if (t === undefined || t === "") { if (has(key) && values.get(key)!.t !== "s") bad(key, field, "should be a number"); return undefined; }
    const n = Number(t.replace(/,/g, "."));
    if (Number.isFinite(n)) return n;
    bad(key, field, "should be a number");
    return undefined;
  };
  const noteLink = (raw: string, ext: string) => {
    const target = unlink(raw);
    if (!target) return undefined;
    const resolved = opts.resolveLink?.(target);
    if (resolved) return resolved;
    return ext && !target.toLowerCase().endsWith(ext) ? target + ext : target;
  };
  const marker = textOf(MAP_NOTE_MARKER);
  const format = Number(marker) >= 2 ? Math.floor(Number(marker)) : 1;

  // grid size and offset
  const cols = num("cols", "gridSize"), rows = num("rows", "gridSize");
  if (cols !== undefined && rows !== undefined) out.gridSize = { cols, rows };
  const ox = num("offset-x", "gridOffset"), oy = num("offset-y", "gridOffset");
  if (ox !== undefined && oy !== undefined) out.gridOffset = { x: ox, y: oy };

  for (const [field, key, kind, old] of SIMPLE_KEYS) {
    const k = has(key) ? key : old?.find(has);
    if (!k) continue;
    const node = values.get(k)!;
    if (kind === "list") {
      if (node.t === "l") out[field] = node.v.map((x) => (x.t === "s" ? x.v.trim() : "")).filter(Boolean);
      else if (node.t === "s") {
        const t = node.v.trim();
        if (t) out[field] = t.replace(/^\[|\]$/g, "").split(/[,;]/).map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      } else bad(k, field, "should be a list");
      continue;
    }
    if (node.t !== "s") { bad(k, field, "should be a single value"); continue; }
    const t = node.v.trim();
    if (t === "") continue; // `key:` left empty = not set
    if (kind === "num") { const n = num(k, field); if (n !== undefined) out[field] = n; }
    else if (kind === "bool") {
      if (TRUE_WORDS.test(t)) out[field] = true;
      else if (FALSE_WORDS.test(t)) out[field] = false;
      else bad(k, field, "should be true or false");
    } else if (kind === "note") out[field] = noteLink(t, ".md");
    else if (field === "staggerOffset") {
      if (/^(odd|even)$/i.test(t)) out[field] = t.toLowerCase();
      else bad(k, field, "should be odd or even");
    } else out[field] = t;
  }

  // parent: "[[_map]]" + parent-hex: 3, 4 — or format 1's {"map","hex"}
  const parentNode = values.get("parent");
  if (parentNode) {
    const legacy = parentNode.t === "m" ? toJs(parentNode) as Record<string, unknown> : null;
    if (legacy) {
      const hex = parseHexKey(typeof legacy.hex === "string" ? legacy.hex : "");
      if (typeof legacy.map === "string" && legacy.map && hex) out.parent = { map: legacy.map, hex };
      else bad("parent", "parent", "should be a link to the parent map's note");
    } else if (parentNode.t === "s" && parentNode.v.trim()) {
      let map = unlink(parentNode.v);
      map = map.slice(map.lastIndexOf("/") + 1).replace(/\.md$/i, "").replace(/^_/, "");
      const hexRaw = textOf("parent-hex");
      const hex = hexRaw ? parseHexKey(hexRaw) : null;
      if (!map) bad("parent", "parent", "should be a link to the parent map's note");
      else if (!hex) bad("parent-hex", "parent", hexRaw ? "isn't a hex (write it like 3, 4)" : "is missing (the hex this map opens from, like 3, 4)");
      else out.parent = { map, hex };
    }
  }

  // world: <id> + world-x / world-y — or format 1's {"id","cx","cy"}
  const worldNode = values.get("world");
  if (worldNode) {
    if (worldNode.t === "m") {
      const w = toJs(worldNode) as Record<string, unknown>;
      const cx = Number(w.cx), cy = Number(w.cy);
      if (typeof w.id === "string" && Number.isFinite(cx) && Number.isFinite(cy)) out.world = { id: w.id, cx, cy };
      else bad("world", "world", "should be the world's id");
    } else if (worldNode.t === "s" && worldNode.v.trim()) {
      const cx = num("world-x", "world"), cy = num("world-y", "world");
      if (!has("world-x")) bad("world", "world", "needs world-x and world-y");
      else if (!has("world-y")) bad("world", "world", "needs world-y");
      else if (cx !== undefined && cy !== undefined) out.world = { id: worldNode.v.trim(), cx, cy };
    }
  }

  // background-image: "[[image.png]]" + background-x/-y/-scale/-rotation/-opacity
  const bgNode = values.get("background-image");
  if (bgNode) {
    if (bgNode.t === "m") {
      const b = toJs(bgNode) as Record<string, unknown>;
      if (typeof b.path === "string" && b.path) {
        const bg: Record<string, unknown> = { path: b.path, offsetX: Number(b.offsetX) || 0, offsetY: Number(b.offsetY) || 0, scale: Number(b.scale) || 1 };
        for (const k of ["rotation", "opacity"]) if (b[k] !== undefined && b[k] !== null && Number.isFinite(Number(b[k]))) bg[k] = Number(b[k]);
        for (const [k, v] of Object.entries(b)) if (!(k in bg)) bg[k] = v;
        out.backgroundImage = bg;
      } else bad("background-image", "backgroundImage", "should be a link to the image");
    } else if (bgNode.t === "s" && bgNode.v.trim()) {
      const bg: Record<string, unknown> = {
        path: noteLink(bgNode.v, ""),
        offsetX: num("background-x", "backgroundImage") ?? 0,
        offsetY: num("background-y", "backgroundImage") ?? 0,
        scale: num("background-scale", "backgroundImage") ?? 1,
      };
      const rot = num("background-rotation", "backgroundImage");
      if (rot !== undefined) bg.rotation = rot;
      const op = num("background-opacity", "backgroundImage");
      if (op !== undefined) bg.opacity = op;
      if (!problems.some((p) => p.field === "backgroundImage")) out.backgroundImage = bg;
    }
  }

  // biome: <generator> + biome-from: [a, b]
  const gen = textOf(BIOME_KEY);
  if (gen) {
    const biome: { generator: string; from?: string[] } = { generator: gen };
    const fromNode = values.get(BIOME_FROM_KEY);
    const from = !fromNode ? [] : fromNode.t === "l" ? fromNode.v.map((x) => (x.t === "s" ? x.v.trim() : "")).filter(Boolean)
      : fromNode.t === "s" ? fromNode.v.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean) : [];
    if (from.length) biome.from = from;
    out.biome = biome;
  }

  // fields this build doesn't know: hexmaker-<name> keys, then format 1's JSON catch-all
  for (const [k, node] of values) {
    if (!k.startsWith(OTHER_PREFIX) || k === MAP_NOTE_MARKER || k === LEGACY_EXTRA_KEY) continue;
    const field = otherField(k);
    if (field && !(field in out)) out[field] = toJs(node);
  }
  const legacy = values.get(LEGACY_EXTRA_KEY);
  if (legacy && legacy.t === "m") {
    for (const [k, v] of Object.entries(toJs(legacy) as Record<string, unknown>)) if (!(k in out)) out[k] = v;
  }
  return { settings: out, format, problems };
}

function frontmatterLines(settings: Partial<MapSettings>, keep: Set<string> = new Set()): string[] {
  const s = settings as Record<string, unknown>;
  const lines = [`${MAP_NOTE_MARKER}: ${MAP_NOTE_FORMAT}`];
  const put = (key: string, v: unknown) => { if (v !== undefined && !keep.has(key)) lines.push(...yamlValueLines(key, v)); };
  put("display-name", s.displayName);
  put("palette", s.paletteName);
  if (settings.gridSize) { put("cols", settings.gridSize.cols); put("rows", settings.gridSize.rows); }
  if (settings.gridOffset) { put("offset-x", settings.gridOffset.x); put("offset-y", settings.gridOffset.y); }
  for (const [field, key, kind] of SIMPLE_KEYS) {
    if (field === "displayName" || field === "paletteName") continue;
    const v = s[field];
    if (v === undefined) continue;
    if (kind === "note" && typeof v === "string" && v) put(key, `[[${v.replace(/\.md$/i, "")}]]`);
    else put(key, v);
  }
  const parent = s.parent as { map?: unknown; hex?: unknown } | undefined;
  const parentHex = parent && typeof parent.hex === "string" ? /^(-?\d+)_(-?\d+)$/.exec(parent.hex) : null;
  const parentReadable = !!parent && typeof parent.map === "string" && !!parent.map && !!parentHex && Object.keys(parent).length === 2;
  if (parentReadable) {
    if (!keep.has("parent")) lines.push(`parent: ${linkTo(`_${parent.map as string}`)}`);
    put("parent-hex", `${parentHex[1]}, ${parentHex[2]}`);
  }
  const world = s.world as { id?: unknown; cx?: unknown; cy?: unknown } | undefined;
  const worldReadable = !!world && typeof world.id === "string" && !!world.id && typeof world.cx === "number" && typeof world.cy === "number" && Object.keys(world).length === 3;
  if (worldReadable) { put("world", world.id); put("world-x", world.cx); put("world-y", world.cy); }
  const bg = s.backgroundImage as Record<string, unknown> | undefined;
  const bgReadable = !!bg && typeof bg.path === "string" && !!bg.path
    && Object.keys(bg).every((k) => ["path", "offsetX", "offsetY", "scale", "rotation", "opacity"].includes(k))
    && ["offsetX", "offsetY", "scale", "rotation", "opacity"].every((k) => bg[k] === undefined || typeof bg[k] === "number");
  if (bgReadable) {
    if (!keep.has("background-image")) lines.push(`background-image: ${linkTo(bg.path as string)}`);
    put("background-x", bg.offsetX ?? 0);
    put("background-y", bg.offsetY ?? 0);
    put("background-scale", bg.scale ?? 1);
    put("background-rotation", bg.rotation);
    put("background-opacity", bg.opacity);
  }
  const biome = s.biome as { generator?: unknown; from?: unknown } | undefined;
  const biomeReadable = !!biome && typeof biome.generator === "string" && biome.generator !== ""
    && Object.keys(biome).every((k) => k === "generator" || k === "from")
    && (biome.from === undefined || (Array.isArray(biome.from) && biome.from.every((v) => typeof v === "string")));
  if (biomeReadable) {
    put(BIOME_KEY, biome.generator);
    if (Array.isArray(biome.from) && biome.from.length) put(BIOME_FROM_KEY, biome.from);
  }
  const readable = new Set<string>(KNOWN_FIELDS);
  if (!parentReadable) readable.delete("parent");
  if (!worldReadable) readable.delete("world");
  if (!bgReadable) readable.delete("backgroundImage");
  if (biomeReadable) readable.add("biome");
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined || readable.has(k) || SKIP_FIELDS.has(k)) continue;
    put(otherKey(k), v);
  }
  return lines;
}

const FRONTMATTER = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(\n|$)/;

// ── tables ───────────────────────────────────────────────────────────────

const HEX_HEADERS = ["Hex", "Name", "Terrain", "Icon", "GM icons", "Region", "Submap", "Locked"];
const PATH_HEADERS = ["Type", "Hexes"];
/** Header → canonical column, ignoring case, spaces, dashes and markup. */
const HEX_COL_ALIASES: Record<string, string> = {
  hex: "hex", name: "name", terrain: "terrain", icon: "icon",
  gmicons: "gm icons", gmicon: "gm icons", region: "region", submap: "submap", locked: "locked",
};
const PATH_COL_ALIASES: Record<string, string> = { type: "type", hexes: "hexes" };
const CANONICAL: Record<string, string> = Object.fromEntries([...HEX_HEADERS, ...PATH_HEADERS].map((h) => [h.toLowerCase(), h]));
const SEPARATOR_ROW = /^\s*\|?\s*:?[-=]+:?\s*(\|\s*:?[-=]*:?\s*)*\|?\s*$/;
const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
    else if (s[i] === "|") { cells.push(cur.trim()); cur = ""; }
    else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** A row's cells lined up with `n` headers: stray empty cells at either end (extra pipes) dropped. */
function rowCells(line: string, n: number): string[] {
  const c = splitRow(line);
  while (c.length > n && c[0] === "") c.shift();
  while (c.length > n && c[c.length - 1] === "") c.pop();
  return c;
}

const esc = (v: string | undefined) => (v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

interface Table {
  start: number;
  /** First row after the header (and separator, if any). */
  body: number;
  end: number;
  /** Canonical column id per header ("hex", "gm icons", …) or "" for unknown. */
  cols: string[];
  /** Headers as written (trimmed). */
  headers: string[];
}

const isTableLine = (l: string) => l.includes("|") && !/^\s*[>#]/.test(l) && l.trim() !== "";

function tableAt(lines: string[], i: number, aliases: Record<string, string>): Table {
  const headers = splitRow(lines[i]);
  const cols = headers.map((h) => aliases[normHeader(h)] ?? "");
  const body = i + 1 < lines.length && SEPARATOR_ROW.test(lines[i + 1]) && lines[i + 1].includes("-") ? i + 2 : i + 1;
  let end = body;
  while (end < lines.length && isTableLine(lines[end])) end++;
  return { start: i, body, end, cols, headers };
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** [start, end) of the body section under a `## <name>` heading. */
function sectionRange(lines: string[], name: string): [number, number] | null {
  for (let i = 0; i < lines.length; i++) {
    const h = HEADING.exec(lines[i]);
    if (!h || normHeader(h[2]) !== name) continue;
    let end = i + 1;
    while (end < lines.length) {
      const n = HEADING.exec(lines[end]);
      if (n && n[1].length <= h[1].length) break;
      end++;
    }
    return [i + 1, end];
  }
  return null;
}

/**
 * The table holding `need` columns: first one inside its section ("## Hexes"
 * / "## Paths"), else the first anywhere with `strict` columns. `broken` =
 * the section has table rows but no header with those columns.
 */
function locateTable(lines: string[], section: string, aliases: Record<string, string>, need: string[], strict: string[]): { table: Table | null; broken: boolean } {
  const has = (i: number, cols: string[]) => {
    const t = splitRow(lines[i]).map((h) => aliases[normHeader(h)] ?? "");
    return cols.every((c) => t.includes(c));
  };
  const range = sectionRange(lines, section);
  if (range) {
    for (let i = range[0]; i < range[1]; i++) {
      if (isTableLine(lines[i]) && !SEPARATOR_ROW.test(lines[i]) && has(i, need)) return { table: tableAt(lines, i, aliases), broken: false };
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (isTableLine(lines[i]) && !SEPARATOR_ROW.test(lines[i]) && has(i, strict)) {
      if (range && (i < range[0] - 1 || i >= range[1]) && sectionHasRows(lines, range)) break;
      return { table: tableAt(lines, i, aliases), broken: false };
    }
  }
  return { table: null, broken: !!range && sectionHasRows(lines, range) };
}

function sectionHasRows(lines: string[], range: [number, number]): boolean {
  for (let i = range[0]; i < range[1]; i++) if (/^\s*\|/.test(lines[i])) return true;
  return false;
}

/** Sort "x_y" keys by row then column, like reading a map. */
export function compareHexKeys(a: string, b: string): number {
  const [ax, ay] = a.split("_").map(Number);
  const [bx, by] = b.split("_").map(Number);
  return ay - by || ax - bx;
}

/** Anything besides terrain set on a hex. */
function hasNonTerrainData(h: HexData): boolean {
  return !!(h.name || h.icon || (h.gmIcons && h.gmIcons.length) || h.region || h.submap || h.locked
    || (h.extra && Object.values(h.extra).some(Boolean)));
}

function isEmptyHex(h: HexData): boolean {
  return !h.terrain && !hasNonTerrainData(h);
}

/** Rows worth writing: hexes with any data, minus "just the base terrain". */
export function hexRowsToWrite(hexes: Map<string, HexData>, baseTerrain?: string): [string, HexData][] {
  return [...hexes]
    .filter(([, h]) => {
      if (isEmptyHex(h)) return false;
      const onlyBase = h.terrain === baseTerrain && !hasNonTerrainData(h);
      return !(baseTerrain && onlyBase);
    })
    .sort(([a], [b]) => compareHexKeys(a, b));
}

/** Unknown column headers across rows, in first-seen order. */
function extraHeaders(rows: Iterable<{ extra?: Record<string, string> }>): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.extra ?? {})) seen.add(k);
  return [...seen];
}

function tableHead(headers: string[]): string[] {
  return [`| ${headers.map(esc).join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
}

/**
 * Headers to write, in order: the existing table's columns as the user
 * arranged them (known ones in their usual spelling, unknown ones as typed,
 * repeats and blanks dropped), then any known column it lacks (canonical
 * order), then unknown columns that only the data has.
 */
function columnOrder(known: string[], aliases: Record<string, string>, existing: string[] | undefined, extras: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (h: string) => {
    const id = aliases[normHeader(h)];
    const label = id ? CANONICAL[id] : h.trim();
    const k = id ?? label.toLowerCase();
    if (!label || seen.has(k)) return;
    seen.add(k);
    out.push(label);
  };
  for (const h of existing ?? []) add(h);
  for (const h of known) add(h);
  for (const h of extras) add(h);
  return out;
}

/** An unknown column's value, matching its header case-insensitively. */
function extraValue(extra: Record<string, string> | undefined, header: string): string | undefined {
  if (!extra) return undefined;
  if (header in extra) return extra[header];
  const k = header.toLowerCase();
  for (const [h, v] of Object.entries(extra)) if (h.toLowerCase() === k) return v;
  return undefined;
}

const HEX_CELL: Record<string, (k: string, h: HexData) => string | undefined> = {
  hex: (k) => k,
  name: (_k, h) => h.name,
  terrain: (_k, h) => h.terrain,
  icon: (_k, h) => h.icon,
  "gm icons": (_k, h) => h.gmIcons?.join(", "),
  region: (_k, h) => h.region,
  submap: (_k, h) => h.submap,
  locked: (_k, h) => (h.locked ? "yes" : ""),
};

function hexTable(hexes: Map<string, HexData>, baseTerrain?: string, existing?: string[], keptRows: string[] = []): string {
  const rows = hexRowsToWrite(hexes, baseTerrain);
  const headers = columnOrder(HEX_HEADERS, HEX_COL_ALIASES, existing, extraHeaders(rows.map(([, h]) => h)));
  const lines = tableHead(headers);
  for (const [k, h] of rows) {
    const cells = headers.map((c) => {
      const known = HEX_CELL[HEX_COL_ALIASES[normHeader(c)] ?? ""];
      return known ? known(k, h) : extraValue(h.extra, c);
    });
    lines.push(`| ${cells.map(esc).join(" | ")} |`);
  }
  lines.push(...keptRows);
  return lines.join("\n");
}

function pathTable(paths: PathChain[], existing?: string[], keptRows: string[] = []): string {
  const headers = columnOrder(PATH_HEADERS, PATH_COL_ALIASES, existing, extraHeaders(paths));
  const lines = tableHead(headers);
  for (const p of paths) {
    const cells = headers.map((c) => {
      const k = PATH_COL_ALIASES[normHeader(c)];
      if (k === "type") return esc(p.typeName);
      if (k === "hexes") return p.hexes.join(" ");
      return esc(extraValue(p.extra, c));
    });
    lines.push(`| ${cells.join(" | ")} |`);
  }
  lines.push(...keptRows);
  return lines.join("\n");
}

/** [index, header] of the columns not known (first of any repeated name). */
function unknownColumns(t: Table): [number, string][] {
  const seen = new Set<string>();
  const out: [number, string][] = [];
  t.cols.forEach((c, i) => {
    const h = t.headers[i];
    if (c || !h || seen.has(h.toLowerCase())) return;
    seen.add(h.toLowerCase());
    out.push([i, h]);
  });
  return out;
}

/** A row's non-empty cells in unknown columns, or undefined when it has none. */
function readExtra(cells: string[], unknown: [number, string][]): Record<string, string> | undefined {
  let out: Record<string, string> | undefined;
  for (const [i, header] of unknown) {
    const v = cells[i];
    if (v) (out ??= {})[header] = v;
  }
  return out;
}

interface TableRead<T> {
  rows: T;
  /** Rows that couldn't be read, as written (kept at the table's end on rewrite). */
  bad: MapNoteProblem[];
}

const isFiller = (line: string) => SEPARATOR_ROW.test(line) || splitRow(line).every((c) => c === "");

function readHexTable(lines: string[], t: Table | null): TableRead<Map<string, HexData>> {
  const out = new Map<string, HexData>();
  const bad: MapNoteProblem[] = [];
  if (!t) return { rows: out, bad };
  const col = (name: string) => t.cols.indexOf(name);
  const ci = { hex: col("hex"), name: col("name"), terrain: col("terrain"), icon: col("icon"), gm: col("gm icons"), region: col("region"), submap: col("submap"), locked: col("locked") };
  const unknown = unknownColumns(t);
  for (let i = t.body; i < t.end; i++) {
    const line = lines[i];
    if (isFiller(line)) continue;
    const c = rowCells(line, t.headers.length);
    const no = (reason: string) => bad.push({ where: "Hexes", text: line.trim(), reason });
    const rawKey = c[ci.hex] ?? "";
    const key = parseHexKey(rawKey);
    if (!key) { no(rawKey ? `"${rawKey}" isn't a hex (write it like 3_4)` : "no hex in the Hex column"); continue; }
    if (out.has(key)) { no(`hex ${key} already has a row above`); continue; }
    const get = (j: number) => (j >= 0 ? c[j] : "") || undefined;
    const lockedRaw = get(ci.locked) ?? "";
    if (!TRUE_WORDS.test(lockedRaw) && !FALSE_WORDS.test(lockedRaw)) { no(`Locked should be yes or empty, not "${lockedRaw}"`); continue; }
    const h: HexData = {};
    // Notes from before hex names have no Name column (index -1): no name.
    if (get(ci.name)) h.name = get(ci.name);
    if (get(ci.terrain)) h.terrain = get(ci.terrain);
    if (get(ci.icon)) h.icon = get(ci.icon);
    const gm = get(ci.gm);
    if (gm) h.gmIcons = gm.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (get(ci.region)) h.region = get(ci.region);
    if (get(ci.submap)) h.submap = get(ci.submap);
    if (TRUE_WORDS.test(lockedRaw)) h.locked = true;
    const extra = readExtra(c, unknown);
    if (extra) h.extra = extra;
    out.set(key, h);
  }
  return { rows: out, bad };
}

function readPathTable(lines: string[], t: Table | null): TableRead<PathChain[]> {
  const out: PathChain[] = [];
  const bad: MapNoteProblem[] = [];
  if (!t) return { rows: out, bad };
  const ti = t.cols.indexOf("type"), hi = t.cols.indexOf("hexes");
  const unknown = unknownColumns(t);
  for (let i = t.body; i < t.end; i++) {
    const line = lines[i];
    if (isFiller(line)) continue;
    const c = rowCells(line, t.headers.length);
    const no = (reason: string) => bad.push({ where: "Paths", text: line.trim(), reason });
    const type = c[ti] ?? "";
    const tokens = (c[hi] ?? "").split(/[\s,;→>]+/).filter(Boolean);
    const hexes = tokens.map(parseHexKey);
    if (!type) { no("no path type in the Type column"); continue; }
    if (!tokens.length) { no("no hexes in the Hexes column"); continue; }
    const badTok = tokens.find((_, j) => !hexes[j]);
    if (badTok !== undefined) { no(`"${badTok}" isn't a hex (list them like 3_4 4_4 5_4)`); continue; }
    const p: PathChain = { typeName: type, hexes: hexes as string[] };
    const extra = readExtra(c, unknown);
    if (extra) p.extra = extra;
    out.push(p);
  }
  return { rows: out, bad };
}

// ── callouts ─────────────────────────────────────────────────────────────

const HELP_TITLE = /^>\s*\[!info\][+-]?\s*how to edit this (map )?note/i;
const PROBLEM_TITLE = /^>\s*\[!warning\][+-]?\s*hexmaker couldn't read/i;
/** The one-line description format-1 notes opened with (plugin text, replaced by the help box). */
const OLD_INTRO = "Hexmap World Creator map. Each hex's name, terrain, icons, region and submap live in the table below — edit it here or paint on the map. Hex notes hold descriptions and links, and only exist once a hex has some.";

export const HELP_CALLOUT = [
  "> [!info]- How to edit this note",
  "> This note holds the map's data. Painting on the map updates it, and your edits here update the map.",
  "> - **Hexes**: one row per hex that has something set. *Hex* is the column and row, like `3_4`. *Terrain* and *Region* use names from the map's palette. *Icon* and *GM icons* are icon file names; separate several with commas. *Submap* is the map that opens from the hex. *Locked* `yes` keeps generators off it.",
  "> - **Paths**: *Type* is a path type (Road, River…). *Hexes* lists its hexes in order, separated by spaces.",
  "> - Columns can be in any order, and you can add your own; they're kept. A row that can't be read is kept as written and flagged.",
  "> - The properties at the top are the map's settings. Delete one to reset it. Keys starting with `hexmaker-` come from other versions of the plugin; leave them be.",
  "> - Everything else in this note, like text you write below the tables, is yours: the plugin never changes it.",
];

function problemCallout(problems: MapNoteProblem[], what: string): string[] {
  const n = problems.length;
  const head = what === "settings"
    ? `> [!warning] Hexmaker couldn't read ${n === 1 ? "a setting" : `${n} settings`}`
    : `> [!warning] Hexmaker couldn't read ${n === 1 ? "a row" : `${n} rows`} in this table`;
  const tail = what === "settings"
    ? "> The map keeps its previous value until you fix it above; this box then goes away."
    : `> ${n === 1 ? "It's" : "They're"} kept as written at the end of the table. Fix ${n === 1 ? "it" : "them"} there and this box goes away.`;
  const code = (s: string) => (s.includes("`") ? `\`\` ${s} \`\`` : `\`${s}\``);
  return [head, tail, ...problems.map((p) => `> - ${code(p.text)}: ${p.reason}`)];
}

/** Remove Hexmaker's warning callouts (they're regenerated from what's in the note). */
function stripProblemCallouts(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!PROBLEM_TITLE.test(lines[i])) { out.push(lines[i]); continue; }
    while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1])) i++;
    // the blank line it was inserted with: before it after a table, after it at the top
    if (out.length && out[out.length - 1].trim() === "") out.pop();
    else if (i + 1 < lines.length && lines[i + 1].trim() === "") i++;
  }
  return out;
}

// ── whole note ───────────────────────────────────────────────────────────

interface Parsed {
  fm: RegExpExecArray | null;
  front: FmRead;
  lines: string[];
  hexT: Table | null;
  pathT: Table | null;
  hexes: TableRead<Map<string, HexData>>;
  paths: TableRead<PathChain[]>;
  broken: string | null;
}

function parseParts(content: string, opts: MapNoteReadOptions): Parsed | null {
  const text = content.replace(/\r\n?/g, "\n");
  const fm = FRONTMATTER.exec(text);
  if (!fm) return null;
  const fmText = fm[1] ?? "";
  if (!/^\s*["']?hexmaker-map["']?\s*:/m.test(fmText)) return null;
  const front = readFrontmatter(fmText, opts);
  const lines = stripProblemCallouts(text.slice(fm[0].length).split("\n"));
  const h = locateTable(lines, "hexes", HEX_COL_ALIASES, ["hex"], ["hex", "terrain"]);
  const p = locateTable(lines, "paths", PATH_COL_ALIASES, ["type", "hexes"], ["type", "hexes"]);
  let broken: string | null = null;
  if (h.broken) broken = "the Hexes table needs a header row with a Hex column";
  else if (p.broken) broken = "the Paths table needs a header row with Type and Hexes columns";
  return { fm, front, lines, hexT: h.table, pathT: p.table, hexes: readHexTable(lines, h.table), paths: readPathTable(lines, p.table), broken };
}

/**
 * Read a map note. null = not a map note (no frontmatter with
 * `hexmaker-map`); `ok: false` = a map note whose tables can't be found, so
 * it must not be written over until fixed.
 */
export function readMapNote(content: string, opts: MapNoteReadOptions = {}): MapNoteRead | null {
  const p = parseParts(content, opts);
  if (!p) return null;
  if (p.broken) return { ok: false, reason: p.broken };
  return {
    ok: true,
    data: {
      settings: p.front.settings,
      hexes: p.hexes.rows,
      paths: p.paths.rows,
      format: p.front.format,
      problems: [...p.front.problems, ...p.hexes.bad, ...p.paths.bad],
    },
  };
}

/** Parse a map note, or null if it isn't one (or can't be read). */
export function parseMapNote(content: string, opts: MapNoteReadOptions = {}): MapNoteData | null {
  const r = readMapNote(content, opts);
  return r && r.ok ? r.data : null;
}

/** Format of a map note's text: 1 for older notes, null when it isn't one. */
export function mapNoteFormat(content: string): number | null {
  const p = parseParts(content, {});
  return p ? p.front.format : null;
}

/** A fresh map note. */
export function buildMapNote(name: string, data: MapNoteData): string {
  return [
    "---",
    ...frontmatterLines(data.settings),
    "---",
    `# ${data.settings.displayName || name}`,
    "",
    ...HELP_CALLOUT,
    "",
    "## Hexes",
    "",
    hexTable(data.hexes, data.settings.baseTerrain),
    "",
    "## Paths",
    "",
    pathTable(data.paths),
    "",
  ].join("\n");
}

/**
 * Rewrite our parts of an existing map note — owned frontmatter keys, the
 * two tables and Hexmaker's callouts — keeping everything else the user
 * added. Rows and settings that can't be read are kept as written and
 * listed in a warning callout. A format-1 note gets the help callout once.
 */
export function updateMapNote(content: string, name: string, data: MapNoteData): string {
  const text = content.replace(/\r\n?/g, "\n");
  const parsed = parseParts(text, {});
  if (!parsed) {
    // Not readable as a map note: never rebuild over the text. Put a fresh
    // frontmatter + tables on top and keep every line that was there.
    const fresh = buildMapNote(name, data);
    return text.trim() ? `${fresh}\n${text}` : fresh;
  }
  const { fm, front } = parsed;
  // Settings that didn't read stay exactly as written (and aren't written by us).
  const keep = new Set(front.problems.map((p) => p.key!).filter(Boolean));
  const userFm = yamlBlocks(fm![1] ?? "")
    .filter((b) => b.key === null ? b.lines.some((l) => l.trim()) : !ownsKey(b.key) || keep.has(b.key))
    .flatMap((b) => b.lines)
    .filter((l) => l.trim());
  let lines = [...parsed.lines];

  // Tables are rewritten in the column order the user gave them; unreadable rows stay at the end.
  const replace = (find: () => Table | null, table: (existing?: string[]) => string, heading: string, problems: MapNoteProblem[], what: string) => {
    const t = find();
    const callout = problems.length ? ["", ...problemCallout(problems, what)] : [];
    if (t) lines = [...lines.slice(0, t.start), ...table(t.headers).split("\n"), ...callout, ...lines.slice(t.end)];
    else lines = [...lines, "", heading, "", ...table().split("\n"), ...callout];
  };
  const hexBad = parsed.hexes.bad, pathBad = parsed.paths.bad;
  replace(() => locateTable(lines, "hexes", HEX_COL_ALIASES, ["hex"], ["hex", "terrain"]).table,
    (ex) => hexTable(data.hexes, data.settings.baseTerrain, ex, hexBad.map((b) => b.text)), "## Hexes", hexBad, "Hexes");
  replace(() => locateTable(lines, "paths", PATH_COL_ALIASES, ["type", "hexes"], ["type", "hexes"]).table,
    (ex) => pathTable(data.paths, ex, pathBad.map((b) => b.text)), "## Paths", pathBad, "Paths");

  // Format 1 → 2: add the help box once (in place of the old one-line intro, if it's still there).
  if (front.format < MAP_NOTE_FORMAT && !lines.some((l) => HELP_TITLE.test(l))) {
    const intro = lines.findIndex((l) => l.trim() === OLD_INTRO);
    if (intro >= 0) lines.splice(intro, 1, ...HELP_CALLOUT);
    else {
      const first = lines.findIndex((l) => l.trim() !== "");
      const at = first >= 0 && /^#\s/.test(lines[first]) ? first + 1 : 0;
      lines.splice(at, 0, ...(at ? ["", ...HELP_CALLOUT] : [...HELP_CALLOUT, ""]));
    }
  }
  const fmProblems = front.problems;
  if (fmProblems.length) lines = [...problemCallout(fmProblems, "settings"), "", ...lines];
  return ["---", ...frontmatterLines(data.settings, keep), ...userFm, "---", ...lines].join("\n");
}

/**
 * Only bring Hexmaker's warning callouts in line with what the note holds
 * now (add, update or clear them), touching nothing else. For hand edits:
 * the rest is normalised on the next real write.
 */
export function refreshProblemCallouts(content: string): string {
  const text = content.replace(/\r\n?/g, "\n");
  const p = parseParts(text, {});
  if (!p || p.broken) return content;
  let lines = [...p.lines];
  const insertAfter = (t: Table | null, bad: MapNoteProblem[], what: string) => {
    if (!t || !bad.length) return;
    lines = [...lines.slice(0, t.end), "", ...problemCallout(bad, what), ...lines.slice(t.end)];
  };
  // later table first so earlier indices stay valid
  const order: [Table | null, MapNoteProblem[], string][] = [[p.hexT, p.hexes.bad, "Hexes"], [p.pathT, p.paths.bad, "Paths"]];
  order.sort((a, b) => (b[0]?.end ?? -1) - (a[0]?.end ?? -1));
  for (const [t, bad, what] of order) insertAfter(t, bad, what);
  if (p.front.problems.length) lines = [...problemCallout(p.front.problems, "settings"), "", ...lines];
  const out = text.slice(0, p.fm!.index + p.fm![0].length) + lines.join("\n");
  return out === text ? content : out;
}

/** Comparison key: same key ⇔ same map data (ignores formatting). */
export function mapNoteKey(data: MapNoteData): string {
  const s = data.settings as Record<string, unknown>;
  const settings = Object.keys(s).filter((k) => s[k] !== undefined && !SKIP_FIELDS.has(k) || k === "gridSize" || k === "gridOffset").sort().map((k) => [k, s[k]]);
  const hexes = hexRowsToWrite(data.hexes, data.settings.baseTerrain);
  return JSON.stringify([settings, hexes, data.paths.map((p) => (p.extra ? [p.typeName, p.hexes, p.extra] : [p.typeName, p.hexes]))]);
}

/** Hex-note frontmatter keys that hold map data (they live in the map note). */
const HEX_NOTE_DATA_KEY = /^(terrain|icon|gm-icons|gm-icon|region|duckmage-submap|locked|hexmaker-map)\s*:/;

/**
 * Prepare a new hex note's text: drop map-data keys a template may carry
 * (the default one had `terrain:`) and point at the map note instead, so
 * nobody edits a terrain field that the map no longer reads.
 */
export function withMapLink(content: string, mapName: string): string {
  const link = `hexmaker-map: "[[_${mapName}]]"`;
  const nl = content.includes("\r\n") ? "\r\n" : "\n";
  const m = /^---\r?\n([\s\S]*?)\r?\n?---(\r?\n|$)/.exec(content);
  if (!m) return `---${nl}${link}${nl}---${nl}${content}`;
  const kept: string[] = [link];
  let inDropped = false;
  for (const line of m[1].split(/\r?\n/)) {
    if (HEX_NOTE_DATA_KEY.test(line)) { inDropped = true; continue; }
    // indented lines (list items) belong to the key above them
    if (inDropped && /^\s+\S/.test(line)) continue;
    inDropped = false;
    if (line.trim()) kept.push(line);
  }
  return `---${nl}${kept.join(nl)}${nl}---${m[2] || nl}${content.slice(m[0].length)}`;
}
