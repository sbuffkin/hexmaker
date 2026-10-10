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
