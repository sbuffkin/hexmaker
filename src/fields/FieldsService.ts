/**
 * Custom hex fields (GitHub #52, plan-custom-hex-fields phase 1): the
 * plugin's half. The decisions are pure (src/fields/mapFields.ts); this
 * service hands them the map's hexes, places and the table roller, and
 * writes what comes back.
 *
 * - The world's declarations: `store` (the fields note, FieldStore).
 * - Filling: a hex that gets terrain has its blank fields worked out in the
 *   same write (MapStore → maps/fieldFill.ts, bound by the module runtime).
 * - Editing: `setValue` (the hex editor), gated `edit-fields` (Build).
 * - Recalculate fields: every hex with terrain on a map, keeping rolls or
 *   rolling again.
 *
 * Places come from terrain (synchronous, from the map store) and from the
 * notes linked under a hex note's Towns (from the metadata cache); both
 * are cached per map until the map or any note changes.
 */

import { TFile, TFolder } from "obsidian";
import type HexmakerPlugin from "../HexmakerPlugin";
import type { HexData } from "../maps/mapNote";
import { FieldStore } from "./FieldStore";
import { typedOnHex, workOutHex, workOutMap, type MapFieldsInput } from "./mapFields";
import { linksUnderHeading, notePlaceType, placeTypes, terrainPlaces } from "./places";
import type { FieldDef } from "./fieldTypes";
import type { Place } from "./influence";
import type { FieldPass } from "./hexFields";
import { rollForHex } from "../random-tables/hexRoll";
import { hexDistance } from "../paths/router";
import { hexPair } from "../hexKey";
import { canonicalSection } from "../sections";
import { guardWrite } from "../modeGate";
import type { ModuleStore } from "../modules/types";

const HEX_NOTE = /^(-?\d+)_(-?\d+)$/;

export interface RecalcReport {
  hexes: number;
  places: number;
  refused?: boolean;
}

export class FieldsService {
  readonly store: FieldStore;
  private placeCache = new Map<string, Place[]>();

  constructor(private plugin: HexmakerPlugin) {
    this.store = new FieldStore(plugin);
    this.store.onChange(() => this.placeCache.clear());
  }

  /** What the plugin's vault events reach (the store's own start is `init`, once the map store is in). */
  moduleStore(): ModuleStore & { service: FieldsService } {
    return {
      id: "hex-fields",
      service: this,
      init: () => Promise.resolve(),
      onCreate: (f) => this.store.onModify(f),
      onModify: (f) => this.store.onModify(f),
      onDelete: (f) => this.store.onDelete(f),
      onRename: (f, oldPath) => this.store.onRename(f, oldPath),
      onMetadataChanged: () => this.onMetadataChanged(),
    };
  }

  /** Start: read the fields note; forget a map's places whenever it changes. */
  async init(): Promise<void> {
    this.plugin.mapStore.onChange((map) => this.placeCache.delete(map));
    await this.store.init();
  }

  /** Any note's metadata changed (a Towns link, a `place-type:`): places are found again. */
  onMetadataChanged(): void {
    this.placeCache.clear();
  }

  /** The world's fields (empty without a fields note). */
  fields(): readonly FieldDef[] {
    return this.store.get().fields;
  }

  // ── what the pure side needs ───────────────────────────────────────────

  /** Every place on a map (cached until the map or a note changes). */
  places(map: string): Place[] {
    const hit = this.placeCache.get(map);
    if (hit) return hit;
    const types = placeTypes(this.store.get().influences);
    const typeOf = this.typeOf(map);
    const out = [...terrainPlaces(this.plugin.mapStore.all(map), types, typeOf), ...this.notePlaces(map, types)];
    this.placeCache.set(map, out);
    return out;
  }

