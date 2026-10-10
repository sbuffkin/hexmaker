/**
 * Which encounter tables a hex shows, shared by the hex editor and the hex
 * table so the two agree (fresh-eyes round 3: the editor said "None" while
 * the table said "ocean" for the same hex).
 *
 * The hex note's "Encounters Table" section is the truth once the note
 * exists. A hex without a note (terrain lives in the map note) has no
 * section yet, but createHexNote links its terrain's encounters table the
 * moment the note is made — so that table is what applies, and what both
 * views show, rather than "None".
 */
export function displayedEncounterLinks(
  noteExists: boolean,
  noteLinks: string[],
  terrainTableLink: string | null,
): string[] {
  if (noteExists) return noteLinks;
  return terrainTableLink ? [terrainTableLink] : [];
}

/** Folder names that say what kind of table a file is (terrain tables live
 *  at `terrain/encounters/grass.md`, `terrain/descriptions/grass.md`). */
const KIND_FOLDERS = new Set(["encounters", "descriptions", "description", "weather", "rumors", "rumours"]);

/**
 * A link as the hex editor shows it: the note's name, not its wiki path
 * (round 6: `[[world/tables/terrain/encounters/grass]]` was noisy). An alias
 * wins; a terrain table keeps its kind ("grass encounters"), since a bare
 * "grass" could be the description table too.
 */
export function linkDisplayName(link: string): string {
  const [target, alias] = link.split("|");
  if (alias?.trim()) return alias.trim();
  const parts = target.split("#")[0].replace(/\.md$/i, "").split("/").filter(Boolean);
  const base = parts[parts.length - 1] ?? target;
  const folder = parts.length > 1 ? parts[parts.length - 2].toLowerCase() : undefined;
  return folder && KIND_FOLDERS.has(folder) ? `${base} ${folder}` : base;
}
