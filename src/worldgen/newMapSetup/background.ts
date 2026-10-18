/**
 * New map's Background image row (top-level maps, Advanced): pick a vault
 * image, drop one from the computer (imported into the new map's _bg
 * folder on create), or clear it.
 */

import type { App } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { FileLinkSuggestModal } from "../../hex-map/FileLinkSuggestModal";
import { IMAGE_EXTENSIONS, attachImageDropZone } from "../../utils";

/** The image picked: a vault path, or a dropped file to import. */
export interface NewMapBackground {
  path: string | null;
  file: File | null;
}

/** Draw the row's controls into `row` (its control cell); `bg` is updated in place. */
export function renderBackgroundRow(row: HTMLElement, app: App, plugin: HexmakerPlugin, bg: NewMapBackground): void {
  row.addClass("duckmage-bg-image-row");
  const none = "(None) — drop an image here";
  const label = row.createSpan({ cls: "duckmage-bg-image-path", text: bg.file ? `${bg.file.name} (imported on create)` : (bg.path ?? none) });
  const pick = row.createEl("button", { text: "Pick image…" });
  const clear = row.createEl("button", { text: "Clear" });
  clear.disabled = !bg.path && !bg.file;
  pick.addEventListener("click", () => {
    new FileLinkSuggestModal(app, plugin, (file) => {
      bg.path = file.path;
      bg.file = null;
      label.setText(file.path);
      clear.disabled = false;
    }, "", IMAGE_EXTENSIONS).open();
  });
  clear.addEventListener("click", () => {
    bg.path = null;
    bg.file = null;
    label.setText(none);
    clear.disabled = true;
  });
  // An image dragged in from the computer, as in Properties: imported
  // into the new map's _bg folder when the map is created.
  attachImageDropZone(row, async (file) => {
    bg.file = file;
    bg.path = null;
    label.setText(`${file.name} (imported on create)`);
    clear.disabled = false;
  });
}
