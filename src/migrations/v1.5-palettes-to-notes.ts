/**
 * 1.5.x → 1.6: terrain palettes lived only in data.json. Each becomes a
 * note in the palettes folder (`{world}/palettes/<name>.md`) that a person
 * can read and edit; data.json keeps a copy as a cache.
 *
 * Also the safety net when the palettes folder holds no palette notes
 * (the folder setting was pointed somewhere new): every palette in memory
 * is written there. A palette whose note already exists (synced from a
 * device that upgraded first) isn't written: the note wins on load. A name
 * a file can't have is cleaned ("My: Weird/Palette" → "My- Weird-Palette")
 * and everything that named it follows. Called from PaletteStore.attach.
 */
import { TFolder, type App, type TFile } from "obsidian";
import { noticeUpgrade } from "../ui/notify";
import type { TerrainPalette } from "../types";
import { paletteFileName } from "../palettes/paletteNote";
import { uniquePaletteName } from "../palettes/presets";
import type { MigrationInfo } from "./types";

export const info: MigrationInfo = {
  id: "v1.5-palettes-to-notes",
  from: "1.5.x",
  to: "1.6",
  phase: "palettes",
  change: "Terrain palettes are now notes in the palettes folder, so you can read and edit them.",
  recordedBy: "palettesMigrated",
};

/** What the palette migrations need from the palette store. */
export interface PaletteMigrationHost {
  app: App;
  manifest: { dir?: string };
  settings: { terrainPalettes: TerrainPalette[]; palettesMigrated: boolean };
  /** The palettes folder. */
  folder(): string;
  /** Where a palette of this name is written. */
  pathFor(name: string): string;
  /** Every palette note in the folder, by path. */
  paletteFiles(): TFile[];
  /** Rename a palette in memory, repointing everything that names it. */
  renamePalette(pal: TerrainPalette, name: string): void;
  /** Write a new note for the palette at `path` (and remember it as the palette's). */
  writeNote(pal: TerrainPalette, path: string): Promise<void>;
}

/**
 * Write a note for every palette that has none, when the palettes haven't
 * been moved into notes yet or the folder holds none (`existing`: the
 * palette notes that parse). True when it ran (settings changed).
 */
export async function writePaletteNotes(host: PaletteMigrationHost, existing: TFile[]): Promise<boolean> {
  const { settings } = host;
  if (settings.palettesMigrated && existing.length !== 0) return false;
  const paletteNames = new Set(existing.map((f) => f.basename.toLowerCase()));
  for (const pal of settings.terrainPalettes) {
    const safe = paletteFileName(pal.name);
    if (paletteNames.has(safe.toLowerCase())) {
      // A palette note of that name already exists (e.g. synced from a
      // device that migrated first) — the note wins on load below.
      if (safe !== pal.name) host.renamePalette(pal, safe);
      continue;
    }
    let name = safe;
    if (host.app.vault.getAbstractFileByPath(host.pathFor(name))) {
      // Some unrelated note already has this name.
      const folder = host.app.vault.getAbstractFileByPath(host.folder());
      const siblings = folder instanceof TFolder
        ? folder.children.map((c) => c.name.replace(/.md$/, ""))
        : [];
      name = uniquePaletteName(safe, siblings);
    }
    if (name !== pal.name) host.renamePalette(pal, name);
    await host.writeNote(pal, host.pathFor(pal.name));
    paletteNames.add(name.toLowerCase());
  }
  if (!settings.palettesMigrated) {
    settings.palettesMigrated = true;
    noticeUpgrade(`terrain palettes are now notes in "${host.folder()}".`, { ids: [info.id] });
  }
  return true;
}
