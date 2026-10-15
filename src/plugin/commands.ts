/**
 * The plugin's ribbon icon, commands, file menu and editor menu. Split from
 * HexmakerPlugin.onload (plan-architecture-refactor L1a); same ids, names,
 * placement and order as before.
 */
import { type Command, Editor, EventRef, MarkdownView, Menu, Notice, TFile } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { exportSingleNoteAsPdf, exportSingleNoteAsMarkdown } from "../export/exporters/singleNote";
import { HexExportModal } from "../hex-map/HexExportModal";
import { MapExportModal } from "../export/MapExportModal";
import { WorkflowExportModal } from "../random-tables/WorkflowExportModal";
import { HexMapView } from "../hex-map/HexMapView";
import { FileLinkSuggestModal } from "../hex-map/FileLinkSuggestModal";
import { MapLinkModal } from "../hex-map/MapLinkModal";
import { openTableRangesModal, runTableCheck } from "../random-tables/tableMaintenance";
import { VIEW_TYPE_HEX_MAP, VIEW_TYPE_HEX_TABLE, VIEW_TYPE_RANDOM_TABLES } from "../constants";
import { moduleCommands } from "../modules/runtime";
import { enabledKinds } from "../mapKinds";
import { isDebugMode } from "../ui/debugMode";
import { addPlacedMenuItems, placeCommand } from "../ui/commandPlacement";
import { RestoreBackupModal, openBackupsFolder } from "../BackupsModal";
import { ensureLogNote } from "../play/playLogWriter";
import { logFolderFor } from "../play/playLog";
import { openNoteFocused } from "../openNote";
import { packCommands } from "../packs/packCommands";
import { mapLinkUri } from "../hexLink";
import { normalizeFolder } from "../utils";

