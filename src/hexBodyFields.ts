/**
 * "**Terrain:** forest" and "**Region:** Basin" lines in a hex note's body.
 *
 * Older hex templates wrote these as lines to fill in by hand. Terrain and
 * region now live in the map note, so such a line can disagree with the map
 * (fresh-eyes audit 2026-10-10: 87 of 98 filled Terrain lines did). They are
 * the user's words, so they are never deleted: a filled line moves into the
 * note's Map data callout as an "Old terrain:" / "Old region:" line (NF2,
 * see hexMapData.ts), where it sits under the map's own value and never
 * changes the map. Empty lines and template placeholders stay where they are.
 */

export type BodyField = "Terrain" | "Region";

export const BODY_FIELDS: BodyField[] = ["Terrain", "Region"];

const lineRe = (field: BodyField, flags = "mi") => new RegExp(`^([ \\t]*\\*\\*${field}:?\\*\\*:?[ \\t]*)(.*?)([ \\t]*)$`, flags);

/** Template placeholders like "*(woods / marsh / …)*" or "(fill in)": not a value. */
function isPlaceholder(v: string): boolean {
  const s = v.trim();
  return s === "" || /^\*?\(.*\)\*?$/.test(s) || /^_+$/.test(s) || s === "-" || s === "—";
}

/** The value written on the note's "**Field:**" line, or undefined when it's absent, empty or a placeholder. */
export function readBodyField(content: string, field: BodyField): string | undefined {
  const m = lineRe(field).exec(content);
  if (!m) return undefined;
  const v = m[2].replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_a, target: string, alias?: string) => alias ?? target).trim();
  return isPlaceholder(v) ? undefined : v;
}

/** A filled body line taken out of a note: which field, and its value exactly as typed. */
export interface TakenBodyField {
  field: BodyField;
  value: string;
}

/**
 * The note without its filled "**Terrain:**" / "**Region:**" lines, and
 * what they said (as typed, links kept), in note order. Empty lines and
 * placeholders stay. A blank line left doubled by a removal is dropped
 * too. Nothing to take: the content comes back unchanged.
 */
export function takeBodyFields(content: string): { content: string; taken: TakenBodyField[] } {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/);
  // Frontmatter is never read as body.
  let from = 0;
  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (close > 0) from = close + 1;
  }
  const taken: TakenBodyField[] = [];
  const keep: string[] = lines.slice(0, from);
  for (let i = from; i < lines.length; i++) {
    const line = lines[i];
    const field = BODY_FIELDS.find((f) => lineRe(f, "i").test(line));
    const m = field ? lineRe(field, "i").exec(line) : null;
    if (!field || !m || isPlaceholder(m[2])) { keep.push(line); continue; }
    taken.push({ field, value: m[2].trim() });
    // Don't leave two blank lines where the line was.
    if (keep.length && keep[keep.length - 1].trim() === "" && (lines[i + 1] ?? "").trim() === "") i++;
  }
  if (!taken.length) return { content, taken };
  return { content: keep.join(eol), taken };
}

/** Two names for the same thing (case and spacing aside)? */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return n(a) === n(b);
}
