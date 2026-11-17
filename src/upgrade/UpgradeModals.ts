/**
 * The two modals of the 2.0 upgrade: "This update converts your maps"
 * (asked before anything is converted, B1) and the confirmation of "Undo
 * the 2.0 upgrade" (B2), with its result page.
 */
import type { App } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import { UPGRADE_DETAIL, UPGRADE_LATER_NOTE, UPGRADE_LEAD, UPGRADE_TITLE } from "./upgradeGate";
import type { UndoPlan } from "./undoUpgrade";
import { localTime } from "../BackupsModal";

/** [Upgrade now] [Not now]; closing the modal any other way is Not now. */
export class UpgradeAskModal extends HexmakerModal {
  private answered = false;

  constructor(app: App, private readonly onNow: () => void, private readonly onLater: () => void) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText(UPGRADE_TITLE);
    this.contentEl.addClass("duckmage-upgrade-ask");
    this.contentEl.createEl("p", { text: UPGRADE_LEAD, cls: "duckmage-upgrade-lead" });
    this.contentEl.createEl("p", { text: UPGRADE_DETAIL });
    this.contentEl.createEl("p", { text: UPGRADE_LATER_NOTE, cls: "duckmage-map-origin-desc" });
    this.footer({
      primary: { text: "Upgrade now", cls: "duckmage-upgrade-now", onClick: () => this.answer(this.onNow) },
      cancel: { text: "Not now", cls: "duckmage-upgrade-later", onClick: () => this.answer(this.onLater) },
    });
  }

  private answer(then: () => void): void {
    if (this.answered) return;
    this.answered = true;
    this.close();
    then();
  }

  onClose(): void {
    this.contentEl.empty();
    this.answer(this.onLater);
  }
}

/** What an undo will do, with [Undo the upgrade] [Cancel]. */
export class UndoUpgradeModal extends HexmakerModal {
  constructor(app: App, private readonly plan: UndoPlan, private readonly run: () => void) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Undo the 2.0 upgrade");
    this.contentEl.addClass("duckmage-undo-upgrade");
    const n = Object.keys(this.plan.notes).length;
    this.contentEl.createEl("p", {
      text: `This puts back ${n} note${n === 1 ? "" : "s"} and your settings file as they were when you upgraded (${localTime(this.plan.snapshot.savedAt)}${this.plan.snapshot.from ? `, from ${this.plan.snapshot.from}` : ""}), then switches Hexmaker 2.0 off so you can install 1.5.8.`,
    });
    this.contentEl.createEl("p", { text: "What you changed in 2.0 is lost: 1.5.8 can't read 2.0's maps. Maps, palettes and notes the upgrade made stay in the vault, unused. The notes as they are now are backed up first, in the backups folder." });
    this.footer({
      destructive: { text: "Undo the upgrade", cls: "duckmage-undo-upgrade-go", onClick: () => { this.close(); this.run(); } },
      cancel: () => this.close(),
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** The page shown when the undo is done (or stopped): what to do next. */
export class UndoDoneModal extends HexmakerModal {
  constructor(app: App, private readonly lines: string[], private readonly title: string) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText(this.title);
    this.contentEl.addClass("duckmage-undo-done");
    for (const l of this.lines) this.contentEl.createEl("p", { text: l });
    this.footer({ primary: { text: "OK", onClick: () => this.close() } });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
