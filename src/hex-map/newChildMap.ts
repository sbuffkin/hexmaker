import { App, Notice } from "obsidian";
import { HexmakerModal } from "../HexmakerModal";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { RegionSettings, SubmapKind } from "../types";
import { NewMapSetupModal } from "../worldgen/NewMapSetupModal";
import { DEFAULT_REGION_SETTINGS, regionMapAt } from "../maps/submaps";
import { renderRegionSettingsForm } from "./regionSettingsForm";
import { meshes } from "../overworld/regionWorld";
import { RegionGenModal } from "./BiomeModals";
import { ADD_REGION_LOCKED_HINT, canAdd } from "../workMode";
import { registry } from "../modules";

/** The two kinds of map a hex opens into, with the small line under each (K1). */
export const CHILD_KIND_TEXT: Record<SubmapKind, { title: string; desc: string }> = {
  region: { title: "Region", desc: "This hex up close. Same scale for every hex on this map, and it lines up with the regions next to it." },
  location: { title: "Location", desc: "A separate place in this hex, like a town or dungeon, with its own size." },
};

/**
 * The card text for a map of map type `kind`: that type's own wording
 * when it has one (Space: which to pick for a star system or planet, F10),
 * else the usual.
 */
export function childKindText(kind: string | undefined): Record<SubmapKind, { title: string; desc: string }> {
  return registry.kindInfo(kind)?.childKindText ?? CHILD_KIND_TEXT;
}

export interface NewChildMapHost {
  app: App;
  plugin: HexmakerPlugin;
  /** Called once the new map exists and is linked (callers usually enter it). */
  onCreated: (name: string, kind: SubmapKind) => void;
  /** "Enter it" on a hex that already has a region. */
  onEnter?: (name: string) => void;
}

/**
 * "New map from this hex…": pick Region or Location, then
 * - Location: the usual new-map setup, linked as one of the hex's locations;
 * - Region: the one-time Region settings step if the map has none yet, then
 *   the setup with the size and palette those settings fix, linked as the
 *   hex's region.
 */
export function startNewChildMap(host: NewChildMapHost, parentMap: string, x: number, y: number): void {
  new ChildKindModal(host, parentMap, x, y).open();
}

export function startNewLocation(host: NewChildMapHost, parentMap: string, x: number, y: number): void {
  // An unknown hex (an On arrival table) is rolled first, so the form
  // starts from what turned out to be there (T5).
  void host.plugin.arrival.resolveHex(parentMap, x, y, "new-child-map").then((rolled) => {
    if (rolled) {
      void host.plugin.saveSettings();
      new Notice(`Rolled on arrival: ${rolled.chain}.`);
    }
    new NewMapSetupModal(host.app, host.plugin, ({ name }) => {
      void host.plugin.linkSubmap(parentMap, x, y, name).then(() => host.onCreated(name, "location"));
    }, { map: parentMap, x, y }).open();
  });
}

export function startNewRegion(host: NewChildMapHost, parentMap: string, x: number, y: number): void {
  const parent = host.plugin.getMap(parentMap);
  if (!parent) return;
  // Play mode: making a region is locked (the Region card says so too).
  if (!canAdd(parent)) { new Notice(ADD_REGION_LOCKED_HINT); return; }
  const go = (settings: RegionSettings) => {
    // Rectangles join their neighbours: the region form (biome, blend, seed,
    // live preview) makes it in its slot of the shared grid.
    if (meshes(settings)) {
      new RegionGenModal({
        app: host.app,
        plugin: host.plugin,
        enter: (name) => host.onEnter?.(name),
        changed: () => {},
        made: (name) => host.onCreated(name, "region"),
      }, parentMap, x, y).open();
      return;
    }
    new NewMapSetupModal(host.app, host.plugin, ({ name }) => {
      void host.plugin.linkRegion(parentMap, x, y, name).then((ok) => {
        if (!ok) new Notice("This hex already has a region; the new map was kept as a separate map.");
        host.onCreated(name, ok ? "region" : "location");
      });
    }, { map: parentMap, x, y }, undefined, { settings }).open();
  };
  if (parent.regions) go(parent.regions);
  else new RegionSettingsModal(host.app, host.plugin, parentMap, (s) => go(s)).open();
}

