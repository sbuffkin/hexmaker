/**
 * Note-format changes approved in round 6 (NF1, NF3), as pure text helpers.
 * The one-time vault rewrites that use them are in noteFormatUpgrade.ts.
 *
 * NF1: a hex note points at its map note with `map: "[[_coast]]"`. Older
 * notes say `hexmaker-map: "[[_coast]]"` (the same key map notes use for
 * their format number, which made the two hard to tell apart). Both are
 * read forever. A hex note whose `map:` key is the user's own (anything but
 * a link to a map note) keeps it, and the plugin uses `hexmaker-map` there.
 *
 * NF3: a token note says which map it's on with `token-map: "[[_coast]]"`
 * (a link to the map note, so renames flow through Obsidian's link
 * updating). Older notes say `token-map: coast`; both are read forever.
 *
 * No Obsidian imports, so tests can use it directly.
 */

/** Hex notes: the key holding the link to the hex's map note. */
export const HEX_MAP_KEY = "map";
/** Hex notes before NF1 (still read; written only where `map` is the user's). */
export const LEGACY_HEX_MAP_KEY = "hexmaker-map";

/** A name that can sit inside [[…]] unchanged. */
const linkSafe = (s: string) => !!s && !/[[\]|#^]/.test(s);

const WIKILINK = /^\s*!?\[\[([^\]|#]*)(?:[#|][^\]]*)?\]\]\s*$/;

/** The link to a map's note (`[[_coast]]`), or the plain name when it can't be a link. */
export function mapNoteLink(map: string): string {
  return linkSafe(map) ? `[[_${map}]]` : map;
}

/**
 * The map a `token-map` / hex-note map value names: a link to its map note
 * (`[[_coast]]`, `[[hexes/coast/_coast|Coast]]`) or the plain name
 * (`coast`, the older form). "" when blank or not a string.
 */
export function mapNameFromRef(value: unknown): string {
  if (typeof value !== "string") return "";
  const m = WIKILINK.exec(value);
  if (!m) return value.trim();
  return (m[1].trim().split("/").pop() ?? "").replace(/\.md$/i, "").replace(/^_/, "");
}

/** Is this value a link to a map note (`[[_name]]`, any folder, alias allowed)? */
export function isMapNoteLink(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const m = WIKILINK.exec(value);
  return !!m && /^_/.test(m[1].trim().split("/").pop() ?? "");
}

/**
 * The map a hex note says it belongs to: `map:` when it's a link to a map
 * note, else the older `hexmaker-map:`. "" when neither.
 */
export function hexNoteMapName(fm: Record<string, unknown> | null | undefined): string {
  if (!fm) return "";
  if (isMapNoteLink(fm[HEX_MAP_KEY])) return mapNameFromRef(fm[HEX_MAP_KEY]);
  if (isMapNoteLink(fm[LEGACY_HEX_MAP_KEY])) return mapNameFromRef(fm[LEGACY_HEX_MAP_KEY]);
  return "";
}

/**
 * The key to write a hex note's map link under: `map`, unless the note
 * already uses `map` for something of its own (then `hexmaker-map`).
 */
export function hexNoteMapKey(fm: Record<string, unknown> | null | undefined): string {
  if (!fm || !(HEX_MAP_KEY in fm) || fm[HEX_MAP_KEY] === null || fm[HEX_MAP_KEY] === "") return HEX_MAP_KEY;
  return isMapNoteLink(fm[HEX_MAP_KEY]) ? HEX_MAP_KEY : LEGACY_HEX_MAP_KEY;
}

// ── raw frontmatter text (keeps formatting, comments and key order) ──────

interface FmSpan { start: number; end: number; lines: string[]; eol: string }

function fmLines(content: string): FmSpan | null {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  return end > 0 ? { start: 1, end, lines, eol } : null;
}

/** `key: value` line at the top level of frontmatter → its index, or -1. */
function keyLine(span: FmSpan, key: string): number {
  const re = new RegExp(`^["']?${key.replace(/[-]/g, "\\-")}["']?\\s*:`);
  for (let i = span.start; i < span.end; i++) if (re.test(span.lines[i])) return i;
  return -1;
}

/** A scalar written after `key:` → its string value (quotes taken off). */
function scalarOf(line: string): string {
  const raw = line.slice(line.indexOf(":") + 1).trim();
  if (raw.startsWith('"')) {
    try { return JSON.parse(raw) as string; } catch { return raw.slice(1, raw.endsWith('"') ? -1 : undefined); }
  }
  if (raw.startsWith("'")) return raw.slice(1, raw.endsWith("'") ? -1 : undefined).replace(/''/g, "'");
  return raw.replace(/\s+#.*$/, "");
}

export type HexMapKeyRewrite =
  /** `hexmaker-map:` became `map:`. */
  | "renamed"
  /** Nothing to do (no old key, or it isn't a map link). */
  | "none"
  /** The note has its own `map:` key: left as it is. */
  | "conflict";

/**
 * NF1 for one hex note's text: `hexmaker-map: "[[_coast]]"` → `map:
 * "[[_coast]]"`, changing only that key's name (value, quoting, comments
 * and other keys stay). Left alone: notes without the old key, notes whose
 * old key isn't a link to a map note (a map note's format number), and
 * notes that already have a `map:` key of their own ("conflict").
 */
export function renameHexMapKey(content: string): { content: string; status: HexMapKeyRewrite } {
  const span = fmLines(content);
  if (!span) return { content, status: "none" };
  const old = keyLine(span, LEGACY_HEX_MAP_KEY);
  if (old < 0 || !isMapNoteLink(scalarOf(span.lines[old]))) return { content, status: "none" };
  const cur = keyLine(span, HEX_MAP_KEY);
  if (cur >= 0) {
    // Already ours (both keys, same link): drop the old one.
    if (isMapNoteLink(scalarOf(span.lines[cur])) && mapNameFromRef(scalarOf(span.lines[cur])) === mapNameFromRef(scalarOf(span.lines[old]))) {
      const lines = [...span.lines];
      lines.splice(old, 1);
      return { content: lines.join(span.eol), status: "renamed" };
    }
    return { content, status: "conflict" };
  }
  const lines = [...span.lines];
  lines[old] = lines[old].replace(/^["']?hexmaker-map["']?(\s*:)/, `${HEX_MAP_KEY}$1`);
  return { content: lines.join(span.eol), status: "renamed" };
}

/**
 * NF3 for one token note's text: `token-map: coast` → `token-map:
 * "[[_coast]]"`. Unchanged when the value is already a link, blank, not a
 * name that can be a link, or the note isn't a token (`token:` missing or
 * false).
 */
export function linkTokenMap(content: string): { content: string; changed: boolean } {
  const span = fmLines(content);
  if (!span) return { content, changed: false };
  const token = keyLine(span, "token");
  if (token < 0 || /^(false|no|off|0|)$/i.test(scalarOf(span.lines[token]))) return { content, changed: false };
  const at = keyLine(span, "token-map");
  if (at < 0) return { content, changed: false };
  const value = scalarOf(span.lines[at]);
  if (!value.trim() || WIKILINK.test(value) || !linkSafe(value.trim())) return { content, changed: false };
  const lines = [...span.lines];
  lines[at] = `token-map: ${JSON.stringify(mapNoteLink(value.trim()))}`;
  return { content: lines.join(span.eol), changed: true };
}

// ── links to other notes (token-link, workflow template-file) ─────────────

/** A vault path as a wikilink (`[[world/npcs/Ana]]`, ".md" off), or the path as is when it can't be one. */
export function noteLink(path: string): string {
  const p = path.trim().replace(/\.md$/i, "");
  return linkSafe(p) ? `[[${p}]]` : path.trim();
}

/**
 * A note reference as written: `[[path|alias]]` → its link text (`path`),
 * a quoted or plain path → the path. Whether it's a link is reported too.
 */
export function noteRefTarget(value: unknown): { target: string; link: boolean } {
  if (typeof value !== "string") return { target: "", link: false };
  const v = value.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  const m = WIKILINK.exec(v);
  return m ? { target: m[1].trim(), link: true } : { target: v, link: false };
}

/**
 * NF3 for one frontmatter key holding a note path (`token-link:
 * world/npcs/Ana.md`, `template-file: world/workflows/templates/npc.md`):
 * the path becomes a wikilink, `exists(path)` permitting (a path that
 * names no note is left as typed). Already a link, blank or missing:
 * unchanged.
 */
export function linkNotePathKey(content: string, key: string, exists: (path: string) => boolean): { content: string; changed: boolean } {
  const span = fmLines(content);
  if (!span) return { content, changed: false };
  const at = keyLine(span, key);
  if (at < 0) return { content, changed: false };
  const value = scalarOf(span.lines[at]).trim();
  if (!value || WIKILINK.test(value)) return { content, changed: false };
  const path = /\.md$/i.test(value) ? value : `${value}.md`;
  if (!exists(path)) return { content, changed: false };
  const link = noteLink(path);
  if (link === value) return { content, changed: false };
  const lines = [...span.lines];
  lines[at] = `${key}: ${JSON.stringify(link)}`;
  return { content: lines.join(span.eol), changed: true };
}

// ── the remaining references (palettes, generators, maps by name) ─────────

/**
 * A note's name from a reference as written: `[[world/palettes/Default]]`
 * or `[[Default|My palette]]` → `Default`, plain `Default` → `Default`.
 * "" when blank or not a string. Readers of the keys below take both forms
 * forever (NF3 follow-up: links are written from now on).
 */
export function refBasename(value: unknown): string {
  if (typeof value !== "string") return "";
  const m = WIKILINK.exec(value);
  if (!m) return value.trim();
  return (m[1].trim().split("/").pop() ?? "").replace(/\.md$/i, "").trim();
}

/** A note path (".md" optional) as `[[path]]`, or undefined when it can't be a link. */
export function pathLink(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const p = path.trim().replace(/\.md$/i, "");
  return linkSafe(p) ? `[[${p}]]` : undefined;
}

/**
 * The items of a list value: a YAML flow list (`["[[_a]]", b]`) or names
 * joined by " + " (the older form: `a + b`). Quotes are taken off; links
 * stay as written.
 */
export function refListItems(raw: string | undefined): string[] {
  const t = (raw ?? "").trim();
  if (!t) return [];
  if (t.startsWith("[") && !t.startsWith("[[")) {
    try {
      const v = JSON.parse(t) as unknown;
      if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    } catch { /* not JSON: read it loosely */ }
    return splitFlow(t.slice(1, t.endsWith("]") ? -1 : undefined));
  }
  return t.split(" + ").map((s) => s.trim()).filter(Boolean);
}

/** `a, "b, c", [[d]]` → items (commas inside quotes or [[ ]] don't split). */
function splitFlow(body: string): string[] {
  const out: string[] = [];
  let cur = "", quote = "", depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { if (c === quote) quote = ""; else cur += c; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "[" && body[i + 1] === "[") { depth++; cur += "[["; i++; continue; }
    if (c === "]" && body[i + 1] === "]") { depth = Math.max(0, depth - 1); cur += "]]"; i++; continue; }
    if (c === "," && !depth) { if (cur.trim()) out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Items as a YAML flow list (`["[[_a]]", "b"]`): Obsidian reads it as a list property, links and all. */
export function flowList(items: readonly string[]): string {
  return `[${items.map((i) => JSON.stringify(i)).join(", ")}]`;
}

/**
 * One frontmatter key's plain value → a link: `toLink(value)` gives the
 * link text, or undefined to leave it as typed (a name that names no
 * note). Already a link, blank or missing: unchanged. Only that line
 * changes.
 */
export function linkFrontmatterKey(content: string, key: string, toLink: (value: string) => string | undefined): { content: string; changed: boolean } {
  const span = fmLines(content);
  if (!span) return { content, changed: false };
  const at = keyLine(span, key);
  if (at < 0) return { content, changed: false };
  const value = scalarOf(span.lines[at]).trim();
  if (!value || WIKILINK.test(value) || value.startsWith("[")) return { content, changed: false };
  const link = toLink(value);
  if (!link || link === value) return { content, changed: false };
  const lines = [...span.lines];
  lines[at] = `${key}: ${JSON.stringify(link)}`;
  return { content: lines.join(span.eol), changed: true };
}

/**
 * A key holding names joined by " + " (`source-maps: a + b`) → a flow list
 * of links (`["[[_a]]", "[[_b]]"]`); each name `toLink` can't link stays as
 * typed in the list. Unchanged when no name links, or the value is already
 * a list.
 */
export function linkFrontmatterList(content: string, key: string, toLink: (name: string) => string | undefined): { content: string; changed: boolean } {
  const span = fmLines(content);
  if (!span) return { content, changed: false };
  const at = keyLine(span, key);
  if (at < 0) return { content, changed: false };
  const raw = span.lines[at].slice(span.lines[at].indexOf(":") + 1).trim();
  if (!raw || raw.startsWith("[")) return { content, changed: false };
  const names = refListItems(scalarOf(span.lines[at]));
  const items = names.map((n) => (WIKILINK.test(n) ? n : toLink(n) ?? n));
  if (!items.some((v, i) => v !== names[i])) return { content, changed: false };
  const lines = [...span.lines];
  lines[at] = `${key}: ${flowList(items)}`;
  return { content: lines.join(span.eol), changed: true };
}