  /** The places linked under each hex note's Towns: the note's `place-type:` (else town). */
  private notePlaces(map: string, types: ReadonlySet<string>): Place[] {
    const { vault, metadataCache } = this.plugin.app;
    const folder = vault.getAbstractFileByPath(this.plugin.mapStore.mapFolder(map));
    if (!(folder instanceof TFolder)) return [];
    const out: Place[] = [];
    for (const f of folder.children) {
      if (!(f instanceof TFile) || f.extension !== "md" || !HEX_NOTE.test(f.basename)) continue;
      const links = linksUnderHeading(metadataCache.getFileCache(f), (h) => canonicalSection(h) === "towns");
      for (const link of links) {
        const note = metadataCache.getFirstLinkpathDest(link.split("#")[0], f.path);
        if (!note) continue;
        const fm = metadataCache.getFileCache(note)?.frontmatter;
        out.push({ key: f.basename, type: notePlaceType(fm, types), note: note.path, source: `[[${note.basename}]]` });
      }
    }
    return out;
  }

  private typeOf(map: string): (terrain: string) => string | undefined {
    const byName = new Map(this.plugin.getMapPalette(map).map((t) => [t.name.toLowerCase(), t.type]));
    return (terrain) => byName.get(terrain.toLowerCase());
  }

  /** Everything the pure side reads for a map. */
  input(map: string): MapFieldsInput {
    const orientation = this.plugin.settings.hexOrientation ?? "flat";
    const stagger = this.plugin.getMap(map)?.staggerOffset ?? this.plugin.settings.staggerOffset ?? "odd";
    const lookup = this.plugin.tableNotes.lookup();
    return {
      decls: this.store.get(),
      hexes: this.plugin.mapStore.all(map),
      places: this.places(map),
      distance: (a, b) => hexDistance(hexPair(a), hexPair(b), orientation, stagger),
      typeOf: this.typeOf(map),
      roll: (field, ctx) => {
        if (!field.table) return undefined;
        const text = rollForHex(field.table, lookup, ctx).text.split("\n")[0]?.trim();
        return text || undefined;
      },
    };
  }

  // ── writes ─────────────────────────────────────────────────────────────

  /** A hex that just got terrain: its blank fields (MapStore's filler; no write of its own). */
  fillFor(map: string, key: string, h: HexData): Record<string, string> | undefined {
    if (!this.store.get().fields.length) return undefined;
    return workOutHex(this.input(map), key, h, "fill");
  }

  /** A value typed in the hex editor (Build; formulas follow). False when the mode refuses it. */
  setValue(map: string, key: string, field: string, raw: string): boolean {
    const next = typedOnHex(this.input(map), key, field, raw);
    if (!next) return true;
    return this.plugin.mapStore.set(map, key, { extra: Object.keys(next).length ? next : null }, "edit-fields");
  }

  /** Roll one field again on one hex (the editor's 🎲): its value and roll cleared, then filled. */
  rollField(map: string, key: string, field: string): boolean {
    const input = this.input(map);
    const cleared = typedOnHex(input, key, field, "") ?? input.hexes.get(key)?.extra;
    const h = { ...(input.hexes.get(key) ?? {}), extra: cleared };
    const next = workOutHex(input, key, h, "fill") ?? cleared;
    return this.plugin.mapStore.set(map, key, { extra: next && Object.keys(next).length ? next : null }, "edit-fields");
  }

  /**
   * Recalculate fields on a map: `modifiers` keeps rolls and typed values
   * and redoes the places' changes (filling blank fields); `reroll` rolls
   * every field again. One undo step.
   */
  async recalculate(map: string, pass: Extract<FieldPass, "modifiers" | "reroll">): Promise<RecalcReport> {
    if (!guardWrite(map, "edit-fields")) return { hexes: 0, places: 0, refused: true };
    this.placeCache.delete(map);
    const input = this.input(map);
    const cells = workOutMap(input, pass);
    if (cells.length) {
      await this.plugin.undoableEdit(map, () => this.plugin.mapStore.setMany(map, cells.map(([k, extra]) => [k, { extra: Object.keys(extra).length ? extra : undefined }])));
    }
    return { hexes: cells.length, places: input.places.length };
  }
}
