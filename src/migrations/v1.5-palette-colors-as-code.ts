/**
 * Unreleased → 1.6: colors in palette notes became inline code
 * (`` `#14223d` ``), because Obsidian read a bare `#14223d` as a tag. Before
 * the first pass that converts them, every palette note is backed up; if
 * that backup fails nothing is converted and it's tried again next start.
 * The conversion itself is every palette-note write (paletteNote.ts);
 * this step is the backup and the record. Called from PaletteStore.attach.
 */
import { noticeBackground } from "../ui/notify";
import { writeJsonBackup } from "../backup";
import { parsePaletteNote, wrapPaletteColors } from "../palettes/paletteNote";
import { wrapPathTypeColors } from "../palettes/pathTypeTable";
import type { PaletteMigrationHost } from "./v1.5-palettes-to-notes";
import type { MigrationInfo } from "./types";

export const info: MigrationInfo = {
  id: "v1.5-palette-colors-as-code",
  from: "unreleased",
  to: "1.6",
  phase: "palettes",
  change: "Colors in palette notes are written as code, so Obsidian no longer reads them as tags.",
  recordedBy: "paletteColorsCode",
};

/**
 * Save the full text of every palette note (gzipped JSON in the plugin's
 * backups folder) when any of them still has colors that aren't inline
 * code. Returns false, after saying so, if the backup couldn't be saved.
 */
export async function backupBeforeColorConversion(host: Pick<PaletteMigrationHost, "app" | "manifest" | "paletteFiles">): Promise<boolean> {
  const { vault } = host.app;
  const notes: Record<string, string> = {};
  let needed = false;
  for (const file of host.paletteFiles()) {
    const content = await vault.read(file);
    notes[file.path] = content;
    if (parsePaletteNote(content) && wrapPathTypeColors(wrapPaletteColors(content)) !== content) needed = true;
  }
  if (!needed) return true;
  try {
    const dir = `${host.manifest.dir}/backups/palette-colours-${new Date().toISOString().slice(0, 10)}`;
    const json = JSON.stringify({ kind: "palette-colours", savedAt: new Date().toISOString(), notes });
    await writeJsonBackup(vault.adapter, dir, "palette-notes", json);
    return true;
  } catch (e) {
    console.error("Hexmaker: couldn't back up palette notes; their colors weren't converted", e);
    noticeBackground("couldn't save a backup of the palette notes, so their colors weren't converted yet. It will try again next time.", 10000);
    return false;
  }
}
