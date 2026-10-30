/**
 * The World types dialog's rows while they're edited, and when to save
 * them (SP2: autosave like the hex editor). DOM-free so it can be tested.
 *
 * - Rows are kept as their note cells. Only rows that read are ever
 *   written; a row that doesn't (half made, an unknown map kind) stays
 *   here, marked incomplete, until it's fixed or removed, and is dropped
 *   when the dialog closes.
 * - `base` is each table as the note had it when last read or saved. A
 *   save writes only when the readable rows differ from it, so opening and
 *   closing (or undoing an edit) writes nothing.
 * - Hand edits to the note while the dialog is open (sync()): a table the
 *   dialog hasn't changed takes the note's rows; one changed in both
 *   places takes the note's rows too (the note wins, and the caller says
 *   so). The store also skips a table the note changed under a save
 *   (WorldTypeStore.update's `base`), so a save never overwrites a hand
 *   edit it hasn't seen yet.
 */

import {
  featureCells,
  readFeatureCells,
  readStarCells,
  readWorldTypeCells,
  sameOptional,
  starCells,
  worldTypeCells,
  type SectorFeatureRow,
  type StarTypeRow,
  type WorldTypeExtras,
  type WorldTypeRow,
  type WorldTypeTable,
} from "./worldTypes";

export type WorldTypesTab = "worlds" | "stars" | "features";
export const TAB_ORDER: WorldTypesTab[] = ["worlds", "stars", "features"];

/** What the draft needs from WorldTypeStore. */
export interface DraftStore {
  get(name: string): WorldTypeTable | undefined;
  update(name: string, rows: readonly WorldTypeRow[], extras: WorldTypeExtras, base?: WorldTypeTable): Promise<boolean>;
}

type AnyRow = WorldTypeRow | StarTypeRow | SectorFeatureRow;
interface Codec {
  read: (cells: readonly string[]) => { row?: AnyRow; problem?: string };
  cells: (row: never) => string[];
}
const CODECS: Record<WorldTypesTab, Codec> = {
  worlds: { read: readWorldTypeCells, cells: worldTypeCells },
  stars: { read: readStarCells, cells: starCells },
  features: { read: readFeatureCells, cells: featureCells },
};

/** A table's rows for a tab (undefined: the note has no such table). */
function rowsOf(t: WorldTypeTable | undefined, tab: WorldTypesTab): AnyRow[] | undefined {
  if (!t) return undefined;
  return tab === "worlds" ? t.rows : tab === "stars" ? t.stars : t.features;
}

function same(tab: WorldTypesTab, a: readonly AnyRow[] | undefined, b: readonly AnyRow[] | undefined): boolean {
  return sameOptional(a, b, CODECS[tab].cells as (r: AnyRow) => string[]);
}

export interface SyncResult {
  /** The rows shown changed (re-draw). */
  changed: boolean;
  /** Tabs where edits made here gave way to the note's hand edits. */
  replaced: WorldTypesTab[];
}

export class WorldTypesDraft {
  /** The rows being edited, as note cells, per tab. */
  cells: Record<WorldTypesTab, string[][]> = { worlds: [], stars: [], features: [] };
  /** The table as the note had it when last read or saved. */
  private base: WorldTypeTable | undefined;
  /** What the save in flight is writing (to tell its echo from a hand edit). */
  private sent: WorldTypeTable | undefined;

  constructor(private store: DraftStore, public name: string) {
    this.load();
  }

  /** Read the table from the store (dropping anything not saved). */
  load(name: string = this.name): void {
    this.name = name;
    this.base = this.store.get(name);
    this.sent = undefined;
    for (const tab of TAB_ORDER) this.cells[tab] = this.cellsOf(tab, rowsOf(this.base, tab));
  }

  private cellsOf(tab: WorldTypesTab, rows: readonly AnyRow[] | undefined): string[][] {
    const toCells = CODECS[tab].cells as (r: AnyRow) => string[];
    return (rows ?? []).map((r) => toCells(r));
  }

  /** A tab's rows that read (the ones that would be saved). */
  readable(tab: "worlds"): WorldTypeRow[];
  readable(tab: "stars"): StarTypeRow[];
  readable(tab: "features"): SectorFeatureRow[];
  readable(tab: WorldTypesTab): AnyRow[];
  readable(tab: WorldTypesTab): AnyRow[] {
    const out: AnyRow[] = [];
    for (const c of this.cells[tab]) {
      const { row } = CODECS[tab].read(c);
      if (row) out.push(row);
    }
    return out;
  }

  /** Why a row can't be read, or undefined. */
  problem(tab: WorldTypesTab, cells: readonly string[]): string | undefined {
    return CODECS[tab].read(cells).problem;
  }

  /** How many rows (all tabs) can't be read yet. */
  incompleteCount(): number {
    let n = 0;
    for (const tab of TAB_ORDER) for (const c of this.cells[tab]) if (this.problem(tab, c)) n++;
    return n;
  }

  /** The table as edited here (readable rows only), for the preview. */
  table(): WorldTypeTable {
    return { name: this.name, rows: this.readable("worlds"), stars: this.readable("stars"), features: this.readable("features") };
  }

  /**
   * What a save would write for a tab: undefined for Stars / Sector
   * features when the note has no such table and none of its rows read
   * (so a half-made first row doesn't add an empty table).
   */
  private wanted(tab: WorldTypesTab): AnyRow[] | undefined {
    const rows = this.readable(tab);
    if (tab !== "worlds" && !rowsOf(this.base, tab) && !rows.length) return undefined;
    return rows;
  }

  /** Readable rows differ from the note's (a save would write). */
  hasChanges(): boolean {
    if (!this.base) return false;
    return TAB_ORDER.some((tab) => !same(tab, this.wanted(tab), rowsOf(this.base, tab)));
  }

  /** Write the readable rows if they changed. True when a write was asked for. */
  async save(): Promise<boolean> {
    if (!this.hasChanges() || !this.base) return false;
    const rows = this.readable("worlds");
    const extras: WorldTypeExtras = {};
    const stars = this.wanted("stars") as StarTypeRow[] | undefined;
    const features = this.wanted("features") as SectorFeatureRow[] | undefined;
    if (stars) extras.stars = stars;
    if (features) extras.features = features;
    this.sent = { name: this.name, rows, ...extras } as WorldTypeTable;
    const base = this.base;
    try {
      return await this.store.update(this.name, rows, extras, base);
    } finally {
      this.sent = undefined;
    }
  }

  /** The store changed: take in hand edits (see the file comment). */
  sync(): SyncResult {
    const theirs = this.store.get(this.name);
    const out: SyncResult = { changed: false, replaced: [] };
    if (!theirs || !this.base) return out;
    for (const tab of TAB_ORDER) {
      const t = rowsOf(theirs, tab);
      const b = rowsOf(this.base, tab);
      if (same(tab, t, b)) continue;
      // Our own save coming back: the note now matches what we wrote.
      const echo = this.sent && same(tab, t, rowsOf(this.sent, tab));
      const ours = this.wanted(tab);
      if (!echo && !same(tab, ours, t)) {
        if (!same(tab, ours, b)) out.replaced.push(tab);
        // Take the note's rows; rows still being made here stay, at the end.
        const incomplete = this.cells[tab].filter((c) => this.problem(tab, c));
        this.cells[tab] = [...this.cellsOf(tab, t), ...incomplete];
        out.changed = true;
      }
    }
    this.base = theirs;
    return out;
  }
}
