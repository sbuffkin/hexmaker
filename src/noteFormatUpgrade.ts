/**
 * One-time rewrites of existing notes for the round-6 note-format changes
 * (owner decisions NF1, NF2, NF3). Each runs once per vault, after the map
 * notes are loaded, and is recorded in `settings.noteFormatUpgrades` so a
 * restart never runs it again:
 *
 * - "hex-map-key" (NF1): hex notes' `hexmaker-map: "[[_coast]]"` becomes
 *   `map: "[[_coast]]"`. A note with a `map:` key of its own is left alone
 *   and listed in the notice.
 * - "hex-body-lines" (NF2): filled `**Terrain:**` / `**Region:**` lines in
 *   hex-note bodies move into the note's Map data callout as "Old terrain:"
 *   / "Old region:" lines (the map keeps its own values).
 * - "note-links" (NF3): token notes' `token-map: coast` becomes a link to
 *   the map note, `token-link: world/npcs/Ana.md` a link to that note, and
 *   workflows' `template-file:` path a link to the template.
 *
 * Before anything is written, the full text of every note about to change
 * is saved as `<plugin>/backups/note-formats-<date>/<id>.json.gz`. If that
 * can't be saved, nothing is changed and the upgrade isn't recorded, so it
 * tries again next time. A vault with nothing to change writes no note
 * (the record goes into data.json once). Readers accept the old forms
 * forever, so a note synced from an older device still works.
 */
import { Notice, TFile, type App } from "obsidian";
import { writeJsonBackup } from "./backup";
import { mapDataLines, moveBodyFieldsIntoMapData, shownValues, type HexMapDataView, type MapDataShown } from "./hexMapData";
import { linkNotePathKey, linkTokenMap, renameHexMapKey } from "./noteFormats";
import { takeBodyFields } from "./hexBodyFields";
import { normalizeFolder } from "./utils";

export type NoteFormatUpgradeId = "hex-map-key" | "hex-body-lines" | "note-links";

export const NOTE_FORMAT_UPGRADES: readonly NoteFormatUpgradeId[] = ["hex-map-key", "hex-body-lines", "note-links"];

/** What the upgrades need from the plugin. */
export interface NoteFormatHost {
  app: App;
  manifest: { dir?: string };
  settings: {
    hexFolder: string;
    workflowsFolder?: string;
    maps: { name: string }[];
    noteFormatUpgrades?: string[];
  };
  mapStore: { isReady(map?: string): boolean; resolve(path: string): { map: string; key: string } | null };
  hexMapDataView(map: string, x: number, y: number): HexMapDataView;
  calloutMemory?: { set(path: string, values: MapDataShown): void };
  saveSettings(): Promise<void>;
}

/** One upgrade's plan: path → [original, upgraded]. */
export interface UpgradePlan {
  id: NoteFormatUpgradeId;
  changes: Map<string, [string, string]>;
  /** Notes left alone on purpose, with why (shown in the notice). */
  skipped: { path: string; reason: string }[];
}

export interface UpgradeResult extends UpgradePlan {
  /** Paths actually rewritten. */
  changed: string[];
  backup?: string;
  /** Set when nothing was written because the backup failed. */
  error?: string;
}

const HEX_FILE = /^-?\d+_-?\d+\.md$/;

/** Hex notes of known maps (`{hexFolder}/{map}/{x}_{y}.md`), "_" notes never. */
function hexNotes(host: NoteFormatHost): { file: TFile; map: string; x: number; y: number }[] {
  const known = new Set(host.settings.maps.map((m) => m.name));
  const out: { file: TFile; map: string; x: number; y: number }[] = [];
  for (const file of host.app.vault.getMarkdownFiles()) {
    if (!HEX_FILE.test(file.name)) continue;
    const loc = host.mapStore.resolve(file.path);
    if (!loc || !known.has(loc.map)) continue;
    const [x, y] = loc.key.split("_").map(Number);
    out.push({ file, map: loc.map, x, y });
  }
  return out.sort((a, b) => a.file.path.localeCompare(b.file.path));
}

/** Could the note's frontmatter have one of `keys`? (Not indexed yet: maybe.) */
function mayHave(host: NoteFormatHost, file: TFile, keys: string[]): boolean {
  const cache = host.app.metadataCache.getFileCache(file);
  if (!cache) return true;
  const fm = cache.frontmatter;
  return !!fm && keys.some((k) => k in fm);
}

