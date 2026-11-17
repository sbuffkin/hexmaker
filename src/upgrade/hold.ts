/**
 * Start-up for a vault the 2.0 upgrade hasn't converted (release plan B1):
 * ask first, convert nothing until the answer is Upgrade now.
 *
 * Not now = the plugin stays IDLE for the session, not read-only: 1.5.x
 * data only reads through the upgrade (hexes in note frontmatter, palettes
 * and paths in data.json), so a read-only mode would show blank maps and
 * every code path would have to cope with old formats. Idle registers one
 * command (Upgrade to 2.0…), reads data.json once, and writes nothing.
 * The ask returns on the next load.
 */
import { Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { logError } from "../log";
import { UpgradeAskModal } from "./UpgradeModals";
import { UPGRADE_WAITING_NOTICE, needsUpgradeAsk } from "./upgradeGate";
import { writePreUpgradeSnapshot } from "./undoUpgrade";

/** True when the vault needs converting: the plugin then stays idle until the user says so. */
export async function holdForUpgrade(plugin: HexmakerPlugin): Promise<boolean> {
  if (!needsUpgradeAsk((await plugin.loadData()) as Record<string, unknown> | null)) return false;
  plugin.addCommand({
    id: "upgrade-to-2",
    name: "Upgrade to 2.0…",
    checkCallback: (checking) => {
      if (plugin.started) return false;
      if (!checking) askToUpgrade(plugin);
      return true;
    },
  });
  plugin.app.workspace.onLayoutReady(() => askToUpgrade(plugin));
  return true;
}

let asking = false;

/** The modal; one at a time. */
export function askToUpgrade(plugin: HexmakerPlugin): void {
  if (plugin.started || asking) return;
  asking = true;
  new UpgradeAskModal(
    plugin.app,
    () => {
      asking = false;
      void upgradeNow(plugin);
    },
    () => {
      asking = false;
      if (!plugin.started) new Notice(UPGRADE_WAITING_NOTICE, 15000);
    },
  ).open();
}

/**
 * Convert: keep data.json as it is (so the upgrade can be undone), then run
 * the normal start-up. When the copy can't be saved nothing is converted.
 */
export async function upgradeNow(plugin: HexmakerPlugin): Promise<void> {
  if (plugin.started) return;
  try {
    await writePreUpgradeSnapshot(plugin.app.vault.adapter, plugin.backupsFolder(), `${plugin.manifest.dir ?? ""}/data.json`);
  } catch (e) {
    logError("couldn't save data.json before the upgrade; nothing was converted", e);
    new Notice(`Couldn't save a copy of your settings first, so nothing was converted (${String(e)}).`, 15000);
    return;
  }
  await plugin.start();
}
