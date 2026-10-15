/**
 * The map's work-mode button and menu (L2b, split out of HexMapView): the
 * button in the map nav group naming the open map's mode (Play / Build /
 * God), its menu, switching the mode (saved in the map note as `mode:`),
 * and showing the mode on the view (mode class, tools, shrink buttons).
 */
import type { App } from "obsidian";
import type HexmakerPlugin from "../../HexmakerPlugin";
import { allows, lockedHint, TOOL_ACTIONS, WORK_MODES, WORK_MODE_TEXT, workModeOf, type WorkMode } from "../../workMode";
import { ModeMenu } from "../modeMenu";
import type { MapData } from "../../types";
import type { DrawingMode } from "../toolMode";
import type { MapToolbar } from "./mapToolbar";
import type { MapNavigation } from "./mapNavigation";
import type { UndoController } from "./undoController";

export interface WorkModeButtonHost {
  plugin: HexmakerPlugin;
  contentEl: HTMLElement;
  activeMapName(): string;
  getActiveMap(): MapData;
  owView(map: MapData): "regions" | "biomes" | null;
  drawingMode(): DrawingMode | null;
  undos: Pick<UndoController, "commitTerrainStroke" | "commitIconStroke" | "updateUndoButton" | "currentWorkMode">;
  nav: Pick<MapNavigation, "refreshArrivalBar" | "refreshSideCrumbs">;
  toolbar: Pick<MapToolbar, "applyMode">;
  exitCurrentMode(): void;
}

export class WorkModeButton {
  /** The map's work mode (Play / Build / God), always shown. */
  private workModeBtn: HTMLButtonElement | null = null;

  constructor(private host: WorkModeButtonHost) {}

  // The view's state, read live (the bodies below read it as `this.…`).
  private get plugin(): HexmakerPlugin { return this.host.plugin; }
  private get app(): App { return this.host.plugin.app; }
  private get contentEl(): HTMLElement { return this.host.contentEl; }
  private get activeMapName(): string { return this.host.activeMapName(); }
  private get drawingMode(): DrawingMode | null { return this.host.drawingMode(); }
  private get undos(): WorkModeButtonHost["undos"] { return this.host.undos; }
  private get nav(): WorkModeButtonHost["nav"] { return this.host.nav; }
  private get toolbar(): WorkModeButtonHost["toolbar"] { return this.host.toolbar; }
  private getActiveMap(): MapData { return this.host.getActiveMap(); }
  private owView(map: MapData): "regions" | "biomes" | null { return this.host.owView(map); }
  private exitCurrentMode(): void { this.host.exitCurrentMode(); }

  /** The button, in the map nav group after the map button. */
  build(group: HTMLElement): void {
    this.workModeBtn = group.createEl("button", { cls: "duckmage-work-mode-btn" });
    this.workModeBtn.addEventListener("click", (e) => this.openWorkModeMenu(e));
  }

  /** The work-mode switch: names the map's mode; click to pick another. */
  refreshWorkModeBtn(): void {
    this.applyWorkModeUi();
    // Reroll / Lock depend on the mode too (a locked place: God only).
    this.nav.refreshArrivalBar();
    const btn = this.workModeBtn;
    if (!btn) return;
    const mode = workModeOf(this.plugin.getMap(this.activeMapName));
    const text = WORK_MODE_TEXT[mode];
    btn.setText(text.label);
    btn.removeClass("is-play", "is-build", "is-god");
    btn.addClass(`is-${mode}`);
    const tip = `Mode: ${text.label}. ${text.desc} Click to change.`;
    btn.setAttr("title", tip);
    btn.setAttr("aria-label", tip);
  }

  private openWorkModeMenu(e: MouseEvent): void {
    const map = this.plugin.getMap(this.activeMapName);
    if (!map) return;
    const cur = workModeOf(map);
    // Play, Build and God in one list (owner 2026-10-12: God isn't in
    // Advanced); God is also offered where an action needs it (godOffer.ts).
    const menu = new ModeMenu(cur, { store: this.app });
    for (const m of WORK_MODES) {
      menu.add("mode.switch", `${WORK_MODE_TEXT[m].label}: ${WORK_MODE_TEXT[m].short}`, null, () => this.setWorkMode(m), { checked: m === cur, place: `WorkModeMenu.${m}` });
    }
    menu.showAtMouseEvent(e);
  }

  /** Switch the open map's work mode (saved in its map note as `mode:`). */
  setWorkMode(mode: WorkMode): void {
    const map = this.plugin.getMap(this.activeMapName);
    if (!map || workModeOf(map) === mode) return;
    // The current stroke belongs to the mode it was made in.
    this.undos.commitTerrainStroke();
    this.undos.commitIconStroke();
    map.workMode = mode;
    void this.plugin.saveSettings();
    // A tool the new mode locks is put down.
    if (this.drawingMode && !allows(mode, TOOL_ACTIONS[this.drawingMode])) this.exitCurrentMode();
    this.refreshWorkModeBtn();
    // The neighbour "+" buttons lock and unlock with the mode.
    this.nav.refreshSideCrumbs();
    this.applyWorkModeUi();
    // Each mode has its own undo queue (WM6).
    this.undos.updateUndoButton();
  }

  /**
   * Show the open map's mode on the UI: the drawing panel shows only the
   * tools the mode allows, with one line naming the mode that unlocks the
   * rest; the grid's +/− buttons follow (CSS on the mode class).
   */
  applyWorkModeUi(): void {
    const mode = this.undos.currentWorkMode();
    this.contentEl.removeClass("duckmage-mode-play", "duckmage-mode-build", "duckmage-mode-god");
    this.contentEl.addClass(`duckmage-mode-${mode}`);
    this.toolbar.applyMode(mode, this.owView(this.getActiveMap()));
    // Shrinking is God's: in Build the − stays clickable and its click
    // offers to switch (modeAllows → lockedNotice), it isn't just greyed out.
    for (const b of this.contentEl.querySelectorAll<HTMLButtonElement>(".duckmage-shrink-btn")) {
      const ok = allows(mode, "shrink-map");
      b.toggleClass("is-locked", !ok);
      b.setAttr("aria-disabled", String(!ok));
      b.setAttr("title", ok ? "Remove this edge" : lockedHint("shrink-map"));
    }
  }
}