/** Work out what an upgrade would change, reading every note it looks at. */
export async function planUpgrade(host: NoteFormatHost, id: NoteFormatUpgradeId): Promise<UpgradePlan> {
  const plan: UpgradePlan = { id, changes: new Map(), skipped: [] };
  const { vault } = host.app;
  const add = (path: string, before: string, after: string) => { if (after !== before) plan.changes.set(path, [before, after]); };
  if (id === "hex-map-key") {
    for (const { file } of hexNotes(host)) {
      if (!mayHave(host, file, ["hexmaker-map"])) continue;
      const text = await vault.cachedRead(file);
      if (!/hexmaker-map/.test(text)) continue;
      const r = renameHexMapKey(text);
      if (r.status === "conflict") plan.skipped.push({ path: file.path, reason: "it uses map: for something else, so its link stays under hexmaker-map:" });
      else add(file.path, text, r.content);
    }
  } else if (id === "hex-body-lines") {
    for (const { file, map, x, y } of hexNotes(host)) {
      const text = await vault.cachedRead(file);
      if (!/\*\*(terrain|region)/i.test(text) || !takeBodyFields(text).taken.length) continue;
      // The callout shows the map's values: a map that isn't loaded can't say them.
      if (!host.mapStore.isReady(map)) { plan.skipped.push({ path: file.path, reason: `its map (${map}) isn't loaded; the lines move when the note is next opened` }); continue; }
      add(file.path, text, moveBodyFieldsIntoMapData(text, host.hexMapDataView(map, x, y)).content);
    }
  } else {
    const exists = (p: string) => vault.getAbstractFileByPath(p) instanceof TFile;
    const wfFolder = normalizeFolder(host.settings.workflowsFolder ?? "");
    for (const file of vault.getMarkdownFiles()) {
      if (file.basename.startsWith("_") || !mayHave(host, file, ["token-map", "token-link", "template-file"])) continue;
      const text = await vault.cachedRead(file);
      if (!text.startsWith("---")) continue;
      let next = text;
      if (/^token-map\s*:/m.test(next)) next = linkTokenMap(next).content;
      if (/^token-link\s*:/m.test(next)) next = linkNotePathKey(next, "token-link", exists).content;
      if (wfFolder && file.path.startsWith(wfFolder + "/") && /^template-file\s*:/m.test(next)) next = linkNotePathKey(next, "template-file", exists).content;
      add(file.path, text, next);
    }
  }
  return plan;
}

/** Re-plan one note from what's there now (it may have changed since the plan). */
async function replanOne(host: NoteFormatHost, id: NoteFormatUpgradeId, path: string, current: string): Promise<string> {
  const { vault } = host.app;
  if (id === "hex-map-key") {
    const r = renameHexMapKey(current);
    return r.status === "renamed" ? r.content : current;
  }
  if (id === "hex-body-lines") {
    const loc = host.mapStore.resolve(path);
    if (!loc || !host.mapStore.isReady(loc.map)) return current;
    const [x, y] = loc.key.split("_").map(Number);
    return moveBodyFieldsIntoMapData(current, host.hexMapDataView(loc.map, x, y)).content;
  }
  const exists = (p: string) => vault.getAbstractFileByPath(p) instanceof TFile;
  let next = linkTokenMap(current).content;
  next = linkNotePathKey(next, "token-link", exists).content;
  const wfFolder = normalizeFolder(host.settings.workflowsFolder ?? "");
  if (wfFolder && path.startsWith(wfFolder + "/")) next = linkNotePathKey(next, "template-file", exists).content;
  return next;
}

function backupDir(host: NoteFormatHost, when: Date): string {
  return `${host.manifest.dir ?? ""}/backups/note-formats-${when.toISOString().slice(0, 10)}`;
}

/**
 * Run one upgrade: plan, back up every note about to change, then rewrite
 * them. Nothing to change: no backup, no writes. Backup failed: nothing
 * written (`error` set).
 */
