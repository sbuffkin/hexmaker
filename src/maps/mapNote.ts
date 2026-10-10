import type { MapData, PathChain } from "../types";

/**
 * Map notes: one note per map ("hexes/<map>/_<map>.md") holding the map's
 * settings in frontmatter, every hex's map data in a "Hexes" table, and its
 * roads/rivers in a "Paths" table. Hex notes only hold prose and links —
 * a hex without content has no note at all.
 *
 *   ---
 *   hexmaker-map: 1
 *   palette: Default
 *   cols: 38
 *   rows: 25
 *   …
 *   ---
 *   ## Hexes
 *   | Hex | Name | Terrain | Icon | GM icons | Region | Submap | Locked |
 *   | 3_4 | Glass Wastes | dunes |  |  | Basin |  |  |
 *   ## Paths
 *   | Type | Hexes |
 *   | Road | 3_4 4_4 5_4 |
 *
 * Text outside the two tables, and frontmatter keys this file doesn't own,
 * are the user's and survive rewrites.
 */

export const MAP_NOTE_MARKER = "hexmaker-map";

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
}

/** Settings stored in a map note: MapData minus its name, paths and the
 *  per-session viewport (which stays in data.json). */
export type MapSettings = Omit<MapData, "name" | "pathChains" | "savedViewport">;

export interface MapNoteData {
  settings: Partial<MapSettings>;
  hexes: Map<string, HexData>;
  paths: PathChain[];
}

// ── frontmatter ──────────────────────────────────────────────────────────

/** MapData field ↔ frontmatter key for the fields given their own line. */
const SCALAR_KEYS: [keyof MapSettings, string][] = [
  ["paletteName", "palette"],
  ["staggerOffset", "stagger"],
  ["baseTerrain", "base-terrain"],
  ["terrainType", "terrain-theme"],
  ["createdWith", "created-with"],
  ["showCoords", "show-coords"],
  ["showTerrainIcons", "show-terrain-icons"],
  ["showIconOverrides", "show-icon-overrides"],
  ["showPaths", "show-paths"],
  ["showFactionOverlay", "show-faction-overlay"],
  ["showRegionOverlay", "show-region-overlay"],
  ["showGmLayer", "show-gm-layer"],
  ["showTokens", "show-tokens"],
  ["showHexNames", "show-hex-names"],
  ["showTokenNames", "show-token-names"],
  ["gridDisplayScale", "grid-display-scale"],
  ["gridDisplayScaleX", "grid-display-scale-x"],
  ["gridDisplayScaleY", "grid-display-scale-y"],
  ["gridDisplayOffsetX", "grid-display-offset-x"],
  ["gridDisplayOffsetY", "grid-display-offset-y"],
];
/** Fields written as one JSON value each (objects). */
const JSON_KEYS: [keyof MapSettings, string][] = [
  ["parent", "parent"],
  ["world", "world"],
  ["backgroundImage", "background-image"],
];
/**
 * Region biome (MapData.biome = { generator, from? }) as two readable keys,
 * `biome: <generator>` and `biome-from: [a, b]` for transition regions.
 * Hand-editing `biome` is how a user says "treat this region as deep
 * forest" for later neighbour blends.
 */
const BIOME_KEY = "biome";
const BIOME_FROM_KEY = "biome-from";
/** Catch-all for MapData fields this file doesn't know (future/other branches). */
const EXTRA_KEY = "hexmaker-extra";
const OWNED = new Set<string>([
  MAP_NOTE_MARKER, "cols", "rows", "offset-x", "offset-y", EXTRA_KEY, BIOME_KEY, BIOME_FROM_KEY,
  ...SCALAR_KEYS.map(([, k]) => k), ...JSON_KEYS.map(([, k]) => k),
]);
const SKIP_FIELDS = new Set(["name", "pathChains", "savedViewport", "gridSize", "gridOffset"]);

/** A YAML scalar (JSON is valid YAML, so anything non-trivial is JSON-quoted). */
function yamlValue(v: unknown): string {
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "string") return /^[\w][\w .()/@-]*$/.test(v) && !v.endsWith(" ") && !/^(true|false|null|yes|no|\d[\d.eE+-]*)$/i.test(v) ? v : JSON.stringify(v);
  return JSON.stringify(v);
}

