/**
 * "Change area" (plan-hf6-generator-realms; the party controls' Area button
 * in Play): the land ahead comes from another generator. Pick it, say where
 * its area lies (here, near, far, really far) and which way; its centre goes
 * at a seeded spot in that direction and band (Reroll the spot picks again).
 * Hexes already explored stay as they are; coming back to an area gives its
 * old terrain again. A direction where another area already holds the land
 * is off, its tooltip naming it. Advanced: the borders between areas.
 *
 * Setting it is one undo (the map's `explore-realms`, and its borders when
 * they changed).
 */

import { App, Notice } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import { HexmakerModal } from "../HexmakerModal";
import type { UndoItem } from "../hex-map/undoItems";
import { kindOfTerrains } from "../mapKinds";
import { kindsForPalette, listGeneratorKinds, visibleKinds, type TerrainGeneratorKind } from "../worldgen/registry";
import { newPickerState, pickerSettings, renderGeneratorPicker } from "../worldgen/newMapSetup/generatorPicker";
import { exploreOf } from "./context";
import type { ExploreMap } from "./exploreFields";
import {
  REACH_LABEL,
  blockedDirections,
  describeCentre,
  directions,
  formatRealm,
  parseBorders,
  parseRealms,
  placeCentre,
  realmAt,
  uniqueRealmName,
  type Borders,
  type Reach,
} from "./realms";
import { sourceOf } from "./realmFlowers";

const WHERE: Exclude<Reach, "home">[] = ["here", "near", "far", "really far"];
const BORDERS: [Borders, string][] = [["narrow", "Narrow"], ["normal", "Normal"], ["wide", "Wide"], ["sharp", "Sharp (no mixing)"]];

/** The area the party stands in on an explored map with realms (undefined: none). */
export function areaAt(plugin: HexmakerPlugin, map: ExploreMap, hex: string): string | undefined {
  const { realms } = parseRealms(map.exploreRealms);
  const ex = exploreOf(plugin);
  if (!realms.length || !ex) return undefined;
  const seed = typeof map.seed === "number" ? map.seed : 0;
  return realmAt(hex, realms, ex.geometry(map), { seed, borders: parseBorders(map.exploreBlend) })?.name;
}

export class ChangeAreaModal extends HexmakerModal {
  protected surfaceId = "ChangeArea";
  private kinds: TerrainGeneratorKind[] = [];
  private picked: string | undefined;
  private reach: Exclude<Reach, "home"> = "far";
  private dir: string | undefined;
  private roll = 0;
  private borders: Borders;
  private picker = newPickerState();
  private done = false;

  constructor(
    app: App,
    private plugin: HexmakerPlugin,
    private map: ExploreMap,
    private party: string,
    private resolve: (undo: UndoItem[]) => void,
  ) {
    super(app);
    this.borders = parseBorders(map.exploreBlend);
  }

  onOpen(): void {
    this.makeDraggable();
    this.titleEl.setText("Change area");
    this.contentEl.createDiv({ cls: "duckmage-setup-loading", text: "Loading generators…" });
    void listGeneratorKinds(this.plugin).then((all) => {
      exploreOf(this.plugin)?.useKinds(all);
      const terrains = this.plugin.getPaletteOrPresetTerrains(this.map.paletteName);
      const context = new Set([kindOfTerrains(terrains), this.plugin.getPaletteOrPresetKind(this.map.paletteName)]);
      this.kinds = kindsForPalette(visibleKinds(all, this.plugin.settings, context), terrains).filter((k) => k.source !== "blank" && !k.needsContext);
      this.picked = this.kinds[0]?.id;
      this.render();
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.done) this.resolve([]);
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.resetDisclosure();
    const ex = exploreOf(this.plugin);
    if (!ex) return;
    const g = ex.geometry(this.map);
    const seed = typeof this.map.seed === "number" ? this.map.seed : 0;
    const { realms } = parseRealms(this.map.exploreRealms);
    const now = areaAt(this.plugin, this.map, this.party);
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text: `${now ? `The party is in ${now}. ` : ""}Pick the generator the land ahead comes from, and where its area lies. Hexes already explored stay as they are.`,
    });
    const terrains = this.plugin.getPaletteOrPresetTerrains(this.map.paletteName);
    renderGeneratorPicker(contentEl.createDiv(), {
      kinds: this.kinds,
      terrains,
      selected: this.picked,
      state: this.picker,
      ...pickerSettings(this.plugin),
      pick: (k) => { this.picked = k.id; this.render(); },
    });

    const whereRow = contentEl.createDiv({ cls: "duckmage-explore-where" });
    whereRow.createSpan({ cls: "duckmage-explore-where-label", text: "Where is it?" });
    const where = whereRow.createEl("select", { attr: { "aria-label": "Where is it?" } });
    for (const r of WHERE) where.createEl("option", { value: r, text: REACH_LABEL[r] });
    where.value = this.reach;
    where.addEventListener("change", () => { this.reach = where.value as Exclude<Reach, "home">; this.roll = 0; this.render(); });

