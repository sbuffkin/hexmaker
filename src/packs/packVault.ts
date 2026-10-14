/**
 * The vault side of content packs: the hosts packIO.ts writes and reads
 * through, the zip written to the export folder, and the .zip files a
 * vault already holds.
 */

import { TFile, type App } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { writeJsonBackup } from "../backup";
import { ensureExportFolder } from "../export/exportFolder";
import { writeBinaryToVault } from "../export/vaultWrite";
import { ensureFolderPath } from "../vault/ensureFolder";
import { PLUGIN_NAME } from "../ui/notify";
import { buildPack, localDate, packFileName, type PackExportInput, type PackReadHost, type PackWriteHost } from "./packIO";

/** Reads vault notes for an export. */
export function vaultReadHost(app: App): PackReadHost {
  return {
    read: async (path) => {
      const f = app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) throw new Error(`no note at ${path}`);
      return app.vault.read(f);
    },
  };
}

/** Writes imported notes; replaced notes are backed up in the plugin's backups folder first. */
export function vaultWriteHost(plugin: HexmakerPlugin): PackWriteHost {
  const { app } = plugin;
  const file = (path: string) => {
    const f = app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`no note at ${path}`);
    return f;
  };
  return {
    exists: (path) => !!app.vault.getAbstractFileByPath(path),
    read: (path) => app.vault.read(file(path)),
    create: async (path, text) => {
      await app.vault.create(path, text);
    },
    modify: (path, text) => app.vault.modify(file(path), text),
    ensureFolderPath: (folder) => ensureFolderPath(app.vault, folder),
    backup: (notes, label) => {
      const dir = `${plugin.manifest.dir ?? ""}/backups/pack-import-${localDate(new Date())}`;
      const json = JSON.stringify({ pack: label, notes: Object.fromEntries(notes.map((n) => [n.path, n.text])) }, null, 1);
      return writeJsonBackup(app.vault.adapter, dir, label.replace(/[^\w-]+/g, "-").slice(0, 60) || "pack", json);
    },
  };
}

/** "Hexmap World Creator 1.6.0". */
export function madeWith(plugin: HexmakerPlugin): string {
  return `${PLUGIN_NAME} ${plugin.manifest.version}`;
}

/** Write the pack to the export folder; returns its path and whether it replaced an earlier one. */
export async function exportPackToVault(plugin: HexmakerPlugin, input: PackExportInput): Promise<{ path: string; replaced: boolean }> {
  const { bytes } = await buildPack(vaultReadHost(plugin.app), input);
  const folder = await ensureExportFolder(plugin);
  const path = `${folder}/${packFileName(input.name)}`;
  const replaced = await writeBinaryToVault(plugin.app, path, bytes);
  return { path, replaced };
}

/** The .zip files in the vault (packs exported here, or dropped in), newest first. */
export function zipsInVault(app: App): TFile[] {
  return app.vault.getFiles()
    .filter((f) => f.extension.toLowerCase() === "zip")
    .sort((a, b) => b.stat.mtime - a.stat.mtime);
}
