/**
 * The runner for one-time rewrites of notes (phase "notes"): each step is a
 * `NoteRewrite` in its own file here, listed in order in NOTE_REWRITES
 * (registry.ts). Each runs once per vault, after the map notes are loaded,
 * and is recorded by its `recordId` in `settings.noteFormatUpgrades`, so a
 * restart never runs it again.
 *
 * Before anything is written, the full text of every note about to change
 * is saved as `<plugin>/backups/note-formats-<date>/<recordId>.json.gz`. If
 * that can't be saved, nothing is changed and the step isn't recorded, so
 * it tries again next time. A vault with nothing to change writes no note
 * (the record goes into data.json once). Readers accept the old forms
 * forever, so a note synced from an older device still works.
 *
 * A new rewrite of notes: add a file with a `NoteRewrite` (plan the whole
 * vault, and re-plan one note from its current text), add it to
 * NOTE_REWRITES, and add a golden or fixture test.
 */
import { TFile, type App } from "obsidian";
import { noticeUpgrade } from "../ui/notify";
import { writeJsonBackup } from "../backup";
import type { HexMapDataView, MapDataShown } from "../hexMapData";
import type { HexData } from "../maps/mapNote";
import type { HexProps } from "../maps/hexProps";
import type { RefLinker } from "../modules/types";
import type { MigrationInfo } from "./types";
import { hexXY } from "../hexKey";

/** What the rewrites need from the plugin. */
export interface NoteFormatHost {
  app: App;
  manifest: { dir?: string };
  settings: {
    hexFolder: string;
    workflowsFolder?: string;
    worldFolder?: string;
    maps: { name: string }[];
    noteFormatUpgrades?: string[];
    /** Hex-note properties (MG4); false: not added. */
    hexNoteProperties?: boolean;
  };
  mapStore: { isReady(map?: string): boolean; resolve(path: string): { map: string; key: string } | null; notePath?(map: string): string; get?(map: string, key: string): HexData | undefined };
  /** Palette notes ("ref-links"); without it no palette name is linked. */
  paletteStore?: { notePathOf(name: string): string | undefined; folder(): string };
  /** Each module's rewriters for its own notes ("ref-links"; Space: World types tables). */
  moduleRefLinks?: RefLinker[];
  /** Each module's own one-time note rewrites (run after the core's). */
  moduleNoteRewrites?: NoteRewrite[];
  hexMapDataView(map: string, x: number, y: number): HexMapDataView;
  calloutMemory?: { set(path: string, values: MapDataShown): void };
  /** Remembers the hex-note properties a rewrite wrote (src/maps/hexPropsSync.ts). */
  hexProps?: { remember(path: string, props: HexProps): void };
  saveSettings(): Promise<void>;
}

/** One rewrite step. */
export interface NoteRewrite {
  info: MigrationInfo;
  /** The id recorded in `settings.noteFormatUpgrades` (and the backup's name). Never changes. */
  recordId: string;
  /** How the notice names it. */
  label: string;
  /** Read every note it looks at; say what would change. */
  plan(host: NoteFormatHost, add: (path: string, before: string, after: string) => void, skip: (path: string, reason: string) => void): Promise<void>;
  /** Re-plan one note from what's there now (it may have changed since the plan). */
  replan(host: NoteFormatHost, path: string, current: string): string | Promise<string>;
  /** After a note was rewritten. */
  written?(host: NoteFormatHost, path: string): void;
}

