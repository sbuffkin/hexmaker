/**
 * "Undo the 2.0 upgrade" (release plan B2): put back what 1.5.x had.
 *
 * Why this is possible from inside Obsidian (checked 2026-11-16 in a
 * sandbox, dev/smoke upgrade case): the plugin can write to the vault and
 * to its own data.json after it is disabled, because the running command is
 * a closure over `app` that outlives `disablePlugin`. So the order is: let
 * every pending write finish, stop the plugin's handlers and saves
 * (disable it), then put the notes and data.json back, and say to install
 * 1.5.8. Nothing is left to migrate or overwrite them; if Obsidian is
 * restarted before 1.5.8 is installed the 2.0 build loads the old data and
 * asks again (src/upgrade/upgradeGate.ts).
 *
 * What it relies on:
 *  - "Upgrade now" saved a snapshot of data.json (`writePreUpgradeSnapshot`)
 *    before anything was converted. No snapshot, no undo (an RC loaded
 *    before the ask existed can't be undone this way: Restore from upgrade
 *    backup… still works note by note).
 *  - Every upgrade step backs up the notes it rewrites first (src/backup.ts),
 *    each backup stamped `savedAt`. The OLDEST backup of a note made since the
 *    snapshot is the note as 1.5.x left it; that is what goes back.
 *
 * What it leaves: notes and files the upgrade made (map notes, palette and
 * template notes, the upgrade note) stay: 1.5.8 ignores them. Edits made in
 * 2.0 are lost (hexes live in map notes 1.5.8 doesn't read; notes put back
 * are the 1.5.x text). Pure parts first; the vault parts take the adapter.
 */

import { listNoteBackups, readJsonBackup, writeJsonBackup, type BackupAdapter, type BackupReadAdapter, type NoteBackup } from "../backup";
import { isSafeNotePath } from "../vault/safePaths";

type Adapter = BackupAdapter & BackupReadAdapter;

/** `kind` of the file "Upgrade now" writes before converting anything. */
export const PRE_UPGRADE_KIND = "pre-2.0-upgrade";
/** `kind` of the backup of 2.0's data.json the undo makes before putting the old one back. */
export const BEFORE_UNDO_KIND = "before-undo-2.0";

export interface PreUpgradeSnapshot {
  /** The backup file. */
  path: string;
  /** When "Upgrade now" saved it (ISO). */
  savedAt: string;
  /** The version that last saved the data (data.json `savedWith`), when it said. */
  from?: string;
  /** data.json's exact text before the upgrade. */
  dataJson: string;
}

/** The backup folder "Upgrade now" writes to. */
export function snapshotDir(backupsFolder: string, when: Date): string {
  return `${backupsFolder}/upgrade-2.0-${when.toISOString().slice(0, 10)}`;
}

/** The savedWith of a data.json text, when it has one. */
export function savedWithOf(dataJson: string): string | undefined {
  try {
    const v = (JSON.parse(dataJson) as { savedWith?: unknown }).savedWith;
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Before the first conversion step: keep data.json as it is. Throws when it
 * can't be saved (the caller then doesn't convert). Returns the backup path.
 */
export async function writePreUpgradeSnapshot(adapter: Adapter, backupsFolder: string, dataJsonPath: string, when = new Date()): Promise<string> {
  const dataJson = await adapter.read(dataJsonPath);
  const json = JSON.stringify({ kind: PRE_UPGRADE_KIND, savedAt: when.toISOString(), from: savedWithOf(dataJson) ?? null, dataJson });
  return writeJsonBackup(adapter, snapshotDir(backupsFolder, when), "data-json", json);
}

/** Every pre-upgrade snapshot under `root`, newest first. */
export async function listSnapshots(adapter: Adapter, root: string): Promise<PreUpgradeSnapshot[]> {
  if (!(await adapter.exists(root))) return [];
  const out: PreUpgradeSnapshot[] = [];
  const walk = async (dir: string): Promise<void> => {
    const { files, folders } = await adapter.list(dir);
    for (const f of files) {
      if (!/\.json(\.gz)?$/i.test(f)) continue;
      const data = (await readJsonBackup(adapter, f)) as { kind?: unknown; savedAt?: unknown; from?: unknown; dataJson?: unknown } | null;
      if (data?.kind !== PRE_UPGRADE_KIND || typeof data.savedAt !== "string" || typeof data.dataJson !== "string") continue;
      out.push({ path: f, savedAt: data.savedAt, dataJson: data.dataJson, ...(typeof data.from === "string" ? { from: data.from } : {}) });
    }
    for (const d of folders) await walk(d);
  };
  await walk(root);
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Backups the undo doesn't read: the ones the restore and undo commands make themselves. */
const SELF_KINDS = new Set(["before-restore", BEFORE_UNDO_KIND]);

/**
 * The notes to put back: for each note, its text in the OLDEST note backup
 * saved at or after `since`. Backups of the restore / undo commands are left
 * out (they hold 2.0 text). Pure.
 */
export function oldestSince(backups: readonly (Pick<NoteBackup, "notes" | "savedAt"> & { kind?: string })[], since: string): Record<string, string> {
  const usable = backups
    .filter((b) => b.savedAt !== undefined && b.savedAt >= since && !(b.kind && SELF_KINDS.has(b.kind)))
    .sort((a, b) => (a.savedAt as string).localeCompare(b.savedAt as string));
  const out: Record<string, string> = {};
  for (const b of usable) for (const [p, text] of Object.entries(b.notes)) if (!(p in out) && isSafeNotePath(p)) out[p] = text;
  return out;
}

export interface UndoPlan {
  snapshot: PreUpgradeSnapshot;
  /** Path → the note as 1.5.x left it. */
  notes: Record<string, string>;
  /** How many backup files that came from. */
  backups: number;
}

/** What an undo would do: the newest snapshot and the notes it puts back. Null: no snapshot, nothing to undo. */
export async function planUndo(adapter: Adapter, backupsFolder: string): Promise<UndoPlan | null> {
  const snapshot = (await listSnapshots(adapter, backupsFolder))[0];
  if (!snapshot) return null;
  const all = await listNoteBackups(adapter, backupsFolder);
  // `kind` isn't kept by listNoteBackups: read it back for the self-made ones.
  const withKind: (NoteBackup & { kind?: string })[] = [];
  for (const b of all) {
    const data = (await readJsonBackup(adapter, b.path)) as { kind?: unknown } | null;
    withKind.push({ ...b, ...(typeof data?.kind === "string" ? { kind: data.kind } : {}) });
  }
  const notes = oldestSince(withKind, snapshot.savedAt);
  const used = withKind.filter((b) => b.savedAt !== undefined && b.savedAt >= snapshot.savedAt && !(b.kind && SELF_KINDS.has(b.kind)));
  return { snapshot, notes, backups: used.length };
}

/** The undo's own backup of the 2.0 data.json (so the undo can itself be undone by hand). */
export async function backUpDataJson(adapter: Adapter, backupsFolder: string, dataJsonPath: string, when = new Date()): Promise<string> {
  const dataJson = await adapter.read(dataJsonPath);
  return writeJsonBackup(adapter, `${backupsFolder}/undo-2.0-${when.toISOString().slice(0, 10)}`, "data-json-2.0", JSON.stringify({ kind: BEFORE_UNDO_KIND, savedAt: when.toISOString(), dataJson }));
}
