/**
 * The setup wizard's "Import a content pack…" button (SF1): an option on
 * its last step for someone bringing notes from another vault, never a
 * step of its own or a prompt.
 */

import type { App } from "obsidian";
import { Disclosure } from "../ui/disclosure";
import { openPackImport } from "./packOpeners";

export function renderPackImportOffer(container: HTMLElement, app: App): void {
  const row = container.createDiv({ cls: "duckmage-wizard-pack-row" });
  row.createSpan({ cls: "duckmage-wizard-pack-text", text: "Have a content pack (.zip) from another vault? " });
  row.createEl("button", { text: "Import a content pack…", cls: "duckmage-wizard-pack-btn" }).addEventListener("click", () => openPackImport());
  new Disclosure(app, "Wizard.done", () => container).place("Wizard.importPack", row);
}