/** One step's plan: path → [original, upgraded]. */
export interface UpgradePlan {
  id: string;
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
export function hexNotes(host: NoteFormatHost): { file: TFile; map: string; x: number; y: number }[] {
  const known = new Set(host.settings.maps.map((m) => m.name));
  const out: { file: TFile; map: string; x: number; y: number }[] = [];
  for (const file of host.app.vault.getMarkdownFiles()) {
    if (!HEX_FILE.test(file.name)) continue;
    const loc = host.mapStore.resolve(file.path);
    if (!loc || !known.has(loc.map)) continue;
    const { x, y } = hexXY(loc.key);
    out.push({ file, map: loc.map, x, y });
  }
  return out.sort((a, b) => a.file.path.localeCompare(b.file.path));
}

/** Could the note's frontmatter have one of `keys`? (Not indexed yet: maybe.) */
export function mayHave(host: NoteFormatHost, file: TFile, keys: string[]): boolean {
  const cache = host.app.metadataCache.getFileCache(file);
  if (!cache) return true;
  const fm = cache.frontmatter;
  return !!fm && keys.some((k) => k in fm);
}

/** Work out what a step would change, reading every note it looks at. */
export async function planRewrite(host: NoteFormatHost, step: NoteRewrite): Promise<UpgradePlan> {
  const plan: UpgradePlan = { id: step.recordId, changes: new Map(), skipped: [] };
  await step.plan(
    host,
    (path, before, after) => { if (after !== before) plan.changes.set(path, [before, after]); },
    (path, reason) => { plan.skipped.push({ path, reason }); },
  );
  return plan;
}

function backupDir(host: NoteFormatHost, when: Date): string {
  return `${host.manifest.dir ?? ""}/backups/note-formats-${when.toISOString().slice(0, 10)}`;
}

/**
 * Run one step: plan, back up every note about to change, then rewrite
 * them. Nothing to change: no backup, no writes. Backup failed: nothing
 * written (`error` set).
 */
export async function runRewrite(host: NoteFormatHost, step: NoteRewrite, when = new Date()): Promise<UpgradeResult> {
  const id = step.recordId;
  const plan = await planRewrite(host, step);
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
    const next = current === original ? upgraded : await step.replan(host, path, current);
    if (next === current) continue;
    await host.app.vault.process(file, (c) => {
      if (c !== current) return c; // changed again meanwhile: left for the next open
      wrote = true;
      return next;
    });
    if (!wrote) continue;
    result.changed.push(path);
    step.written?.(host, path);
  }
  return result;
}

/** The notice after the rewrites, or null when nothing changed or was skipped. */
export function upgradeMessage(results: UpgradeResult[], steps: readonly NoteRewrite[]): string | null {
  const label = (id: string) => steps.find((s) => s.recordId === id)?.label ?? id;
  const parts: string[] = [];
  for (const r of results) {
    if (r.error) { parts.push(`${label(r.id)}: ${r.error}`); continue; }
    if (r.changed.length) parts.push(`${label(r.id)}: ${r.changed.length} note${r.changed.length === 1 ? "" : "s"} (backup: ${r.backup})`);
    if (r.skipped.length) {
      const shown = r.skipped.slice(0, 5).map((s) => `${s.path} (${s.reason})`).join("; ");
      parts.push(`left as they were: ${shown}${r.skipped.length > 5 ? `; and ${r.skipped.length - 5} more (see the console)` : ""}`);
    }
  }
  return parts.length ? `updated note formats. ${parts.join(". ")}.` : null;
}

/**
 * Run every step of `steps` this vault hasn't had yet, once, in order. A
 * step is recorded when it finished (or had nothing to do); one whose
 * backup failed isn't, so it runs again next time. Settings are saved only
 * when a record was added.
 */
export async function runNoteRewrites(host: NoteFormatHost, steps: readonly NoteRewrite[], onResult?: (step: NoteRewrite, r: UpgradeResult) => void): Promise<UpgradeResult[]> {
  const done = new Set(host.settings.noteFormatUpgrades ?? []);
  const todo = steps.filter((s) => !done.has(s.recordId));
  if (!todo.length) return [];
  const results: UpgradeResult[] = [];
  for (const step of todo) {
    const id = step.recordId;
    try {
      const r = await runRewrite(host, step);
      results.push(r);
      onResult?.(step, r);
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
  const msg = upgradeMessage(results, steps);
  if (msg) {
    const label = (id: string) => steps.find((s) => s.recordId === id)?.label ?? id;
    noticeUpgrade(msg, {
      // The upgrade note lists each step on its own line.
      lines: results.filter((r) => r.changed.length).map((r) => `${label(r.id)}: ${r.changed.length} note${r.changed.length === 1 ? "" : "s"}`),
      ids: results.filter((r) => r.changed.length).map((r) => steps.find((s) => s.recordId === r.id)?.info.id ?? r.id),
      backups: results.map((r) => r.backup).filter((b): b is string => !!b),
      check: results.flatMap((r) => [
        ...(r.error ? [`${steps.find((s) => s.recordId === r.id)?.label ?? r.id}: ${r.error} It will be tried again next start.`] : []),
        ...r.skipped.map((s) => `${s.path} was left as it was: ${s.reason}.`),
      ]),
    });
  }
  return results;
}
