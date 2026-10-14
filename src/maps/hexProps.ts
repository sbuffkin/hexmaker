/**
 * Hex-note properties (owner MG4): plain frontmatter copies of a hex's map
 * data in its hex note, so Dataview, Bases and search can query them.
 *
 *   ---
 *   map: "[[_coast]]"
 *   terrain: forest
 *   area: Basin
 *   icon: castle.png
 *   name: Glass Wastes
 *   ---
 *
 * The map note stays the source of truth. The plugin writes these keys
 * whenever the hex's map data changes (only into notes that exist), and a
 * hand edit of one of them goes to the map (src/maps/hexPropsSync.ts).
 * `region:` (what 1.5 wrote for the area) is read as `area` and rewritten
 * as `area`.
 *
 * Telling a hand edit from a stale copy needs what the plugin last wrote
 * (`base`, kept outside the notes like the Map data callout's memory):
 *
 * - note = map: nothing to do.
 * - note = base: a stale copy; the map wins (the property is rewritten).
 * - note ≠ base and map = base: a hand edit; it goes to the map.
 * - note ≠ base and map ≠ base: both changed. **The map wins** (the map
 *   note is the source of truth; the property is rewritten).
 * - no base (a note never written by this device): only a value the map
 *   doesn't have is taken from the note; any other difference: the map
 *   wins.
 *
 * Pure: no Obsidian imports. Values are compared exactly (trimmed); the
 * import matches palette and icon names ignoring case and the next write
 * puts the map's spelling back.
 */
import type { HexData } from "./mapNote";

/** The properties, in the order they're added to a note. */
export const PROP_FIELDS = ["terrain", "area", "icon", "name"] as const;
export type PropField = (typeof PROP_FIELDS)[number];
export type HexProps = Partial<Record<PropField, string>>;

/** The 1.5 key for the area: read as `area`, never written. */
export const OLD_AREA_KEY = "region";

/** Every frontmatter key the properties own in a hex note. */
export const PROP_KEYS: readonly string[] = [...PROP_FIELDS, OLD_AREA_KEY];

/** The properties a hex's map data gives its note. */
export function propsOf(h: HexData | undefined): HexProps {
  const out: HexProps = {};
  if (h?.terrain) out.terrain = h.terrain;
  if (h?.region) out.area = h.region;
  if (h?.icon) out.icon = h.icon;
  if (h?.name) out.name = h.name;
  return out;
}

/** What a note's frontmatter says. */
export interface NoteProps {
  props: HexProps;
  /** Fields whose value isn't a plain value (a list, a map): not read, rewritten from the map. */
  unreadable: PropField[];
  /** The note still has the 1.5 `region:` key. */
  oldAreaKey: boolean;
}

/** `[[target|alias]]` → target (a link typed into a property reads as its name). */
const unlink = (v: string) => v.replace(/^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/, "$1").trim();

/** A frontmatter value as a property: undefined = none, null = unreadable. */
function valueOf(v: unknown): string | undefined | null {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return unlink(v.trim()) || undefined;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.length === 1 && typeof v[0] === "string") return unlink(v[0].trim()) || undefined;
  if (Array.isArray(v) && v.length === 0) return undefined;
  return null;
}

/** Read the properties out of parsed frontmatter (`area`, else the old `region`). */
export function readProps(fm: Record<string, unknown> | null | undefined): NoteProps {
  const out: NoteProps = { props: {}, unreadable: [], oldAreaKey: !!fm && OLD_AREA_KEY in fm };
  if (!fm) return out;
  for (const f of PROP_FIELDS) {
    const raw = f === "area" && !("area" in fm) ? fm[OLD_AREA_KEY] : fm[f];
    const v = valueOf(raw);
    if (v === null) out.unreadable.push(f);
    else if (v !== undefined) out.props[f] = v;
  }
  return out;
}

/** Same values for every field. */
export function sameProps(a: HexProps, b: HexProps): boolean {
  return PROP_FIELDS.every((f) => (a[f] ?? "") === (b[f] ?? ""));
}

/** Does the note need a write to show `want` (different values, an unreadable one, or the old key)? */
export function needsWrite(note: NoteProps, want: HexProps): boolean {
  return note.oldAreaKey || note.unreadable.length > 0 || !sameProps(note.props, want);
}

export interface PropsPlan {
  /** Hand edits to put on the map: field → value (null = cleared). */
  imports: Partial<Record<PropField, string | null>>;
  /** Fields both sides changed: the map's value is kept (see the header). */
  mapWon: PropField[];
}

