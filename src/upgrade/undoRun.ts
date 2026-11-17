/**
 * Running "Undo the 2.0 upgrade" (the plan and the safety reasoning are in
 * ./undoUpgrade.ts). The order is the whole point:
 *  1. back up 2.0's data.json (nothing changed yet; a failure stops here);
 *  2. let pending map-note writes finish, and make data.json saves no-ops;
 *  3. disable the plugin (its vault handlers go; this function keeps running);
 *  4. put the notes back (backing the current ones up first), then data.json.
 */
import { Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { restoreBackup } from "../BackupsModal";
import { logError } from "../log";
import { backUpDataJson, planUndo, type UndoPlan } from "./undoUpgrade";
import { UndoDoneModal, UndoUpgradeModal } from "./UpgradeModals";

type Adapter = import("../backup").BackupAdapter & import("../backup").BackupReadAdapter;
const adapterOf = (p: HexmakerPlugin) => p.app.vault.adapter as unknown as Adapter;

/** The command: plan, confirm, run. */
export async function undoUpgradeCommand(plugin: HexmakerPlugin): Promise<void> {
  const plan = await planUndo(adapterOf(plugin), plugin.backupsFolder());
  if (!plan) {
    new Notice("There is no record of a 2.0 upgrade in this vault, so there is nothing to undo here. \"Restore from upgrade backup…\" puts notes back one backup at a time.", 15000);
    return;
  }
  new UndoUpgradeModal(plugin.app, plan, () => void runUndo(plugin, plan)).open();
}

/** Disable a plugin by id (Obsidian's own, not in the public typings). */
async function disable(plugin: HexmakerPlugin): Promise<void> {
  const plugins = (plugin.app as unknown as { plugins?: { disablePlugin?(id: string): Promise<void> } }).plugins;
  await plugins?.disablePlugin?.(plugin.manifest.id);
}

export async function runUndo(plugin: HexmakerPlugin, plan: UndoPlan): Promise<void> {
  const { app } = plugin;
  const adapter = adapterOf(plugin);
  const backups = plugin.backupsFolder();
  const dataPath = `${plugin.manifest.dir ?? ""}/data.json`;
  let kept: string;
  try {
    kept = await backUpDataJson(adapter, backups, dataPath);
  } catch (e) {
    logError("undo: couldn't back up data.json", e);
    new Notice(`Couldn't save a backup of your settings, so nothing was undone (${String(e)}).`, 15000);
    return;
  }
  await plugin.mapStore.flush();
  plugin.settingsIO.freeze();
  await disable(plugin);
  const lines: string[] = [];
  try {
    const when = new Date();
    const r = await restoreBackup(app, backups, { path: plan.snapshot.path, folder: "undo", name: "all upgrade backups", savedAt: plan.snapshot.savedAt, notes: plan.notes }, when);
    lines.push(`${r.restored.length} note${r.restored.length === 1 ? "" : "s"} put back${r.undo ? `; the notes as they were are in ${r.undo}` : ""}.`);
  } catch (e) {
    logError("undo: couldn't restore notes", e);
    new UndoDoneModal(app, [`Stopped before any note was changed: ${String(e)}`, "Hexmaker 2.0 is switched off. Turn it on again in Settings → Community plugins to carry on with 2.0."], "Undo stopped").open();
    return;
  }
  await adapter.write(dataPath, plan.snapshot.dataJson);
  lines.push(`Your settings file is back as it was before the upgrade (2.0's copy is in ${kept}).`);
  lines.push(`Now install Hexmaker 1.5.8: replace main.js, manifest.json and styles.css in ${plugin.manifest.dir ?? "the plugin folder"} with the 1.5.8 release's (GitHub releases, or BRAT with version 1.5.8), then reload Obsidian.`);
  lines.push("Until you do, Hexmaker 2.0 is switched off for now; if you restart Obsidian first it loads again, sees the old data, and asks before upgrading.");
  new UndoDoneModal(app, lines, "The 2.0 upgrade is undone").open();
}
