/**
 * When the random tables view's list must redraw on its own, so the manual
 * "↺ Refresh list" button is never needed (it's a Debug control now; owner
 * note on RTView.refreshList: "confirm it does it at a good cadence").
 *
 * The list shows: the tables folder's notes and subfolders (empty ones
 * too), each table's group (the map's own tables by `table-type`/made-by
 * frontmatter), linked folders (`linkedFolder`), and which workflows use
 * each table (the workflow notes' links). So it redraws, debounced
 * (LIST_REFRESH_MS), when
 * - a note or folder is created, deleted, renamed or moved in or out of the
 *   tables or workflows folder (vault events), and
 * - a table's or workflow's list inputs change (metadata cache "changed",
 *   compared by `listSignature`, so typing in a table's rows doesn't redraw
 *   the list), and
 * - once when the metadata cache has finished loading ("resolved"), since
 *   the grouping reads frontmatter that may not be cached at startup.
 */

/** Debounce for list redraws (a burst of vault events is one redraw). */
export const LIST_REFRESH_MS = 200;
/** Debounce for the open table's detail redraw after the note changes. */
export const DETAIL_REFRESH_MS = 300;

export interface ListFolders {
  /** Normalised tables folder ("" = the whole vault). */
  tables: string;
  /** Normalised workflows folder ("" = none). */
  workflows: string;
}

const inside = (path: string, folder: string) => path === folder || path.startsWith(folder + "/");

/** Is `path` (a note or folder) one the list shows or depends on? */
export function touchesList(path: string, folders: ListFolders): boolean {
  if (!path) return false;
  if (!folders.tables) return true;
  return inside(path, folders.tables) || (!!folders.workflows && inside(path, folders.workflows));
}

/** The bits of a note's metadata the list depends on. */
export interface ListCache {
  frontmatter?: Record<string, unknown>;
  links?: { link: string }[];
}

/**
 * A note's list inputs as a string: a table's linked folder and table type,
 * a workflow's links. Equal signatures = the list looks the same.
 */
export function listSignature(isWorkflow: boolean, cache: ListCache | null | undefined): string {
  if (isWorkflow) return (cache?.links ?? []).map((l) => l.link).join("\n");
  const fm = cache?.frontmatter ?? {};
  const pick = (k: string) => {
    const v = fm[k];
    return v === undefined || v === null ? "" : JSON.stringify(v);
  };
  return ["linkedFolder", "linked-folder", "table-type"].map(pick).join("|");
}

/** Remembers each note's last signature; says when one changed. */
export class ListSignatures {
  private seen = new Map<string, string>();

  /** True when `path`'s signature differs from last time (a first sighting counts as a change only if `firstIsChange`). */
  changed(path: string, sig: string, firstIsChange = false): boolean {
    const before = this.seen.get(path);
    this.seen.set(path, sig);
    return before === undefined ? firstIsChange : before !== sig;
  }

  forget(path: string): void {
    this.seen.delete(path);
  }

  rename(oldPath: string, newPath: string): void {
    const sig = this.seen.get(oldPath);
    this.seen.delete(oldPath);
    if (sig !== undefined) this.seen.set(newPath, sig);
  }
}