/** The ribbon icon, every command and the file menu (in onload's order). */
export function registerCommands(plugin: HexmakerPlugin): void {
  plugin.addRibbonIcon("map", "Open hex map", () =>
    plugin.openHexMap(),
  );
  // Commands are placed by id like every other control (src/ui/placement.ts):
  // Debug ones are offered only in debug mode (src/ui/commandPlacement.ts).
  const addPlaced = (id: string, cmd: Command) => {
    const placed = placeCommand(id, cmd, () => isDebugMode(plugin.app));
    if (placed) plugin.addCommand(placed);
  };
  addPlaced("Plugin.cmd.openHexMap", {
    id: "open-hex-map",
    name: "Open hex map",
    callback: () => plugin.openHexMap(),
  });
  addPlaced("Plugin.cmd.openHexTable", {
    id: "open-hex-table",
    name: "Open hex table",
    callback: () => void plugin.app.workspace.getLeaf().setViewState({ type: VIEW_TYPE_HEX_TABLE }),
  });
  addPlaced("Plugin.cmd.openTerrainGenerator", {
    id: "open-terrain-generator",
    name: "Open terrain generator",
    callback: () => void plugin.openTerrainGenerator(),
  });
  addPlaced("Plugin.cmd.openPaletteEditor", {
    id: "open-palette-editor",
    name: "Open palette editor",
    callback: () => void plugin.openPaletteEditor(),
  });
  // Each module's commands (Space: Edit world types…, Convert world types to tables),
  // placed by their placement id when they have one.
  for (const { command, kind } of moduleCommands()) {
    const cmd: Command = {
      id: command.id,
      name: command.name,
      checkCallback: (checking) => {
        if (kind !== undefined && !enabledKinds(plugin.settings).has(kind)) return false;
        if (command.available && !command.available(plugin)) return false;
        if (!checking) void command.run(plugin);
        return true;
      },
    };
    if (command.placementId) addPlaced(command.placementId, cmd);
    else plugin.addCommand(cmd);
  }
  addPlaced("Plugin.cmd.mapGoUp", {
    id: "map-go-up",
    name: "Go up to parent map",
    checkCallback: (checking) => {
      const view = plugin.app.workspace.getActiveViewOfType(HexMapView);
      if (!view?.canNavigateUp()) return false;
      if (!checking) view.navigateUp();
      return true;
    },
  });
  addPlaced("Plugin.cmd.mapGoBack", {
    id: "map-go-back",
    name: "Go back to previous map",
    checkCallback: (checking) => {
      const view = plugin.app.workspace.getActiveViewOfType(HexMapView);
      if (!view?.canNavigateBack()) return false;
      if (!checking) view.navigateBack();
      return true;
    },
  });
  addPlaced("Plugin.cmd.mapGoForward", {
    id: "map-go-forward",
    name: "Go forward to the next map",
    checkCallback: (checking) => {
      const view = plugin.app.workspace.getActiveViewOfType(HexMapView);
      if (!view?.canNavigateForward()) return false;
      if (!checking) view.navigateForward();
      return true;
    },
  });
  addPlaced("Plugin.cmd.openRandomTables", {
    id: "open-random-tables",
    name: "Open random tables",
    callback: () => void plugin.app.workspace.getLeaf().setViewState({ type: VIEW_TYPE_RANDOM_TABLES }),
  });
  // Content packs (SF1): export notes to a .zip, import one into this vault.
  const packs = packCommands(plugin);
  addPlaced("Plugin.cmd.exportContentPack", { id: "export-content-pack", name: "Export content pack…", callback: packs.exportPack });
  addPlaced("Plugin.cmd.importContentPack", { id: "import-content-pack", name: "Import content pack…", callback: packs.importPack });
  addPlaced("Plugin.cmd.addRollRanges", {
    id: "add-roll-ranges",
    name: "Add roll ranges to tables",
    callback: () => void openTableRangesModal(plugin),
  });
  addPlaced("Plugin.cmd.checkTables", {
    id: "check-tables",
    name: "Check tables",
    callback: () => void runTableCheck(plugin),
  });
  // Backups stay in the plugin's folder; these reach them (owner MG2).
  addPlaced("Plugin.cmd.openBackupsFolder", {
    id: "open-backups-folder",
    name: "Open backups folder",
    callback: () => void openBackupsFolder(plugin),
  });
  addPlaced("Plugin.cmd.restoreFromBackup", {
    id: "restore-from-upgrade-backup",
    name: "Restore from upgrade backup…",
    callback: () => new RestoreBackupModal(plugin.app, plugin).open(),
  });
  addPlaced("Plugin.cmd.exportNotePdf", {
    id: "export-current-note-pdf",
    name: "Export current note to PDF",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file;
      if (!file) return false;
      if (!checking) void exportSingleNoteAsPdf(plugin, file);
      return true;
    },
  });
  addPlaced("Plugin.cmd.exportNoteMarkdown", {
    id: "export-current-note-markdown",
    name: "Export current note to Markdown",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file;
      if (!file) return false;
      if (!checking) void exportSingleNoteAsMarkdown(plugin, file);
      return true;
    },
  });
  addPlaced("Plugin.cmd.exportCurrentHex", {
    id: "export-current-hex",
    name: "Export current hex (structured PDF / Markdown)",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file;
      if (!file || !plugin.isHexFile(file)) return false;
      if (!checking) new HexExportModal(plugin.app, plugin, file).open();
      return true;
    },
  });
  addPlaced("Plugin.cmd.exportCurrentWorkflow", {
    id: "export-current-workflow",
    name: "Export current workflow with rolled samples",
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.file;
      if (!file || !plugin.isWorkflowFile(file)) return false;
      if (!checking) new WorkflowExportModal(plugin.app, plugin, file).open();
      return true;
    },
  });
  // Map export (PNG / PDF / hexcrawl manual): the same form as Maps →
  // Map data callouts (src/hexMapData.ts) in the open map's hex notes: an
  // opt-in for notes made before the template had one.
  addPlaced("Plugin.cmd.addMapDataToHexNotes", {
    id: "add-map-data-to-hex-notes",
    name: "Add map data to this map's hex notes",
    checkCallback: (checking) => {
      const open = plugin.app.workspace.getActiveViewOfType(HexMapView)
        ?? plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).map((l) => l.view).find((v): v is HexMapView => v instanceof HexMapView);
      const mapName = open?.activeMapName;
      if (!mapName || !plugin.getMap(mapName)) return false;
      // No confirm (owner Q6): it only adds a Map data box; the notice says what it did.
      if (!checking) void plugin.addMapDataToHexNotes(mapName).then((n) => new Notice(`Map data added or updated in ${n} hex note${n === 1 ? "" : "s"} of "${plugin.mapLabel(mapName)}" (a box under each title; nothing else changed).`));
      return true;
    },
  });
  // Map data callouts in region and faction notes (R1): which maps use
  // them, with hex counts. Adds the callout where it's missing.
  addPlaced("Plugin.cmd.updateRegionFactionMapData", {
    id: "update-region-faction-map-data",
    name: "Update map data in region and faction notes",
    checkCallback: (checking) => {
      if (!plugin.regionAndFactionNotes().length) return false;
      // No confirm (owner Q6): it only adds or refreshes a Map data box; the notice says what it did.
      if (!checking) void plugin.updateRegionFactionMapData().then((n) => new Notice(`Map data added or updated in ${n} area and faction note${n === 1 ? "" : "s"} (a box under each title; nothing else changed).`));
      return true;
    },
  });
  // Export, for the map open in the hex map view (else the default map).
  addPlaced("Plugin.cmd.exportCurrentMap", {
    id: "export-current-map",
    name: "Export current map…",
    checkCallback: (checking) => {
      const open = plugin.app.workspace.getActiveViewOfType(HexMapView)
        ?? plugin.app.workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP).map((l) => l.view).find((v): v is HexMapView => v instanceof HexMapView);
      const mapName = [open?.activeMapName, plugin.settings.defaultMap, plugin.settings.maps[0]?.name]
        .find((n): n is string => !!n && !!plugin.getMap(n));
      if (!mapName) return false;
      if (!checking) new MapExportModal(plugin.app, plugin, mapName).open();
      return true;
    },
  });
  // Solo play (SF3): today's play log note, made if missing.
  addPlaced("Plugin.cmd.openPlayLog", {
    id: "open-play-log",
    name: "Open today's play log",
    callback: () => {
      void ensureLogNote(plugin.app, logFolderFor(plugin.settings))
        .then((file) => openNoteFocused(plugin.app, file))
        .catch((err) => new Notice(`Could not open the play log: ${String(err)}`));
    },
  });
  // File-menu items: right-click any markdown file → Export to PDF /
  // Markdown. Placed by id: Advanced ones go in one "Export note" submenu.
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      addPlacedMenuItems(menu, "Export note", "file-down", [
        { id: "Plugin.fileMenuExportPdf", title: "Export to PDF", short: "PDF", icon: "file-down", run: () => void exportSingleNoteAsPdf(plugin, file) },
        { id: "Plugin.fileMenuExportMarkdown", title: "Export to Markdown", short: "Markdown", icon: "file-text", run: () => void exportSingleNoteAsMarkdown(plugin, file) },
      ], isDebugMode(plugin.app));
    }),
  );
}

