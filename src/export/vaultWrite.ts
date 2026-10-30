/**
 * Writing an export into the vault (the exporters share these).
 *
 * An export only ever replaces an earlier export: a file at its name that
 * doesn't carry the `hexmaker-export` marker (a note, image or PDF the user
 * made, or an export folder pointed at a content folder) is left alone and
 * the export is saved as "<name> 2.<ext>" instead (security review #11;
 * exportMarker.ts). Then a notice, and the file opens.
 */

import { Notice, TFile, type App } from "obsidian";
import { exportedMessage, openExported } from "./exportFolder";
import { binaryHasExportMarker, markBinaryExport, pickExportPath, textHasExportMarker } from "./exportMarker";
import { logError } from "../log";

/** Where an export was saved, and whether it replaced an earlier export there. */
export interface SavedExport {
  path: string;
  replaced: boolean;
}

/** vault.createBinary / modifyBinary want a plain ArrayBuffer. */
function plainBuffer(data: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  return buf;
}

/** What is at `path`: nothing, an earlier export, or something else. */
async function lookAt(app: App, path: string, text: boolean): Promise<"free" | "export" | "other"> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!file) return "free";
  if (!(file instanceof TFile)) return "other";
  try {
    const ours = text
      ? textHasExportMarker(await app.vault.read(file))
      : binaryHasExportMarker(path, new Uint8Array(await app.vault.readBinary(file)));
    return ours ? "export" : "other";
  } catch (e) {
    logError("couldn't read a file the export would replace", e, path);
    return "other";
  }
}

/**
 * Save an export meant for `path`: replace an earlier export there, or use
 * the next free numbered name. Binary exports get the marker (PDF, PNG);
 * markdown exports carry it already (withExportProvenance).
 */
export async function saveExport(app: App, path: string, data: Uint8Array | string): Promise<SavedExport> {
  const text = typeof data === "string";
  const saved = await pickExportPath(path, (p) => lookAt(app, p, text));
  const existing = saved.replaced ? app.vault.getAbstractFileByPath(saved.path) : null;
  if (text) {
    if (existing instanceof TFile) await app.vault.modify(existing, data);
    else await app.vault.create(saved.path, data);
  } else {
    const buf = plainBuffer(markBinaryExport(saved.path, data));
    if (existing instanceof TFile) await app.vault.modifyBinary(existing, buf);
    else await app.vault.createBinary(saved.path, buf);
  }
  return saved;
}

/** After an export: say where it went ("Exported to …" / "Replaced …") and open it. */
export function announceExport(app: App, saved: SavedExport): void {
  new Notice(exportedMessage(saved.path, saved.replaced));
  void openExported(app, saved.path);
}

/** An export that failed: logged for developers, and a notice for the user. */
export function reportExportFailure(err: unknown, what = "Export"): void {
  logError(`${what.toLowerCase()} failed`, err);
  new Notice(`${what} failed: ${err instanceof Error ? err.message : String(err)}`);
}

/**
 * Write binary bytes, replacing whatever is at `path`; true when it
 * replaced a file. Used by content-pack export (src/packs), whose .zip
 * has no export marker yet; exports use saveExport.
 */
export async function writeBinaryToVault(
  app: App,
  path: string,
  data: Uint8Array,
): Promise<boolean> {
  const buf = plainBuffer(data);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modifyBinary(existing, buf);
    return true;
  }
  await app.vault.createBinary(path, buf);
  return false;
}