/** Region or Location? One click on either card goes on. */
export class ChildKindModal extends HexmakerModal {
  constructor(private host: NewChildMapHost, private parentMap: string, private x: number, private y: number) {
    super(host.app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("New map from this hex");
    this.modalEl.addClass("duckmage-child-kind-modal");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    const { plugin } = this.host;
    const existing = regionMapAt(plugin.settings.maps, this.parentMap, `${this.x}_${this.y}`);
    const text = childKindText(plugin.kindFor(this.parentMap));

    // The hex's maps first (C11): opening what's there is the usual pick;
    // making another location stays possible below.
    const locations = (plugin.mapStore.get(this.parentMap, `${this.x}_${this.y}`)?.locations ?? [])
      .filter((l) => l !== existing?.name && !!plugin.getMap(l));
    if (locations.length && this.host.onEnter) {
      contentEl.createDiv({ cls: "setting-item-description", text: "This hex already has:" });
      for (const name of locations) {
        const open = contentEl.createEl("button", { cls: "duckmage-child-kind-enter is-existing", text: `Open ${plugin.mapLabel(name)}` });
        open.addEventListener("click", () => { this.close(); this.host.onEnter?.(name); });
      }
      contentEl.createDiv({ cls: "setting-item-description", text: "Or make another:" });
    }

    const card = (kind: SubmapKind, disabledWhy?: string) => {
      const t = text[kind];
      const btn = contentEl.createEl("button", { cls: "duckmage-child-kind-card" });
      btn.createDiv({ cls: "duckmage-child-kind-title", text: t.title });
      btn.createDiv({ cls: "duckmage-child-kind-desc", text: t.desc });
      if (disabledWhy) {
        btn.disabled = true;
        btn.createDiv({ cls: "duckmage-child-kind-why", text: disabledWhy });
      }
      btn.addEventListener("click", () => {
        this.close();
        if (kind === "region") startNewRegion(this.host, this.parentMap, this.x, this.y);
        else startNewLocation(this.host, this.parentMap, this.x, this.y);
      });
      return btn;
    };

    const why = existing
      ? `This hex's region is ${plugin.mapLabel(existing.name)}.`
      : !canAdd(plugin.getMap(this.parentMap)) ? ADD_REGION_LOCKED_HINT : undefined;
    card("region", why);
    if (existing && this.host.onEnter) {
      const enter = contentEl.createEl("button", { cls: "duckmage-child-kind-enter", text: `Enter ${plugin.mapLabel(existing.name)}` });
      enter.addEventListener("click", () => { this.close(); this.host.onEnter?.(existing.name); });
    }
    card("location");
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * The one-time Region settings step (K1): shown the first time someone makes
 * a region on a map. Afterwards the settings live in the map menu's Regions
 * tab, fixed once the first region exists.
 */
export class RegionSettingsModal extends HexmakerModal {
  constructor(app: App, private plugin: HexmakerPlugin, private mapName: string, private onSaved: (s: RegionSettings) => void) {
    super(app);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Region settings");
    this.modalEl.addClass("duckmage-region-settings-modal");
    const { contentEl } = this;
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: `How the regions of ${this.plugin.mapLabel(this.mapName)} cover its hexes. Every region of this map uses these.`,
    });
    const initial: RegionSettings = { ...DEFAULT_REGION_SETTINGS, palette: this.plugin.childPaletteFor(this.mapName) };
    const form = renderRegionSettingsForm(contentEl, this.plugin, initial, { locked: false });
    contentEl.createEl("p", {
      cls: "duckmage-region-settings-footer",
      text: "These are fixed once the first region exists, so every region lines up. They stay visible in the map menu, on the regions tab.",
    });
    const row = contentEl.createDiv({ cls: "duckmage-token-modal-buttons" });
    row.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
    row.createEl("button", { text: "Save and continue", cls: "mod-cta" }).addEventListener("click", () => {
      const s = form.get();
      const problem = form.problem();
      if (problem) { new Notice(problem); return; }
      void this.plugin.setRegionSettings(this.mapName, s).then(() => {
        this.close();
        this.onSaved(s);
      });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