function parseValue(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return undefined;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^["{[]/.test(t)) {
    try { return JSON.parse(t); } catch { /* fall through */ }
  }
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/** A YAML flow list, JSON or hand-written (`[a, b]` without quotes), or one bare value. */
function parseList(raw: string): string[] {
  const v = parseValue(raw);
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x !== "");
  if (typeof v !== "string" || !v) return [];
  const inner = /^\[(.*)\]$/.exec(v);
  return (inner ? inner[1].split(",") : [v]).map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

function frontmatterLines(settings: Partial<MapSettings>): string[] {
  const s = settings as Record<string, unknown>;
  const lines = [`${MAP_NOTE_MARKER}: 1`];
  if (settings.gridSize) lines.push(`cols: ${settings.gridSize.cols}`, `rows: ${settings.gridSize.rows}`);
  if (settings.gridOffset) lines.push(`offset-x: ${settings.gridOffset.x}`, `offset-y: ${settings.gridOffset.y}`);
  for (const [field, key] of SCALAR_KEYS) if (s[field] !== undefined) lines.push(`${key}: ${yamlValue(s[field])}`);
  for (const [field, key] of JSON_KEYS) if (s[field] !== undefined) lines.push(`${key}: ${JSON.stringify(s[field])}`);
  const biome = s.biome as { generator?: unknown; from?: unknown } | undefined;
  const biomeReadable = !!biome && typeof biome.generator === "string" && biome.generator !== ""
    && Object.keys(biome).every((k) => k === "generator" || k === "from")
    && (biome.from === undefined || (Array.isArray(biome.from) && biome.from.every((v) => typeof v === "string")));
  if (biomeReadable) {
    lines.push(`${BIOME_KEY}: ${yamlValue(biome.generator)}`);
    if (Array.isArray(biome.from) && biome.from.length) lines.push(`${BIOME_FROM_KEY}: ${JSON.stringify(biome.from)}`);
  }
  const known = new Set<string>([...SCALAR_KEYS, ...JSON_KEYS].map(([f]) => f as string));
  if (biomeReadable) known.add("biome");
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined || known.has(k) || SKIP_FIELDS.has(k)) continue;
    extra[k] = v;
  }
  if (Object.keys(extra).length) lines.push(`${EXTRA_KEY}: ${JSON.stringify(extra)}`);
  return lines;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---(\n|$)/;

function parseFrontmatter(body: string): Partial<MapSettings> {
  const raw = new Map<string, string>();
  for (const line of body.split("\n")) {
    const m = /^([\w-]+):(.*)$/.exec(line);
    if (m) raw.set(m[1], m[2]);
  }
  const out: Record<string, unknown> = {};
  const num = (k: string) => {
    const v = parseValue(raw.get(k) ?? "");
    return typeof v === "number" ? v : undefined;
  };
  const cols = num("cols"), rows = num("rows");
  if (cols !== undefined && rows !== undefined) out.gridSize = { cols, rows };
  const ox = num("offset-x"), oy = num("offset-y");
  if (ox !== undefined && oy !== undefined) out.gridOffset = { x: ox, y: oy };
  for (const [field, key] of [...SCALAR_KEYS, ...JSON_KEYS]) {
    if (!raw.has(key)) continue;
    const v = parseValue(raw.get(key)!);
    if (v !== undefined) out[field] = v;
  }
  const gen = parseValue(raw.get(BIOME_KEY) ?? "");
  if (typeof gen === "string" && gen) {
    const biome: { generator: string; from?: string[] } = { generator: gen };
    const from = parseList(raw.get(BIOME_FROM_KEY) ?? "");
    if (from.length) biome.from = from;
    out.biome = biome;
  }
  const extra = parseValue(raw.get(EXTRA_KEY) ?? "");
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    for (const [k, v] of Object.entries(extra as Record<string, unknown>)) if (!(k in out)) out[k] = v;
  }
  return out;
}

// ── tables ───────────────────────────────────────────────────────────────

const HEX_HEADERS = ["Hex", "Name", "Terrain", "Icon", "GM icons", "Region", "Submap", "Locked"];
const PATH_HEADERS = ["Type", "Hexes"];
const SEPARATOR_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

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

const esc = (v: string | undefined) => (v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

/** First table whose header has all of `need` (case-insensitive). */
function findTable(lines: string[], need: string[]): { start: number; end: number; cols: string[] } | null {
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith("|") || !SEPARATOR_ROW.test(lines[i + 1])) continue;
    const cols = splitRow(lines[i]).map((c) => c.toLowerCase());
    if (!need.every((n) => cols.includes(n))) continue;
    let end = i + 2;
    while (end < lines.length && lines[end].trim().startsWith("|")) end++;
    return { start: i, end, cols };
  }
  return null;
}

/** Sort "x_y" keys by row then column, like reading a map. */
export function compareHexKeys(a: string, b: string): number {
  const [ax, ay] = a.split("_").map(Number);
  const [bx, by] = b.split("_").map(Number);
  return ay - by || ax - bx;
}

