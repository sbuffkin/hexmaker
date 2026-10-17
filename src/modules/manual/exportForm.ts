/**
 * The Hexcrawl manual's part of the Map export form: its Fold (player
 * version and the optional parts) among the form's options, its file in
 * "Writes: …", its button after Export PNG / PDF and its line in "What's
 * in each file".
 */

import type { ExportFormContribution } from "../types";
import { Fold } from "../../ui/disclosure";
import { checkbox, inlineCheck } from "../../export/exportFormControls";
import { MANUAL_PARTS, manualFileName, type ManualPart } from "./manualModel";
import type { ManualExportOptions } from "./hexcrawlManual";
import type { MapPdfExportOptions } from "../../export/exporters/mapWithTable";

/**
 * What the manual's button exports with: the form's map choices (the
 * manual has its own hex numbering and print size, so not the PNG's
 * coordinates, legend or size) under the file name the form showed.
 */
export function manualExportOptions(o: MapPdfExportOptions, fileName: string, player: boolean, omit: ManualPart[]): ManualExportOptions {
  return {
    outputName: fileName.replace(/\.pdf$/, ""),
    player,
    showIcons: o.showIcons,
    showPaths: o.showPaths,
    boldPaths: o.boldPaths,
    showFactionOverlay: o.showFactionOverlay,
    showRegionOverlay: o.showRegionOverlay,
    showHexNames: o.showHexNames,
    showTokens: o.showTokens,
    omit,
  };
}

export const manualExportForm: ExportFormContribution = {
  id: "manual",
  render(ctx) {
    const box = new Fold(ctx.options, { title: "Hexcrawl manual", open: false, store: ctx.plugin.app, surface: "MapExport", cls: "duckmage-export-group" });
    const player = checkbox(box.body, "Player version (leave out the hidden and secret sections)", false);
    const partsRow = box.body.createDiv({ cls: "duckmage-export-inline" });
    const partChecks = MANUAL_PARTS.map((p) => ({ key: p.key, cb: inlineCheck(partsRow, p.label, true) }));
    box.track(() => player.checked);
    for (const { cb } of partChecks) box.track(() => !cb.checked);
    // The edition changes the file name ("… player.pdf").
    player.addEventListener("input", () => ctx.changed());
    player.addEventListener("change", () => ctx.changed());

    return {
      fileName: (base) => manualFileName(base, player.checked),
      fileLabel: "manual",
      // A printable gazetteer: legend, encounter tables, keyed hexes by
      // section, index. Uses its own print styling and hex numbering.
      button: {
        label: "Export hexcrawl manual (PDF)",
        // The exporter loads on first use: it draws the map through the PNG renderer, which
        // asks the modules for their overlays, so a static import would make an import cycle.
        run: async (o, fileName) => (await import("./hexcrawlManual")).exportMapAsManual(ctx.plugin, ctx.mapName, manualExportOptions(
          o,
          fileName ?? manualFileName(ctx.mapName, player.checked),
          player.checked,
          partChecks.filter((p) => !p.cb.checked).map((p) => p.key),
        )),
      },
      describe: "Hexcrawl manual: the full game master gazetteer with the parts you tick, hidden and secret sections included, unless you tick the player version.",
    };
  },
};
