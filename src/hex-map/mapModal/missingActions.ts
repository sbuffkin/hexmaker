import { Notice } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { armButton } from "../../ui/footer";

/**
 * Restore / Remove for a missing map (SM-DEL), in the map list and on the
 * map view's empty state. Remove asks once more (a second click) before it
 * drops the map from the list; no file is touched either way.
 */
export function renderMissingActions(el: HTMLElement, plugin: HexmakerPlugin, name: string, done: () => void): void {
  const box = el.createSpan({ cls: "duckmage-map-missing-actions" });
  const restore = box.createEl("button", { text: "Restore", cls: "mod-cta", attr: { title: "Write its map note back from the last saved copy" } });
  restore.addEventListener("click", (e) => {
    e.stopPropagation();
    restore.disabled = true;
    void plugin.restoreMissingMap(name).then(done);
  });
  const remove = box.createEl("button", { text: "Remove", attr: { title: "Drop it from the map list (no files are deleted)" } });
  // The shared two-click guard (src/ui/footer.ts armButton).
  remove.addEventListener("click", (e) => e.stopPropagation());
  armButton(remove, {
    armedText: "Click again to remove",
    onConfirm: () => {
      remove.disabled = true;
      void plugin.removeMapEntry(name).then(() => {
        new Notice(`Removed "${plugin.mapLabel(name)}" from the map list.`);
        done();
      });
    },
  });
}