    const blocked = blockedDirections(this.party, this.reach, realms, g, seed);
    const open = directions(g.orientation).filter((d) => !blocked.has(d.word));
    if (this.reach !== "here") {
      if (!this.dir || blocked.has(this.dir)) this.dir = open[0]?.word;
      whereRow.createSpan({ cls: "duckmage-explore-where-label", text: "Which way?" });
      const ring = whereRow.createDiv({ cls: `duckmage-explore-ring is-${g.orientation}`, attr: { role: "radiogroup", "aria-label": "Which way?" } });
    ring.createSpan({ cls: "duckmage-explore-dir-here", text: "●", attr: { title: "The party" } });
      for (const d of directions(g.orientation)) {
        const by = blocked.get(d.word);
        const b = ring.createEl("button", {
          cls: `duckmage-explore-dir is-${d.word}${this.dir === d.word ? " is-active" : ""}`,
          text: d.word.split("-").map((w) => w[0].toUpperCase()).join(""),
          attr: { role: "radio", "aria-checked": this.dir === d.word ? "true" : "false", "aria-label": d.word, title: by ? `${by} lies that way` : d.word },
        });
        b.disabled = !!by;
        b.addEventListener("click", () => { this.dir = d.word; this.roll = 0; this.render(); });
      }
    }
    const dir = directions(g.orientation).find((d) => d.word === this.dir);
    const centre = placeCentre(this.party, this.reach === "here" ? undefined : dir, this.reach, seed, g, this.roll);
    const spot = contentEl.createDiv({ cls: "setting-item-description" });
    spot.setText(this.reach !== "here" && !dir
      ? "Every direction is under another area at this distance: pick another distance, or Here."
      : `Its centre: ${describeCentre(centre, this.party, g)} of the party.`);

    // Advanced: the borders between areas, and another spot.
    const adv = this.section("advanced");
    if (adv) {
      const reroll = adv.createEl("button", { text: "Reroll the spot", attr: { title: "Another spot in the same direction and band" } });
      reroll.disabled = this.reach === "here";
      reroll.addEventListener("click", () => { this.roll++; this.render(); });
      const bRow = adv.createDiv({ cls: "duckmage-explore-where" });
      bRow.createSpan({ cls: "duckmage-explore-where-label", text: "Borders" });
      const borders = bRow.createEl("select", { attr: { "aria-label": "Borders" } });
      for (const [v, t] of BORDERS) borders.createEl("option", { value: v, text: t });
      borders.value = this.borders;
      borders.addEventListener("change", () => { this.borders = borders.value as Borders; });
    }

    const kind = this.kinds.find((k) => k.id === this.picked);
    this.footer({
      primary: { text: "Set the area", disabled: !kind || (this.reach !== "here" && !dir), onClick: () => { if (kind) this.set(kind, centre); } },
      cancel: () => this.close(),
    });
  }

  private set(kind: TerrainGeneratorKind, centre: string): void {
    const { realms } = parseRealms(this.map.exploreRealms);
    const name = uniqueRealmName(kind.label, realms.map((r) => r.name));
    const before = this.map.exploreRealms;
    const after = [...(before ?? []), formatRealm({ name, from: [sourceOf(kind)], centre, reach: this.reach })];
    this.map.exploreRealms = after;
    const undo: UndoItem[] = [{ kind: "map-field", mapName: this.map.name, field: "exploreRealms", before, after }];
    const bordersBefore = this.map.exploreBlend;
    const bordersAfter = this.borders === "normal" ? undefined : this.borders;
    if (parseBorders(bordersBefore) !== this.borders) {
      if (bordersAfter) this.map.exploreBlend = bordersAfter;
      else delete this.map.exploreBlend;
      undo.push({ kind: "map-field", mapName: this.map.name, field: "exploreBlend", before: bordersBefore, after: bordersAfter });
    }
    void this.plugin.saveSettings();
    const g = exploreOf(this.plugin)?.geometry(this.map);
    new Notice(this.reach === "here" ? `${name}: the land around the party now comes from ${kind.label}.` : `${name} lies ${g ? describeCentre(centre, this.party, g) : "ahead"}.`);
    this.done = true;
    this.resolve(undo);
    this.close();
  }
}

/** Open Change area for the party on `hex`; resolves with the undo entries of what it set (none when cancelled). */
export function openChangeArea(plugin: HexmakerPlugin, map: ExploreMap, hex: string): Promise<UndoItem[]> {
  return new Promise((resolve) => new ChangeAreaModal(plugin.app, plugin, map, hex, resolve).open());
}