/** What to take from the note (see the header for the rules). */
export function planPropsSync(note: NoteProps, map: HexProps, base: HexProps | undefined): PropsPlan {
  const out: PropsPlan = { imports: {}, mapWon: [] };
  for (const f of PROP_FIELDS) {
    if (note.unreadable.includes(f)) continue;
    const n = note.props[f] ?? "", m = map[f] ?? "";
    if (n === m) continue;
    if (!base) {
      if (!m && n) out.imports[f] = n;
      continue;
    }
    const b = base[f] ?? "";
    if (n === b) continue; // stale copy
    if (m !== b) { out.mapWon.push(f); continue; }
    out.imports[f] = n || null;
  }
  return out;
}

/**
 * `setPropsInText` for a frontmatter object (processFrontMatter): the
 * property keys set to `props` where they are (`area` where `region` was),
 * new ones last, ones `props` lacks removed; fields in `keep` untouched.
 */
export function setPropsInFm(fm: Record<string, unknown>, props: HexProps, keep: readonly PropField[] = []): void {
  const entries = Object.entries(fm);
  for (const k of Object.keys(fm)) delete fm[k];
  const placed = new Set<PropField>();
  for (const [k, v] of entries) {
    const f = (k === OLD_AREA_KEY ? "area" : k) as PropField;
    if (!PROP_KEYS.includes(k) || keep.includes(f)) { fm[k] = v; continue; }
    if (placed.has(f) || !props[f] || (k === OLD_AREA_KEY && entries.some(([e]) => e === "area"))) continue;
    placed.add(f);
    fm[f] = props[f];
  }
  for (const f of PROP_FIELDS) if (props[f] && !placed.has(f) && !keep.includes(f)) fm[f] = props[f];
}

// ── raw frontmatter text (keeps the note's other keys, comments and order) ──

/** A value as a YAML scalar: plain when that reads back as the same string, else double-quoted. */
export function yamlScalar(v: string): string {
  const plain = /^[A-Za-z][\w .()/'&-]*$/.test(v) && !/\s$/.test(v) && !/^(true|false|yes|no|on|off|null)$/i.test(v);
  return plain ? v : JSON.stringify(v);
}

const FM_OPEN = /^---[ \t]*$/;

/**
 * The note's text with its property keys set to `props`: present keys are
 * rewritten in place, new ones added at the end of the frontmatter, ones
 * `props` lacks removed (with the old `region:` key; `area` takes its place).
 * Fields in `keep` aren't touched. A frontmatter left empty is removed; a
 * note without one gets one only when there's something to write. The
 * same text comes back when nothing changes.
 */
export function setPropsInText(content: string, props: HexProps, keep: readonly PropField[] = []): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  let end = -1;
  if (FM_OPEN.test(lines[0] ?? "")) end = lines.findIndex((l, i) => i > 0 && FM_OPEN.test(l));
  const owned = PROP_KEYS.filter((k) => !keep.includes(k as PropField) && !(k === OLD_AREA_KEY && keep.includes("area")));
  const want = PROP_FIELDS.filter((f) => !keep.includes(f) && props[f]);
  if (end < 0) {
    if (!want.length) return content;
    return ["---", ...want.map((f) => `${f}: ${yamlScalar(props[f]!)}`), "---", ...lines].join(eol);
  }
  const body = lines.slice(1, end);
  const keyOf = (l: string) => /^["']?([A-Za-z][\w-]*)["']?\s*:/.exec(l)?.[1];
  const out: string[] = [];
  const placed = new Set<string>();
  for (let i = 0; i < body.length; i++) {
    const k = keyOf(body[i]);
    if (!k || !owned.includes(k)) { out.push(body[i]); continue; }
    // A list or block value belongs to the key above it.
    while (i + 1 < body.length && /^(\s+\S|-\s)/.test(body[i + 1]) && !keyOf(body[i + 1])) i++;
    const f = (k === OLD_AREA_KEY ? "area" : k) as PropField;
    if (placed.has(f) || !props[f]) continue;
    // `area` written where `region` was, unless the note has an `area` line too.
    if (k === OLD_AREA_KEY && body.some((l) => keyOf(l) === "area")) continue;
    placed.add(f);
    out.push(`${f}: ${yamlScalar(props[f])}`);
  }
  for (const f of want) if (!placed.has(f)) out.push(`${f}: ${yamlScalar(props[f]!)}`);
  const unchanged = out.length === body.length && out.every((l, i) => l === body[i]);
  if (unchanged) return content;
  if (!out.some((l) => l.trim())) return lines.slice(end + 1).join(eol);
  return ["---", ...out, ...lines.slice(end)].join(eol);
}
