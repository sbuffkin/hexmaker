/**
 * Checks for vault paths that come from note text (a workflow's
 * `template-file`, a table's linked folder or row text, a backup's note
 * list): the plugin writes to these, so a note from someone else (a pack,
 * a synced vault) must not be able to aim a write at an image, a hidden
 * folder or a file outside the world folder. Pure: no `obsidian` import.
 */

/** "a//b/" → "a/b" (like normalizeFolder, without Obsidian's normalizePath). */
function trimFolder(folder: string): string {
  return folder.trim().replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

/** A relative vault path with no `..`, `.`, empty or hidden parts, no backslash or drive letter. */
export function isSafeVaultPath(p: string): boolean {
  if (!p || p.startsWith("/") || /^[a-zA-Z]:/.test(p) || p.includes("\\")) return false;
  return p.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.startsWith("."));
}

/** A safe vault path to a Markdown note. */
export function isSafeNotePath(p: string): boolean {
  return /\.md$/i.test(p) && isSafeVaultPath(p);
}

/** Whether `p` is `folder` or sits below it ("" = the vault root holds everything). */
export function isInsideFolder(p: string, folder: string): boolean {
  const f = trimFolder(folder);
  if (!f) return true;
  return p === f || p.startsWith(f + "/");
}

/** A safe folder (or "" for the vault root) inside one of `roots`. */
export function isFolderInside(folder: string, roots: readonly string[]): boolean {
  const f = trimFolder(folder);
  if (f && !isSafeVaultPath(f)) return false;
  return roots.some((r) => isInsideFolder(f, r) && (f !== "" || !trimFolder(r)));
}

/** A safe note path below one of `roots`. */
export function isNoteInside(p: string, roots: readonly string[]): boolean {
  return isSafeNotePath(p) && roots.some((r) => isInsideFolder(p, r));
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * Text (a table row, a typed name) as a note's file name: no path
 * separators or characters Windows refuses (`\ / : * ? " < > |`, control
 * characters), no leading dot, no trailing dot or space, no reserved
 * device name, at most 120 characters. Text that's already a fine name is
 * left as it is. "" when nothing's left.
 */
export function noteFileName(text: string): string {
  let s = text
    // eslint-disable-next-line no-control-regex -- control characters are what's being removed
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+/, "")
    .replace(/[. ]+$/, "")
    .trim();
  if (s.length > 120) s = s.slice(0, 120).replace(/[. ]+$/, "");
  if (RESERVED.test(s)) s = `${s}_`;
  return s;
}
