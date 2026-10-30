/**
 * "Rename everywhere" for terrains renamed by hand in a palette note (#43).
 *
 * The palette store tells this class about every hand edit (`noteEdit`).
 * Renames are collected per note while the person is still typing in it
 * and offered once they leave it (`offer`): one notice per rename, and only
 * when something still uses the old name (hexes or the base terrain of a
 * map on that palette, or terrain tables with rows). Nothing is changed
 * until "Rename everywhere" is clicked; clicking the notice anywhere else
 * dismisses it. Names waiting for an answer get no new terrain tables
 * (`held`), so the old ones can move to them.
 */

import { Notice, type TFile } from "obsidian";
import type { MapData, TerrainColor } from "../types";
import { parseRandomTable } from "../random-tables/randomTable";
import { detectTerrainRenames, foldRenames, renameOfferText, terrainUse, type TerrainRename } from "./terrainRename";

export interface RenameOfferHost {
  app: { vault: { read(f: TFile): Promise<string> } };
  mapsOnPalette(palette: string): MapData[];
  mapStore: { all(map: string): ReadonlyMap<string, { terrain?: string }> };
  terrainTableFiles(name: string): TFile[];
  renameTerrainEverywhere(palette: string, from: string, to: string): Promise<string | null>;
  ensureTablesForNewTerrains(): Promise<void>;
}

interface Pending extends TerrainRename {
  notice?: Notice;
}

export class TerrainRenameOffers {
  /** Per palette note path. */
  private pending = new Map<string, Pending[]>();

  constructor(private host: RenameOfferHost) {}

  /** A hand edit of the palette note at `path`: fold its renames in. */
  noteEdit(path: string, before: readonly TerrainColor[], after: readonly TerrainColor[]): void {
    const found = detectTerrainRenames(before, after);
    const list = this.pending.get(path) ?? [];
    if (!found.length && !list.length) return;
    const names = new Set(after.map((t) => t.name));
    const next = foldRenames(list, found, names);
    // A rename whose target moved on, or that's gone: its notice no longer applies.
    for (const p of list) {
      const still = next.find((n) => n.from === p.from && n.to === p.to);
      if (!still) p.notice?.hide();
    }
    const kept: Pending[] = next.map((n) => list.find((p) => p.from === n.from && p.to === n.to) ?? n);
    if (kept.length) this.pending.set(path, kept);
    else this.pending.delete(path);
    if (list.length && kept.length < list.length) void this.host.ensureTablesForNewTerrains();
  }

  /** Names waiting for an answer (their tables wait too). */
  held(): Set<string> {
    const out = new Set<string>();
    for (const list of this.pending.values()) for (const p of list) out.add(p.to);
    return out;
  }

  /** Notes with renames waiting. */
  paths(): string[] {
    return [...this.pending.keys()];
  }

  /** The note moved: keep its renames. */
  moved(oldPath: string, newPath: string): void {
    const list = this.pending.get(oldPath);
    if (!list) return;
    this.pending.delete(oldPath);
    this.pending.set(newPath, list);
  }

  /** The note's renames that haven't been offered yet, as notices (call once the person left the note). */
  async offer(path: string, palette: string): Promise<void> {
    const list = this.pending.get(path);
    if (!list) return;
    let dropped = false;
    for (const p of [...list]) {
      if (p.notice) continue;
      const use = terrainUse(p.from, this.host.mapsOnPalette(palette), (m) => this.host.mapStore.all(m));
      const tables = await this.tablesWithRows(p.from);
      if (!use.hexes && !use.baseOf.length && !tables) {
        list.splice(list.indexOf(p), 1);
        dropped = true;
        continue;
      }
      this.show(path, palette, p, renameOfferText(palette, p, use, tables));
    }
    if (!list.length) this.pending.delete(path);
    if (dropped) await this.host.ensureTablesForNewTerrains();
  }

  /** Terrain tables of `name` that have rows (empty ones aren't worth an offer). */
  private async tablesWithRows(name: string): Promise<number> {
    let n = 0;
    for (const f of this.host.terrainTableFiles(name)) {
      try {
        if (parseRandomTable(await this.host.app.vault.read(f)).entries.length) n++;
      } catch { /* unreadable: not counted */ }
    }
    return n;
  }

  private show(path: string, palette: string, p: Pending, text: string): void {
    const notice = new Notice(text, 0);
    p.notice = notice;
    const el = (notice as unknown as { noticeEl?: HTMLElement }).noticeEl;
    const btn = el?.createEl("button", { text: "Rename everywhere", cls: "duckmage-notice-btn" });
    btn?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      notice.hide();
      void this.answer(path, p, true, palette);
    });
    // Clicking the notice anywhere else closes it: that's a no.
    el?.addEventListener("click", () => void this.answer(path, p, false, palette));
  }

  /** The person answered (tests call this directly). */
  async answer(path: string, p: TerrainRename, yes: boolean, palette: string): Promise<void> {
    const list = this.pending.get(path);
    const i = list ? list.findIndex((q) => q.from === p.from && q.to === p.to) : -1;
    if (!list || i < 0) return; // answered already, or the note changed since
    list.splice(i, 1);
    if (!list.length) this.pending.delete(path);
    if (yes) {
      const where = await this.host.renameTerrainEverywhere(palette, p.from, p.to);
      if (where) new Notice(`Renamed "${p.from}" to "${p.to}" everywhere. A backup is in ${where}.`);
    }
    await this.host.ensureTablesForNewTerrains();
  }

  /** Every rename still waiting, by note (tests). */
  pendingFor(path: string): TerrainRename[] {
    return (this.pending.get(path) ?? []).map(({ from, to }) => ({ from, to }));
  }
}