export async function runUpgrade(host: NoteFormatHost, id: NoteFormatUpgradeId, when = new Date()): Promise<UpgradeResult> {
  const plan = await planUpgrade(host, id);
  const result: UpgradeResult = { ...plan, changed: [] };
  if (!plan.changes.size) return result;
  const notes: Record<string, string> = {};
  for (const [path, [original]] of plan.changes) notes[path] = original;
  try {
    const json = JSON.stringify({ kind: `note-format-${id}`, savedAt: when.toISOString(), notes });
    result.backup = await writeJsonBackup(host.app.vault.adapter, backupDir(host, when), id, json);
  } catch (e) {
    console.error(`Hexmap World Creator: couldn't back up notes for the ${id} upgrade; nothing was changed`, e);
    result.error = `Couldn't save a backup (${String(e)}), so no note was changed.`;
    return result;
  }
  for (const [path, [original, upgraded]] of plan.changes) {
    const file = host.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;
    let wrote = false;
    // Re-planned inside process() when the note changed since it was read.
    const current = await host.app.vault.read(file);
    const next = current === original ? upgraded : await replanOne(host, id, path, current);
    if (next === current) continue;
    await host.app.vault.process(file, (c) => {
      if (c !== current) return c; // changed again meanwhile: left for the next open
      wrote = true;
      return next;
    });
    if (!wrote) continue;
    result.changed.push(path);
    if (id === "hex-body-lines" && host.calloutMemory) {
      // What the callout shows now, so a later hand edit is told from it.
      const loc = host.mapStore.resolve(path);
      if (loc) {
        const [x, y] = loc.key.split("_").map(Number);
        host.calloutMemory.set(path, shownValues(mapDataLines(host.hexMapDataView(loc.map, x, y))));
      }
    }
  }
  return result;
}

const UPGRADE_LABEL: Record<NoteFormatUpgradeId, string> = {
  "hex-map-key": "map: links in hex notes",
  "hex-body-lines": "old Terrain/Region lines moved into Map data",
  "note-links": "links for token maps, token notes and workflow templates",
};

/** The notice after the upgrades, or null when nothing changed or was skipped. */
export function upgradeMessage(results: UpgradeResult[]): string | null {
  const parts: string[] = [];
  for (const r of results) {
    if (r.error) { parts.push(`${UPGRADE_LABEL[r.id]}: ${r.error}`); continue; }
    if (r.changed.length) parts.push(`${UPGRADE_LABEL[r.id]}: ${r.changed.length} note${r.changed.length === 1 ? "" : "s"} (backup: ${r.backup})`);
    if (r.skipped.length) {
      const shown = r.skipped.slice(0, 5).map((s) => `${s.path} (${s.reason})`).join("; ");
      parts.push(`left as they were: ${shown}${r.skipped.length > 5 ? `; and ${r.skipped.length - 5} more (see the console)` : ""}`);
    }
  }
  return parts.length ? `Hexmap World Creator updated note formats. ${parts.join(". ")}.` : null;
}

/**
 * Run every upgrade this vault hasn't had yet, once. An upgrade is recorded
 * when it finished (or had nothing to do); one whose backup failed isn't,
 * so it runs again next time. Settings are saved only when a record was
 * added.
 */
export async function runNoteFormatUpgrades(host: NoteFormatHost): Promise<UpgradeResult[]> {
  const done = new Set(host.settings.noteFormatUpgrades ?? []);
  const todo = NOTE_FORMAT_UPGRADES.filter((id) => !done.has(id));
  if (!todo.length) return [];
  const results: UpgradeResult[] = [];
  for (const id of todo) {
    try {
      const r = await runUpgrade(host, id);
      results.push(r);
      if (!r.error) done.add(id);
      if (r.skipped.length) console.warn(`Hexmap World Creator: ${id} upgrade left these notes as they were`, r.skipped);
    } catch (e) {
      console.error(`Hexmap World Creator: the ${id} note upgrade failed; it will be tried again next time`, e);
    }
  }
  // Ids from other builds stay recorded.
  const before = host.settings.noteFormatUpgrades ?? [];
  if (done.size !== new Set(before).size) {
    host.settings.noteFormatUpgrades = [...before.filter((id) => done.has(id)), ...[...done].filter((id) => !before.includes(id))];
    await host.saveSettings();
  }
  const msg = upgradeMessage(results);
  if (msg) new Notice(msg, 15000);
  return results;
}