/** Anything besides terrain set on a hex. */
function hasNonTerrainData(h: HexData): boolean {
  return !!(h.name || h.icon || (h.gmIcons && h.gmIcons.length) || h.region || h.submap || h.locked);
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

function hexTable(hexes: Map<string, HexData>, baseTerrain?: string): string {
  const lines = [`| ${HEX_HEADERS.join(" | ")} |`, `| ${HEX_HEADERS.map(() => "---").join(" | ")} |`];
  for (const [k, h] of hexRowsToWrite(hexes, baseTerrain)) {
    lines.push(`| ${[k, h.name, h.terrain, h.icon, h.gmIcons?.join(", "), h.region, h.submap, h.locked ? "yes" : ""].map(esc).join(" | ")} |`);
  }
  return lines.join("\n");
}

function pathTable(paths: PathChain[]): string {
  const lines = [`| ${PATH_HEADERS.join(" | ")} |`, `| ${PATH_HEADERS.map(() => "---").join(" | ")} |`];
  for (const p of paths) lines.push(`| ${esc(p.typeName)} | ${p.hexes.join(" ")} |`);
  return lines.join("\n");
}

function parseHexTable(lines: string[]): Map<string, HexData> {
  const out = new Map<string, HexData>();
  const t = findTable(lines, ["hex", "terrain"]);
  if (!t) return out;
  const col = (name: string) => t.cols.indexOf(name);
  const ci = { hex: col("hex"), name: col("name"), terrain: col("terrain"), icon: col("icon"), gm: col("gm icons"), region: col("region"), submap: col("submap"), locked: col("locked") };
  for (let i = t.start + 2; i < t.end; i++) {
    const c = splitRow(lines[i]);
    const key = c[ci.hex];
    if (!key || !/^-?\d+_-?\d+$/.test(key)) continue;
    const h: HexData = {};
    const get = (j: number) => (j >= 0 ? c[j] : "") || undefined;
    // Notes from before hex names have no Name column (index -1): no name.
    if (get(ci.name)) h.name = get(ci.name);
    if (get(ci.terrain)) h.terrain = get(ci.terrain);
    if (get(ci.icon)) h.icon = get(ci.icon);
    const gm = get(ci.gm);
    if (gm) h.gmIcons = gm.split(",").map((s) => s.trim()).filter(Boolean);
    if (get(ci.region)) h.region = get(ci.region);
    if (get(ci.submap)) h.submap = get(ci.submap);
    if (/^(yes|true|x|✓)$/i.test(get(ci.locked) ?? "")) h.locked = true;
    out.set(key, h);
  }
  return out;
}

function parsePathTable(lines: string[]): PathChain[] {
  const t = findTable(lines, ["type", "hexes"]);
  if (!t) return [];
  const ti = t.cols.indexOf("type"), hi = t.cols.indexOf("hexes");
  const out: PathChain[] = [];
  for (let i = t.start + 2; i < t.end; i++) {
    const c = splitRow(lines[i]);
    const hexes = (c[hi] ?? "").split(/[\s,]+/).filter((k) => /^-?\d+_-?\d+$/.test(k));
    if (c[ti] && hexes.length) out.push({ typeName: c[ti], hexes });
  }
  return out;
}

// ── whole note ───────────────────────────────────────────────────────────

/** Parse a map note, or null if it isn't one. */
export function parseMapNote(content: string): MapNoteData | null {
  const text = content.replace(/\r\n?/g, "\n");
  const fm = FRONTMATTER.exec(text);
  if (!fm || !new RegExp(`^${MAP_NOTE_MARKER}:`, "m").test(fm[1])) return null;
  const lines = text.split("\n");
  return { settings: parseFrontmatter(fm[1]), hexes: parseHexTable(lines), paths: parsePathTable(lines) };
}

/** A fresh map note. */
export function buildMapNote(name: string, data: MapNoteData): string {
  return [
    "---",
    ...frontmatterLines(data.settings),
    "---",
    `# ${name}`,
    "",
    "Hexmaker map. Each hex's name, terrain, icons, region and submap live in the table below — edit it here or paint on the map. Hex notes hold descriptions and links, and only exist once a hex has some.",
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
 * Rewrite our parts of an existing map note — owned frontmatter keys and
 * the two tables — keeping everything else the user added.
 */
export function updateMapNote(content: string, name: string, data: MapNoteData): string {
  const text = content.replace(/\r\n?/g, "\n");
  const fm = FRONTMATTER.exec(text);
  if (!fm) return buildMapNote(name, data);
  const userFm = fm[1].split("\n").filter((l) => {
    const m = /^([\w-]+):/.exec(l);
    return !m || !OWNED.has(m[1]);
  });
  let lines = text.slice(fm[0].length).split("\n");
  const replace = (need: string[], table: string, heading: string) => {
    const t = findTable(lines, need);
    if (t) lines = [...lines.slice(0, t.start), ...table.split("\n"), ...lines.slice(t.end)];
    else lines = [...lines, "", heading, "", ...table.split("\n")];
  };
  replace(["hex", "terrain"], hexTable(data.hexes, data.settings.baseTerrain), "## Hexes");
  replace(["type", "hexes"], pathTable(data.paths), "## Paths");
  return ["---", ...frontmatterLines(data.settings), ...userFm.filter((l) => l.trim()), "---", ...lines].join("\n");
}

/** Comparison key: same key ⇔ same map data (ignores formatting). */
export function mapNoteKey(data: MapNoteData): string {
  const s = data.settings as Record<string, unknown>;
  const settings = Object.keys(s).filter((k) => s[k] !== undefined && !SKIP_FIELDS.has(k) || k === "gridSize" || k === "gridOffset").sort().map((k) => [k, s[k]]);
  const hexes = hexRowsToWrite(data.hexes, data.settings.baseTerrain);
  return JSON.stringify([settings, hexes, data.paths.map((p) => [p.typeName, p.hexes])]);
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
