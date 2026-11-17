/**
 * Asking before the 2.0 upgrade converts a vault (release plan B1, owner
 * 2026-11-16): the one pure decision, and the words. No Obsidian imports.
 */

import { DATA_FORMAT, dataFormatOf } from "../migrations/stamp";

/**
 * Does this data.json hold a vault the 2.0 upgrade would convert? An
 * existing install (some data saved) whose data format is older than this
 * build's, i.e. what 1.5.x and earlier wrote. A fresh install (no data, or
 * an empty file) has nothing to convert; data a newer build wrote isn't ours
 * to convert (the "written by a newer version" notice covers it).
 */
export function needsUpgradeAsk(raw: Record<string, unknown> | null | undefined): boolean {
  if (!raw || typeof raw !== "object" || !Object.keys(raw).length) return false;
  return dataFormatOf(raw) < DATA_FORMAT;
}

export const UPGRADE_TITLE = "Upgrade to Hexmaker 2.0";
export const UPGRADE_LEAD = "This update converts your maps. Back up your vault first.";
export const UPGRADE_DETAIL =
  "Hexmaker copies every note it rewrites, and your settings file, into its own backups folder first, and keeps a command to undo the upgrade. A copy of the whole vault is still the safest backup.";
export const UPGRADE_LATER_NOTE =
  "Until you upgrade, Hexmaker does nothing: it shows no maps, adds no menus and changes no files. Run \"Upgrade to 2.0…\" from the command palette when you're ready.";
/** The notice shown after "Not now", and on later loads while the vault is not upgraded. */
export const UPGRADE_WAITING_NOTICE = "Hexmaker 2.0 is installed but idle: your vault isn't converted yet. Run \"Hexmap World Creator: Upgrade to 2.0…\" when you're ready.";
