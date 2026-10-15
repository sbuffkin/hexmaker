/**
 * Full-text backups written before the plugin rewrites notes in bulk (map-note
 * migration, table roll ranges). Saved as gzipped JSON in the plugin's
 * backups folder; never overwrites an earlier backup.
 */

/** The bits of Obsidian's DataAdapter a backup needs. */
export interface BackupAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
}

/**
 * Save `json` as `<dir>/<base>.json.gz` (`.json` where gzip isn't
 * available), adding `-2`, `-3`… rather than overwriting. Returns the path.
 * Throws if it couldn't be saved.
 */
export async function writeJsonBackup(adapter: BackupAdapter, dir: string, base: string, json: string): Promise<string> {
  if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
  const gz = typeof CompressionStream === "function";
  const ext = gz ? ".json.gz" : ".json";
  let path = `${dir}/${base}${ext}`;
  for (let n = 2; await adapter.exists(path); n++) path = `${dir}/${base}-${n}${ext}`;
  if (gz) {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
    await adapter.writeBinary(path, await new Response(stream).arrayBuffer());
  } else {
    await adapter.write(path, json);
  }
  return path;
}

// ── reading backups back (owner MG2: "Restore from upgrade backup…") ──────

/** The bits of Obsidian's DataAdapter reading backups needs. */
export interface BackupReadAdapter {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<ArrayBuffer>;
}

/** A backup file holding notes' full text (`{ notes: { path: text } }`). */
export interface NoteBackup {
  /** The backup file (vault-relative, under the backups folder). */
  path: string;
  /** Its folder's name ("map-notes-2026-10-14"). */
  folder: string;
  /** Its file name ("coast-hex-notes.json.gz"). */
  name: string;
  /** When it was saved (ISO), when it says. */
  savedAt?: string;
  /** Path → the note's text when it was backed up. */
  notes: Record<string, string>;
}

/** Read a backup file (`.json.gz` or `.json`) as JSON; null when it can't be read. */
export async function readJsonBackup(adapter: BackupReadAdapter, path: string): Promise<unknown> {
  try {
    let text: string;
    if (path.endsWith(".gz")) {
      if (typeof DecompressionStream !== "function") return null;
      const buf = await adapter.readBinary(path);
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
      text = await new Response(stream).text();
    } else {
      text = await adapter.read(path);
    }
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** The notes a backup's JSON holds (path → text), or null when it isn't a notes backup. */
export function backupNotes(data: unknown): Record<string, string> | null {
  if (!data || typeof data !== "object") return null;
  const notes = (data as { notes?: unknown }).notes;
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return null;
  const out: Record<string, string> = {};
  for (const [p, t] of Object.entries(notes as Record<string, unknown>)) if (typeof t === "string") out[p] = t;
  return Object.keys(out).length ? out : null;
}

/**
 * Every backup under `root` that holds notes' full text, newest first. Other
 * files there (a map's data as JSON, path reports) aren't offered: they
 * aren't notes to put back.
 */
export async function listNoteBackups(adapter: BackupReadAdapter, root: string): Promise<NoteBackup[]> {
  if (!(await adapter.exists(root))) return [];
  const out: NoteBackup[] = [];
  const walk = async (dir: string): Promise<void> => {
    const { files, folders } = await adapter.list(dir);
    for (const f of files) {
      if (!/\.json(\.gz)?$/i.test(f)) continue;
      const data = await readJsonBackup(adapter, f);
      const notes = backupNotes(data);
      if (!notes) continue;
      const savedAt = typeof (data as { savedAt?: unknown }).savedAt === "string" ? (data as { savedAt: string }).savedAt : undefined;
      const parts = f.split("/");
      out.push({ path: f, name: parts[parts.length - 1], folder: parts[parts.length - 2] ?? "", savedAt, notes });
    }
    for (const d of folders) await walk(d);
  };
  await walk(root);
  const when = (b: NoteBackup) => b.savedAt ?? (/\d{4}-\d{2}-\d{2}/.exec(b.folder)?.[0] ?? "");
  return out.sort((a, b) => when(b).localeCompare(when(a)) || a.path.localeCompare(b.path));
}

export type RestoreStatus = "changed" | "same" | "missing";

/** What restoring a backup would do to each note: put back (changed), nothing (same), make again (missing). */
export function planRestore(notes: Record<string, string>, current: (path: string) => string | null): { path: string; status: RestoreStatus }[] {
  return Object.keys(notes).sort().map((path) => {
    const now = current(path);
    const status: RestoreStatus = now === null ? "missing" : now === notes[path] ? "same" : "changed";
    return { path, status };
  });
}
