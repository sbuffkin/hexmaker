/**
 * "Recalculate fields" (plan-custom-hex-fields phase 1): redo a map's hex
 * fields after places were added or the fields note changed. Two ways:
 * keep the rolls and typed values and redo what places do (the usual one,
 * primary), or roll every field again (overwrites typed values). One
 * undo step on the map.
 */

import { Notice, type App } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { HexmakerModal } from "../HexmakerModal";
import { lockedHint } from "../workMode";
import { canDo } from "../modeGate";
import { fieldsOf } from "./context";
import type { RecalcReport } from "./FieldsService";

/** The notice after a recalculation. */
export function recalcSummary(map: string, r: RecalcReport): string {
  if (r.refused) return `${map}: ${lockedHint("edit-fields")}`;
  const hexes = r.hexes === 1 ? "1 hex" : `${r.hexes} hexes`;
  const places = r.places === 1 ? "1 place" : `${r.places} places`;
  return `Fields on ${map}: ${hexes} changed, ${places} counted.`;
}

export class RecalculateFieldsModal extends HexmakerModal {
  constructor(app: App, private plugin: HexmakerPlugin, private mapName: string) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText(`Recalculate fields: ${this.mapName}`);
    const { contentEl } = this;
    contentEl.addClass("duckmage-recalc-fields-modal");
    const fields = fieldsOf(this.plugin)?.fields() ?? [];
    if (!fields.length) {
      contentEl.createEl("p", { text: "This world has no hex fields yet. Add some in the plugin's settings." });
      this.footer({ cancel: { text: "Close", onClick: () => this.close() } });
      return;
    }
    contentEl.createEl("p", { text: `Fields: ${fields.map((f) => f.name).join(", ")}.` });
    if (!canDo(this.mapName, "edit-fields")) {
      contentEl.createEl("p", { text: lockedHint("edit-fields"), cls: "duckmage-editor-mode-locked" });
      this.footer({ cancel: { text: "Close", onClick: () => this.close() } });
      return;
    }
    contentEl.createEl("p", { text: "Update places: keeps every roll and every value typed by hand, works out what towns and cities do to the hexes around them again, fills blank fields and recomputes formulas." });
    contentEl.createEl("p", { text: "Roll everything again: every field on every hex with terrain is rolled again, including values typed by hand." });
    contentEl.createEl("p", { text: "Undo puts the hexes back." });
    const run = (pass: "modifiers" | "reroll") => {
      this.close();
      void fieldsOf(this.plugin)!.recalculate(this.mapName, pass).then((r) => new Notice(recalcSummary(this.mapName, r)));
    };
    this.footer({
      primary: { text: "Update places", onClick: () => run("modifiers"), cls: "duckmage-recalc-modifiers" },
      destructive: { text: "Roll everything again", onClick: () => run("reroll"), cls: "duckmage-recalc-reroll" },
      cancel: () => this.close(),
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
