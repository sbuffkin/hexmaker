/**
 * The content pack surfaces outside the pack dialogs: the setup wizard's
 * "Import a content pack…" button (SF1: an option on its last step for
 * someone bringing notes from another vault, never a step of its own or a
 * prompt) and the Map export form's "Content pack (.zip)" box.
 */

import type HexmakerPlugin from "../../HexmakerPlugin";
import { Disclosure } from "../../ui/disclosure";
import { openPackExport, openPackImport } from "./packCommands";

export function renderPackImportOffer(container: HTMLElement, plugin: HexmakerPlugin): void {
  const row = container.createDiv({ cls: "duckmage-wizard-pack-row" });
  row.createSpan({ cls: "duckmage-wizard-pack-text", text: "Have a content pack (.zip) from another vault? " });
  row.createEl("button", { text: "Import a content pack…", cls: "duckmage-wizard-pack-btn" }).addEventListener("click", () => void openPackImport(plugin));
  new Disclosure(plugin.app, "Wizard.done", () => container).place("Wizard.importPack", row);
}

/** The Map export form's box: not the map but your notes (tables, templates, towns…) in one .zip. `done` closes the form. */
export function renderPackExportBox(box: HTMLElement, plugin: HexmakerPlugin, done: () => void): void {
  box.addClass("duckmage-export-pack");
  box.createDiv({ cls: "duckmage-export-group-title", text: "Content pack (.zip)" });
  box.createDiv({ cls: "duckmage-export-tab-row-hint", text: "Your tables, workflows, templates, towns and other notes in one .zip, to bring into another vault." });
  box.createEl("button", { text: "Export content pack…" }).addEventListener("click", () => {
    done();
    void openPackExport(plugin);
  });
}
