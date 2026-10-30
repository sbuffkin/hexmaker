/**
 * What the plugin does once the workspace layout is ready (the body of
 * HexmakerPlugin.onload's onLayoutReady, split out by plan-architecture-
 * refactor L1a): the icon list, the stores (held for the setup wizard on a
 * fresh install, F19), the one-time note-format upgrades (the migration
 * runner) and the one combined upgrade notice. Same steps, same order.
 */
import type HexmakerPlugin from "../HexmakerPlugin";
import { beginNoticeBatch, noticeBackground } from "../ui/notify";
import { SANDBOX_MARKER } from "../sandbox";
import { startupWritesWait } from "../setupPlaceholder";
import { moduleDevTools, runAfterStoresReady } from "../modules/runtime";
import { runNoteFormatUpgrades } from "../migrations/registry";
import { migrate as migrateFlatHexNotes } from "../migrations/v1.0-flat-hex-notes-to-default-map";
import { upgradeTableRangesOnce } from "../migrations/v1.5-table-roll-ranges";
import { TableStore } from "../random-tables/TableStore";
import { logError } from "../log";

/**
 * Start-up, once the layout is ready. Defer until vault metadata cache is
 * ready; calling before layout-ready returns null for all vault paths so
 * custom icons are silently dropped. `newerData` is the "written by a
 * newer version" notice, if any; `finish` runs once every upgrade is done.
 */
export function startOnLayoutReady(plugin: HexmakerPlugin, newerData: string | null, finish: () => Promise<void>): void {
  plugin.loadAvailableIcons();
  // data.json was written by a newer version (its data stamp, MG7): say so, and stay.
  if (newerData) noticeBackground(newerData, 0);
  // The one-time upgrades below report in ONE notice once they're all
  // done, not a stack over the map's toolbar (fresh-eyes 2026-10-13 F2).
  beginNoticeBatch();
  // Palettes first (maps reference them), then map notes — which may
  // migrate per-hex data out of hex notes on the first run.
  // Modules' note stores (biomes, world types) start first, as the
  // biome store always did; then the tables and the core's stores.
  const storeReady = new Map(plugin.moduleStores.map((st) => [st, st.init()] as const));
  const moduleStoresReady = Promise.all(storeReady.values());
  void plugin.tableNotes.init();
  // A fresh install with the setup wizard about to open: the stores'
  // first writes (palette notes, the placeholder map's note) wait until
  // the wizard confirms the world folder, or closes, or a map opens, so
  // nothing appears in a folder the user hasn't agreed to (fresh-eyes F19).
  const gate = startupWritesWait(plugin.settings, (p) => !!plugin.app.vault.getAbstractFileByPath(p));
  plugin.startupWritesHeld = gate.held;
  plugin.releaseStartupWrites = () => {
    plugin.startupWritesHeld = false;
    gate.release();
  };
  // A fresh install has no older palettes to move into notes: its
  // palettes are simply written, without the "now notes" notice.
  if (gate.held) plugin.settings.palettesMigrated = true;
  const storesReady = gate.wait.then(() => plugin.paletteStore.init()).then(() => plugin.mapStore.init());
  plugin.storesStarted = storesReady;
  // Each module's one-time upgrades once its stores and the core's are in
  // (World maps, BC1: every overworld hex's biome in its Biome column).
  runAfterStoresReady(plugin, storesReady, plugin.moduleStores, storeReady);
  void storesReady.then(() => plugin.ensureTablesForNewTerrains());
  // Terrains renamed in a palette note while Obsidian was closed: offer "Rename everywhere".
  void storesReady.then(() => plugin.paletteStore.offerPendingRenames()).catch((e) => logError("terrain renames", e));
  // NF1–NF3, once per vault: older hex, token, workflow, map, palette,
  // generator and modules' notes (world types) in the new note formats (backed up first).
  const formatsDone = Promise.all([storesReady, moduleStoresReady.catch(() => undefined)]).then(() => runNoteFormatUpgrades(plugin)).catch((e) => logError("note format upgrades", e));
  // Hex-note properties follow the map once the notes are in their new formats (MG4).
  void formatsDone.then(() => plugin.hexProps.start());
  // Sandbox vaults (dev/demo-world.mjs) get the demo builders; nothing else does.
  void plugin.app.vault.adapter.exists(SANDBOX_MARKER).then((sandbox) => {
    if (!sandbox) return;
    plugin.devTools = moduleDevTools(plugin);
  });
  const registered = plugin.autoRegisterMapsFromVault();
  // Hand edits to table notes (ranges, die, weights) are imported.
  TableStore.register(plugin);
  let rangesDone: Promise<unknown> = Promise.resolve();
  if (!plugin.settings.setupComplete && !plugin.settings.setupDismissed) {
    plugin.openSetupWizard();
  } else {
    // Once after updating: add roll ranges to older tables, silently,
    // after a backup (DJ-Q6). After the stores load, for the same reason.
    rangesDone = storesReady.then(() => upgradeTableRangesOnce(plugin));
  }
  void Promise.allSettled([storesReady, formatsDone, registered, rangesDone]).then(() => finish());
}

/** Pre-1.0 hex notes loose in the hexes folder move into the "default" map's folder. */
export async function migrateHexFilesToDefaultRegion(plugin: HexmakerPlugin): Promise<void> {
  const moved = await migrateFlatHexNotes(plugin.app, plugin.settings.hexFolder);
  if (moved > 0)
    noticeBackground(
      `migrated ${moved} hex file(s) to "default" region.`,
    );
}