/** Right-click "Insert table roller" / "Insert map link" in any editor. */
export function registerEditorMenu(plugin: HexmakerPlugin): void {
  // "editor-menu" is a valid Obsidian workspace event not yet in the official types.
  interface WorkspaceWithEditorMenu {
    on(name: "editor-menu", callback: (menu: Menu, editor: Editor) => void): EventRef;
  }
  plugin.registerEvent(
    (plugin.app.workspace as unknown as WorkspaceWithEditorMenu).on(
      "editor-menu",
      (menu: Menu, editor: Editor) => {
        menu.addItem((item) =>
          item
            .setTitle("Insert table roller")
            .setIcon("dice")
            .setSection("insert")
            .onClick(() => {
              new FileLinkSuggestModal(
                plugin.app,
                plugin,
                (file) => {
                  const block = `\`\`\`duckmage-roller\n${file.path}\n\`\`\``;
                  editor.replaceSelection(block);
                },
                normalizeFolder(plugin.settings.tablesFolder),
              ).open();
            }),
        );
        menu.addItem((item) =>
          item
            .setTitle("Insert map link")
            .setIcon("map")
            .setSection("insert")
            .onClick(() => {
              new MapLinkModal(plugin.app, plugin, (mapName, linkText) => {
                editor.replaceSelection(`[${linkText}](${mapLinkUri(plugin.app.vault.getName(), { map: mapName })})`);
              }).open();
            }),
        );
      },
    ),
  );
}
