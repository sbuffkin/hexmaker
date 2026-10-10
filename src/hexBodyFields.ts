/**
 * "**Terrain:** forest" and "**Region:** Basin" lines in a hex note's body.
 *
 * Older hex templates wrote these as lines to fill in by hand. Terrain and
 * region now live in the map note, so such a line can disagree with the map
 * (fresh-eyes audit 2026-10-10: 87 of 98 filled Terrain lines did). They are
 * the user's words, so they are never removed: the hex editor shows a line
 * that disagrees with the map and offers to apply it to the map or to bring
 * the line up to date.
 */

export type BodyField = "Terrain" | "Region";

export const BODY_FIELDS: BodyField[] = ["Terrain", "Region"];

const lineRe = (field: BodyField) => new RegExp(`^([ \\t]*\\*\\*${field}:?\\*\\*:?[ \\t]*)(.*?)[ \\t]*$`, "mi");

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

/** The note with its "**Field:**" line set to `value` (unchanged when there's no such line). */
export function setBodyField(content: string, field: BodyField, value: string): string {
  return content.replace(lineRe(field), (_m, head: string) => `${head.replace(/[ \t]*$/, " ")}${value}`.replace(/ $/, ""));
}

/** Two names for the same thing (case and spacing aside)? */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return n(a) === n(b);
}
