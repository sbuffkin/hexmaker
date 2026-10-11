/**
 * What each hex note's Map data callout showed when the plugin last wrote
 * it (hex-note path → key → value). Phase 2 of the callout compares a
 * note's callout with this to tell a hand edit from a stale copy: without
 * it, an old callout would look like an edit and could undo a newer paint.
 *
 * Kept in the plugin's folder (`map-data-shown.json`), not in the vault's
 * notes: it's bookkeeping, like data.json. A note missing here (first run,
 * a renamed note, another device) has no import: the map wins and the
 * callout is rewritten, as before phase 2.
 */
import type { DataAdapter } from "obsidian";
import type { MapDataShown } from "../hexMapData";

const FILE = "map-data-shown.json";

export class CalloutMemory {
  private shown = new Map<string, MapDataShown>();
  private loading: Promise<void> | null = null;
  private saveTimer: number | null = null;
  private dirty = false;

  constructor(private adapter: () => DataAdapter, private dir: () => string) {}

  private get path(): string {
    return `${this.dir()}/${FILE}`;
  }

  /** Read the file once (later calls wait for the same read). */
  ready(): Promise<void> {
    this.loading ??= (async () => {
      try {
        if (!(await this.adapter().exists(this.path))) return;
        const raw = JSON.parse(await this.adapter().read(this.path)) as { notes?: Record<string, MapDataShown> };
        for (const [p, v] of Object.entries(raw.notes ?? {})) if (v && typeof v === "object" && !this.shown.has(p)) this.shown.set(p, v);
      } catch (e) {
        console.warn("[hexmaker] couldn't read map-data-shown.json; callout edits are imported again once notes are refreshed", e);
      }
    })();
    return this.loading;
  }

  get(path: string): MapDataShown | undefined {
    return this.shown.get(path);
  }

  set(path: string, values: MapDataShown): void {
    const old = this.shown.get(path);
    if (old && JSON.stringify(old) === JSON.stringify(values)) return;
    this.shown.set(path, values);
    this.scheduleSave();
  }

  forget(path: string): void {
    if (this.shown.delete(path)) this.scheduleSave();
  }

  rename(oldPath: string, newPath: string): void {
    const v = this.shown.get(oldPath);
    if (!v) return;
    this.shown.delete(oldPath);
    this.shown.set(newPath, v);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), 1500);
  }

  /** Write now, when anything changed (also on unload). */
  async save(): Promise<void> {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.dirty) return;
    this.dirty = false;
    await this.ready();
    const notes: Record<string, MapDataShown> = {};
    for (const [p, v] of [...this.shown].sort(([a], [b]) => a.localeCompare(b))) notes[p] = v;
    try {
      await this.adapter().write(this.path, JSON.stringify({ version: 1, notes }, null, 1));
    } catch (e) {
      console.warn("[hexmaker] couldn't save map-data-shown.json", e);
    }
  }
}
