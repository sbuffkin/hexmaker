/**
 * Markdown-table pipe handling that avoids regex look-behind,
 * which older iOS WebViews (before 16.4) can't even parse: one such regex
 * fails the whole plugin bundle on those phones. A "bare" pipe is one not
 * directly preceded by a backslash.
 */

/** Indices of the pipes not preceded by a backslash. */
function barePipeIndices(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) if (s[i] === "|" && s[i - 1] !== "\\") out.push(i);
  return out;
}

/** Split at the bare pipes. */
export function splitBarePipes(s: string): string[] {
  const parts: string[] = [];
  let from = 0;
  for (const i of barePipeIndices(s)) {
    parts.push(s.slice(from, i));
    from = i + 1;
  }
  parts.push(s.slice(from));
  return parts;
}

/** Escape the bare pipes. */
export function escapeBarePipes(s: string): string {
  let out = "";
  let from = 0;
  for (const i of barePipeIndices(s)) {
    out += s.slice(from, i) + "\\|";
    from = i + 1;
  }
  return out + s.slice(from);
}

/** Drop one trailing bare pipe. */
export function stripTrailingBarePipe(s: string): string {
  return s.endsWith("|") && s[s.length - 2] !== "\\" ? s.slice(0, -1) : s;
}
