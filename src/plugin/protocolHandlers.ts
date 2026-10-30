/**
 * The plugin's obsidian:// actions: duckmage-roll (a table), duckmage-workflow
 * (a workflow) and the map / hex link (src/hexLink.ts). Split from
 * HexmakerPlugin.onload (plan-architecture-refactor L1a).
 */
import type HexmakerPlugin from "../HexmakerPlugin";
import { HexMapView } from "../hex-map/HexMapView";
import { VIEW_TYPE_HEX_MAP } from "../constants";
import { OPEN_MAP_ACTION, parseMapLinkParams } from "../hexLink";
import { openRandomTablesAt } from "../workspace/views";

export function registerProtocolHandlers(plugin: HexmakerPlugin): void {
  plugin.registerObsidianProtocolHandler("duckmage-roll", (params) => {
    const filePath = params["file"];
    if (!filePath) return;
    openRandomTablesAt(plugin.app.workspace, filePath, "tables");
  });

  plugin.registerObsidianProtocolHandler("duckmage-workflow", (params) => {
    const filePath = params["file"];
    if (!filePath) return;
    openRandomTablesAt(plugin.app.workspace, filePath, "workflows");
  });

  // A map link (`map=`), or a hex link (`map=&x=&y=`: the map centred on
  // that hex, e.g. copied from the hex editor's centre dot). src/hexLink.ts.
  plugin.registerObsidianProtocolHandler(OPEN_MAP_ACTION, (params) => {
    const target = parseMapLinkParams(params);
    if (!target) return;
    const go = (view: HexMapView, record: boolean) => {
      if (target.hex) view.goToHex(target.map, target.hex.x, target.hex.y, { recordHistory: record });
      else view.navigateToMap(target.map, { recordHistory: record });
    };
    const { workspace } = plugin.app;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP);
    if (leaves.length > 0) {
      // Revealing loads a deferred (restored, never shown) tab first.
      void workspace.revealLeaf(leaves[0]).then(() => {
        if (leaves[0].view instanceof HexMapView) go(leaves[0].view, true);
      });
    } else {
      void workspace.getLeaf("tab")
        .setViewState({ type: VIEW_TYPE_HEX_MAP })
        .then(() => {
          const view = workspace.getLeavesOfType(VIEW_TYPE_HEX_MAP)[0]?.view;
          if (view instanceof HexMapView) go(view, false);
        });
    }
  });
}
