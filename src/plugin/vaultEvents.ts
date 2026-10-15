/**
 * ONE handler per vault / workspace event for the whole plugin (plan-
 * architecture-refactor L1a). Each event runs its steps in the order the
 * separate handlers used to be registered in HexmakerPlugin.onload, so
 * who sees a change first is unchanged:
 *
 *   metadata changed: pending-terrain cache → hex-note properties
 *   file-open:        hex-note properties → region/faction callout, hex callout focus
 *   create:           icons → palette store → module stores → map store
 *   modify:           palette store → module stores → map store
 *   delete:           hex-note properties → icons → map store → palette store → module stores → callout memory → workflow steps
 *   rename:           hex-note properties → icons → palette store → module stores → callout memory → region note → linkedFolder links
 *   active-leaf-change: palette store (derived cells)
 *
 * Each group that used to be its own handler is isolated as Obsidian
 * isolated handlers: one throwing (logged) doesn't stop the next.
 */
import { Notice, TFile, type TAbstractFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { clearPendingTerrain } from "../frontmatter";
import { onTableDeleted, onTableFolderRenamed } from "../random-tables/tableVaultEvents";
import { normalizeFolder } from "../utils";
import { logError } from "../log";

/** Run one former handler; an error is logged and the next still runs. */
function step(run: () => void): void {
  try {
    run();
  } catch (e) {
    logError("vault event handler", e);
  }
}

export function registerVaultEvents(plugin: HexmakerPlugin): void {
  const { app } = plugin;
  const sync = plugin.hexProps;

  // Live-refresh the icon list when image files appear in / leave the
  // icons folder. Without this, icons dropped in via the OS file explorer
  // needed an Obsidian restart to show up in the pickers (forum report).
  const isIconFile = (path: string): boolean => {
    const folder = normalizeFolder(plugin.settings.iconsFolder ?? "");
    if (!folder) return false;
    return (
      path.startsWith(folder + "/") &&
      /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(path)
    );
  };
  const hexNoteFocus = hexNoteFocusTracker(plugin);

  plugin.registerEvent(app.metadataCache.on("changed", (file, data) => {
    // Notes written by this plugin are read from memory until indexed (see frontmatter.ts).
    step(() => clearPendingTerrain(file.path));
    // A hex note's properties edited (properties panel, text, sync).
    step(() => sync.onMetadataChanged(file, data));
  }));

  plugin.registerEvent(app.workspace.on("file-open", (file) => {
    // Leaving a note settles edits held while it was open.
    step(() => sync.onFileOpen(file));
    // A region or faction note's Map data callout is refreshed when it's opened (R1).
    step(() => {
      if (file && plugin.regionOrFactionKind(file)) void plugin.refreshRegionMapData(file);
      hexNoteFocus(file);
    });
  }));

  plugin.registerEvent(app.vault.on("create", (f) => {
    step(() => {
      if (isIconFile(f.path)) plugin.loadAvailableIcons();
      plugin.paletteStore.onModify(f);
      for (const st of plugin.moduleStores) st.onCreate?.(f);
      plugin.mapStore.onCreate(f);
    });
  }));

  plugin.registerEvent(app.vault.on("delete", (f) => {
    step(() => sync.onDelete(f.path));
    step(() => {
      if (isIconFile(f.path)) plugin.loadAvailableIcons();
      plugin.mapStore.onDelete(f);
      plugin.paletteStore.onDelete(f);
      for (const st of plugin.moduleStores) st.onDelete?.(f);
      plugin.calloutMemory.forget(f.path);
    });
    // Remove workflow steps that reference a deleted table file.
    step(() => void onTableDeleted(plugin, f));
  }));

  plugin.registerEvent(app.vault.on("rename", (f, oldPath) => {
    step(() => sync.onRename(oldPath, f.path));
    step(() => {
      if (isIconFile(f.path) || isIconFile(oldPath)) plugin.loadAvailableIcons();
      plugin.paletteStore.onRename(f, oldPath);
      for (const st of plugin.moduleStores) st.onRename?.(f, oldPath);
      plugin.calloutMemory.rename(oldPath, f.path);
      if (f instanceof TFile) void onRegionNoteRenamed(plugin, f, oldPath);
    });
    // Keep linkedFolder frontmatter in sync when a folder is renamed.
    step(() => void onTableFolderRenamed(plugin, f, oldPath));
  }));

  // Palette notes edited by hand (or by sync) flow back into the palettes.
  plugin.registerEvent(app.vault.on("modify", (f: TAbstractFile) => {
    step(() => {
      plugin.paletteStore.onModify(f);
      for (const st of plugin.moduleStores) st.onModify?.(f);
      plugin.mapStore.onModify(f);
    });
  }));

  // A hand-edited palette note's derived cells ("(yes)", "(mountains)")
  // are refreshed once the user stops editing it.
  plugin.registerEvent(app.workspace.on("active-leaf-change", () => plugin.paletteStore.flushPendingDerived()));
}

/**
 * A file opened in an editor: a hex note left behind has its Map data
 * callout synced (hand edits made in it go to the map), and a hex note
 * being opened gets its callout brought up to date before it's edited.
 * Not while the user is still in the note: rewriting it mid-typing would
 * fight the editor.
 */
function hexNoteFocusTracker(plugin: HexmakerPlugin): (file: TFile | null) => void {
  /** The hex note last opened in an editor (its callout is synced when another file opens). */
  let focusedHexNote: string | null = null;
  return (file) => {
    const sync = (path: string) => {
      const loc = plugin.mapStore.isReady() ? plugin.mapStore.resolve(path) : null;
      if (!loc || !plugin.getMap(loc.map)) return;
      const [x, y] = loc.key.split("_").map(Number);
      void plugin.syncHexMapData(loc.map, x, y);
    };
    const prev = focusedHexNote;
    const next = file && plugin.mapStore.isReady() && plugin.mapStore.resolve(file.path) ? file.path : null;
    if (prev && prev !== file?.path) sync(prev);
    if (next && next !== prev) sync(next);
    focusedHexNote = next;
  };
}

/**
 * A note in the regions folder was renamed (R2): its hexes keep their
 * region, and its encounter table follows the name (unless the new name
 * already has one).
 */
async function onRegionNoteRenamed(plugin: HexmakerPlugin, file: TFile, oldPath: string): Promise<void> {
  const folder = normalizeFolder(plugin.settings.regionsFolder ?? "");
  if (!folder || !oldPath.startsWith(folder + "/") || !/\.md$/i.test(oldPath)) return;
  const oldName = oldPath.slice(oldPath.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  const newName = file.basename;
  if (oldName === newName || oldName.startsWith("_") || !plugin.mapStore.isReady()) return;
  const n = plugin.renameRegionInMaps(oldName, newName);
  const tables = normalizeFolder(plugin.settings.tablesFolder);
  const sub = tables ? `${tables}/regions` : "regions";
  const table = plugin.app.vault.getAbstractFileByPath(`${sub}/${oldName}.md`);
  if (table instanceof TFile && !plugin.app.vault.getAbstractFileByPath(`${sub}/${newName}.md`)) {
    try {
      await plugin.app.fileManager.renameFile(table, `${sub}/${newName}.md`);
    } catch { /* the hexes still keep their region */ }
  }
  if (n) new Notice(`Region renamed: ${n} hex${n === 1 ? "" : "es"} now in "${newName}".`);
}
