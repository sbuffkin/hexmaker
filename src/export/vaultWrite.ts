/**
 * Writing an export into the vault (the exporters share these): replace
 * the file when it's there, create it when not, then open it.
 */

import { Notice, TFile, type App } from "obsidian";
import { openExported } from "./exportFolder";
import { logError } from "../log";

/** Write binary export bytes; true when it replaced an earlier file. */
export async function writeBinaryToVault(
  app: App,
  path: string,
  data: Uint8Array,
): Promise<boolean> {
  // vault.createBinary / modifyBinary require a plain ArrayBuffer.
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modifyBinary(existing, buf);
    return true;
  }
  await app.vault.createBinary(path, buf);
  return false;
}

/** Write the export; true when it replaced an earlier one. */
export async function writeTextToVault(
  app: App,
  path: string,
  data: string,
): Promise<boolean> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, data);
    return true;
  }
  await app.vault.create(path, data);
  return false;
}

/** Open an export (exportFolder.openExported). */
export async function openInVault(app: App, path: string): Promise<void> {
  await openExported(app, path);
}

/** An export that failed: logged for developers, and a notice for the user. */
export function reportExportFailure(err: unknown, what = "Export"): void {
  logError(`${what.toLowerCase()} failed`, err);
  new Notice(`${what} failed: ${err instanceof Error ? err.message : String(err)}`);
}
