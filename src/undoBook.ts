/**
 * Parallel undo (owner WM6): one undo/redo queue per map per work mode,
 * kept for as long as the vault is open (the plugin owns the book, so it
 * outlives map views and map changes).
 *
 * - Undo in a mode undoes only what was done in that mode; switching back
 *   to a mode resumes its queue.
 * - An entry whose target changed since (in another mode, or by hand) is
 *   skipped rather than reverting the newer change. The caller's `prepare`
 *   compares the entry's "after" snapshot with what's there now and returns
 *   the part that still matches (or null: the entry is dropped and the next
 *   one is tried).
 *
 * Pure, no Obsidian imports. Item shapes belong to the caller.
 */
import type { WorkMode } from "./workMode";

export const UNDO_DEPTH = 20;

interface Queue<T> {
  undo: T[];
  redo: T[];
}

export type UndoDirection = "undo" | "redo";

/**
 * What to do with an entry: the (possibly trimmed) entry to apply, or null
 * when nothing of it still matches (it is dropped).
 */
export type UndoPrepare<T> = (item: T, dir: UndoDirection) => T | null | Promise<T | null>;

export class UndoBook<T> {
  private queues = new Map<string, Queue<T>>();
  private listeners = new Set<() => void>();

  constructor(private depth = UNDO_DEPTH) {}

  private id(map: string, mode: WorkMode): string {
    return `${mode}\u0000${map}`;
  }

  private queue(map: string, mode: WorkMode): Queue<T> {
    const id = this.id(map, mode);
    let q = this.queues.get(id);
    if (!q) { q = { undo: [], redo: [] }; this.queues.set(id, q); }
    return q;
  }

  /** Record a new action done on `map` in `mode` (clears that queue's redo). */
  push(map: string, mode: WorkMode, item: T): void {
    const q = this.queue(map, mode);
    q.undo.push(item);
    if (q.undo.length > this.depth) q.undo.shift();
    q.redo = [];
    this.changed();
  }

  canUndo(map: string, mode: WorkMode): boolean {
    return (this.queues.get(this.id(map, mode))?.undo.length ?? 0) > 0;
  }

  canRedo(map: string, mode: WorkMode): boolean {
    return (this.queues.get(this.id(map, mode))?.redo.length ?? 0) > 0;
  }

  /** Sizes, for tooltips and tests. */
  size(map: string, mode: WorkMode): { undo: number; redo: number } {
    const q = this.queues.get(this.id(map, mode));
    return { undo: q?.undo.length ?? 0, redo: q?.redo.length ?? 0 };
  }

  /**
   * Take the next entry to undo (or redo) from `map`'s `mode` queue. Entries
   * `prepare` rejects are dropped (popped) and the next one is tried. The
   * returned entry (as prepared) moves to the other stack; the caller
   * applies it. Null when nothing is left.
   */
  async step(map: string, mode: WorkMode, dir: UndoDirection, prepare: UndoPrepare<T>): Promise<T | null> {
    const q = this.queues.get(this.id(map, mode));
    if (!q) return null;
    const from = dir === "undo" ? q.undo : q.redo;
    const to = dir === "undo" ? q.redo : q.undo;
    try {
      while (from.length) {
        const item = from.pop()!;
        const ready = await prepare(item, dir);
        if (ready === null) continue; // its target changed since: dropped
        to.push(ready);
        if (to.length > this.depth) to.shift();
        return ready;
      }
      return null;
    } finally {
      this.changed();
    }
  }

  /** A map was renamed: its queues follow. */
  renameMap(oldName: string, newName: string): void {
    for (const mode of ["play", "build", "god"] as WorkMode[]) {
      const q = this.queues.get(this.id(oldName, mode));
      if (!q) continue;
      this.queues.delete(this.id(oldName, mode));
      this.queues.set(this.id(newName, mode), q);
    }
    this.changed();
  }

  /** A map is gone (deleted): drop its queues. */
  forgetMap(name: string): void {
    for (const mode of ["play", "build", "god"] as WorkMode[]) this.queues.delete(this.id(name, mode));
    this.changed();
  }

  /** Hear about any change (to refresh undo buttons). Returns the unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }
}

// ── Helpers for "does the target still look like it did after the action?" ──

/** Structural equality for small JSON-ish values (arrays in order, objects by keys). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || a === null || b === undefined || b === null) return (a ?? null) === (b ?? null);
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => sameValue(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ra = a as Record<string, unknown>, rb = b as Record<string, unknown>;
    const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
    const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => sameValue(ra[k], rb[k]));
  }
  return false;
}

/**
 * Keep the parts of an entry whose target still shows the value the entry
 * left there (undo: its "after"; redo: its "before"). Parts that changed
 * since are skipped, so undo never reverts a newer change. Empty → null.
 */
export function stillCurrent<E>(
  parts: readonly E[],
  dir: UndoDirection,
  current: (part: E) => unknown,
  before: (part: E) => unknown,
  after: (part: E) => unknown,
): E[] | null {
  const kept = parts.filter((p) => sameValue(current(p), dir === "undo" ? after(p) : before(p)));
  return kept.length ? kept : null;
}

/** One hex's map data fields changed by an action: `field → [before, after]`. */
export interface CellEdit {
  map: string;
  key: string;
  fields: Record<string, [unknown, unknown]>;
}

/**
 * Field-level edits from before/after snapshots of hexes (MapStore.record):
 * only fields that actually changed, so undo leaves other fields alone.
 */
export function cellEdits(cells: readonly { map: string; key: string; before?: object; after?: object }[]): CellEdit[] {
  const out: CellEdit[] = [];
  for (const c of cells) {
    const b = (c.before ?? {}) as Record<string, unknown>;
    const a = (c.after ?? {}) as Record<string, unknown>;
    const fields: Record<string, [unknown, unknown]> = {};
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (!sameValue(b[k], a[k])) fields[k] = [b[k], a[k]];
    }
    if (Object.keys(fields).length) out.push({ map: c.map, key: c.key, fields });
  }
  return out;
}

/**
 * The part of cell edits still in place (each field compared on its own),
 * for undo or redo. `current(map, key)` is the hex's data now.
 */
export function currentCellEdits(
  edits: readonly CellEdit[],
  dir: UndoDirection,
  current: (map: string, key: string) => Record<string, unknown> | undefined,
): CellEdit[] | null {
  const out: CellEdit[] = [];
  for (const e of edits) {
    const now = current(e.map, e.key) ?? {};
    const fields: Record<string, [unknown, unknown]> = {};
    for (const [k, [b, a]] of Object.entries(e.fields)) {
      if (sameValue(now[k], dir === "undo" ? a : b)) fields[k] = [b, a];
    }
    if (Object.keys(fields).length) out.push({ ...e, fields });
  }
  return out.length ? out : null;
}

/** The patch that applies cell edits in a direction (undo → before values, null clears). */
export function cellPatch(edit: CellEdit, dir: UndoDirection): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [k, [b, a]] of Object.entries(edit.fields)) patch[k] = (dir === "undo" ? b : a) ?? null;
  return patch;
}
