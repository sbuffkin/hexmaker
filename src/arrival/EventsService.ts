/**
 * The Events ledgers in map notes (SP6; pure parts in eventsLedger.ts).
 *
 * - `ledgersFor` reads what a map roll must leave out: the root map's
 *   ledger (per world) and the map's own (per map). Read fresh from the
 *   notes every time, so a row deleted by hand frees its event at once.
 * - `record` writes what a roll fired: `per world` rows to the root map's
 *   note, `per map` rows to the map's own. Nothing fired, nothing written.
 * - `forgetMap` takes out the rows a map's own landscape fired (its
 *   Where names the map), before that landscape is rerolled.
 *
 * Reads and writes go through the map-note write queue (editNoteText), so
 * no map write lands in between.
 */

import type HexmakerPlugin from "../HexmakerPlugin";
import { mapLinkText } from "../maps/mapNote";
import { mapRoot } from "../maps/mapWalk";
import { eventOnMap, eventRow, NO_LEDGERS, readEvents, withEvents, withoutEvents, type FiredEvent, type LedgerEvent, type Ledgers } from "./eventsLedger";

type Host = Pick<HexmakerPlugin, "getMap" | "parentOf" | "mapStore">;

export class EventsService {
  constructor(private plugin: Host) {}

  /**
   * The top of `map`'s map tree (the map itself when it has no parent).
   * Maps that are each other's submaps share one top (mapRoot, MG8).
   */
  rootOf(map: string): string {
    return mapRoot(map, (m) => {
      const up = this.plugin.parentOf(m)?.map;
      return up && this.plugin.getMap(up) ? up : undefined;
    });
  }

  /** A map note's ledger rows (none when it has no note or no ## Events). */
  private async read(map: string): Promise<LedgerEvent[]> {
    let text = "";
    await this.plugin.mapStore.editNoteText(map, (c) => { text = c; return c; });
    return readEvents(text);
  }

  /**
   * The ledgers for a roll on `map`. A map that isn't made yet passes
   * `parent` (where it will sit) instead: its own ledger is empty and the
   * world is its parent's.
   */
  async ledgersFor(where: { map?: string; parent?: string }): Promise<Ledgers> {
    const own = where.map && this.plugin.getMap(where.map) ? where.map : undefined;
    const from = own ?? (where.parent && this.plugin.getMap(where.parent) ? where.parent : undefined);
    if (!from) return NO_LEDGERS;
    const root = this.rootOf(from);
    const world = await this.read(root);
    const map = !own ? [] : own === root ? world : await this.read(own);
    return { world, map };
  }

  /**
   * Write the events a roll on `map` fired: per world to the root map's
   * note, per map to `map`'s. Returns how many rows were written.
   */
  async record(map: string, fired: readonly FiredEvent[] | undefined, date = new Date().toISOString().slice(0, 10)): Promise<number> {
    if (!fired?.length || !this.plugin.getMap(map)) return 0;
    const where = { mapLink: mapLinkText(map), date };
    const byNote = new Map<string, LedgerEvent[]>();
    const root = this.rootOf(map);
    for (const f of fired) {
      const note = f.scope === "world" ? root : map;
      byNote.set(note, [...(byNote.get(note) ?? []), eventRow(f, where)]);
    }
    let n = 0;
    for (const [note, rows] of byNote) {
      if (await this.plugin.mapStore.editNoteText(note, (c) => withEvents(c, rows))) n += rows.length;
    }
    return n;
  }

  /** Take out the ledger rows whose Where is on `map` (its own and its world's). */
  async forgetMap(map: string): Promise<void> {
    const notes = new Set([map, this.rootOf(map)]);
    for (const note of notes) await this.plugin.mapStore.editNoteText(note, (c) => withoutEvents(c, (e) => eventOnMap(e, map)));
  }
}
