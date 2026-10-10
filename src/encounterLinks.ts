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
