/**
 * A map note's `## Notes` section: a short, free-text description of the
 * map (an overworld region's notes, edited from "Edit region…"). It's plain
 * text under a plain heading, so it reads like a hand-written note and can
 * be edited in the note itself just as well; the map note's writer leaves
 * text outside its tables alone, so it survives every map write.
 *
 * Only the section's own lines are touched: from its heading to the next
 * `#` or `##` heading. A line typed in the box that would itself be such a
 * heading is escaped (`\## …`) so it can't end the section early, and is
 * read back unescaped.
 *
 * Pure: no Obsidian imports.
 */

export const NOTES_HEADING = "## Notes";

const NOTES_RE = /^##\s+notes\s*$/i;
/** A heading that ends the section (`#` or `##`, not `###` and deeper). */
const SECTION_END_RE = /^#{1,2}\s/;
const ESCAPED_RE = /^\\(#{1,2}\s)/;

function splitBody(content: string): { eol: string; front: string[]; lines: string[] } {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const all = content.split(/\r?\n/);
  // Skip the frontmatter (a `## Notes` there is YAML, not a heading).
  let start = 0;
  if (all[0]?.trim() === "---") {
    const close = all.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (close > 0) start = close + 1;
  }
  return { eol, front: all.slice(0, start), lines: all.slice(start) };
}

/** [heading, end) of the Notes section in `lines`, or null. */
function notesRange(lines: string[]): [number, number] | null {
  const at = lines.findIndex((l) => NOTES_RE.test(l));
  if (at < 0) return null;
  let end = at + 1;
  while (end < lines.length && !SECTION_END_RE.test(lines[end])) end++;
  return [at, end];
}

/** The Notes section's text (blank lines around it trimmed), or "" when there's none. */
export function readNotesSection(content: string): string {
  const { lines } = splitBody(content);
  const r = notesRange(lines);
  if (!r) return "";
  const body = lines.slice(r[0] + 1, r[1]).map((l) => l.replace(ESCAPED_RE, "$1"));
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  return body.join("\n");
}

/**
 * The note with its Notes section set to `text`. An existing section is
 * replaced in place (its heading kept); otherwise one is added above the
 * generated Summary (else above the Hexes table, else at the end). Blank
 * text with no section changes nothing.
 */
export function writeNotesSection(content: string, text: string): string {
  const { eol, front, lines } = splitBody(content);
  const body = text.replace(/\r\n?/g, "\n").split("\n").map((l) => (SECTION_END_RE.test(l) ? `\\${l}` : l));
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const r = notesRange(lines);
  let out: string[];
  if (r) {
    // One blank line after it: before the next heading, or the note's final newline.
    out = [...lines.slice(0, r[0] + 1), ...(body.length ? ["", ...body] : []), "", ...lines.slice(r[1])];
  } else {
    if (!body.length) return content;
    const section = [NOTES_HEADING, "", ...body];
    let at = lines.findIndex((l) => /^##\s+summary\s*$/i.test(l));
    if (at < 0) at = lines.findIndex((l) => /^##\s+hexes\s*$/i.test(l));
    if (at < 0) {
      const tail = [...lines];
      while (tail.length && !tail[tail.length - 1].trim()) tail.pop();
      out = [...tail, "", ...section, ""];
    } else {
      const before = at > 0 && lines[at - 1].trim() ? [""] : [];
      out = [...lines.slice(0, at), ...before, ...section, "", ...lines.slice(at)];
    }
  }
  return [...front, ...out].join(eol);
}
