/**
 * 1.5.x → 1.6: per-hex map data (terrain, icon, GM icons, region, submap,
 * locked) lived in each hex note's frontmatter, and each map's roads and
 * rivers in data.json as every-hex chains. Both move into one map note per
 * map (`{hexFolder}/{map}/_{map}.md`), which a person can read and edit.
 *
 * Per map: the hex notes' data is copied into a new map note, verified by
 * reading it back, backed up as JSON (with the old chains and a path
 * report), and only then cleaned out of the hex notes. A hex note keeps all
 * its prose and gets `map: "[[_<map>]]"`; notes are never deleted. Before a
 * hex note's frontmatter is rewritten, the full text of every note about to
 * change is saved (gzipped) first; if that can't be saved no note is
 * touched. A map whose note doesn't read back the same keeps its hex notes
 * as they were.
 *
 * `cleanHexNotes` also runs on every start for maps that already have a
 * note: map data synced back into hex notes from a device still on 1.5
 * is taken into the map note (the hex note wins: it was edited there) and
 * cleaned again.
 *
 * Called from MapStore.init (the store keeps its own state; this file holds
 * the steps). Readers of the old frontmatter stay in hexDataFromFrontmatter.
 */
import { TFile, type App } from "obsidian";
import { backgroundText, noticeBackground, noticeUpgrade } from "../ui/notify";
import type { MapData, MapPath, PathChain } from "../types";
import { mapNoteKey, parseMapNote, type HexData, type MapNoteData } from "../maps/mapNote";
import { writeJsonBackup } from "../backup";
import { HEX_MAP_KEY, hexNoteMapKey, LEGACY_HEX_MAP_KEY } from "../noteFormats";
import { legacyChainsToPaths } from "../paths/legacy";
import type { CompactReport } from "../paths/fromHexes";
import type { MigrationInfo } from "./types";

export const info: MigrationInfo = {
  id: "v1.5-map-data-to-map-notes",
  from: "1.5.x",
  to: "1.6",
  phase: "maps",
  change: "Each map's terrain, icons, regions and paths moved out of the hex notes into one map note, _<map>.md, in the map's folder.",
  recordedBy: "a map note existing for the map",
};

/** Hex-note frontmatter keys that hold map data (moved into the map note). */
export const HEX_DATA_KEYS = ["terrain", "icon", "gm-icons", "gm-icon", "region", "duckmage-submap", "locked"] as const;

/** Read map data out of a hex note's frontmatter (pre-migration notes). */
export function hexDataFromFrontmatter(fm: Record<string, unknown> | null | undefined): HexData {
  const h: HexData = {};
  if (!fm) return h;
  if (typeof fm.terrain === "string" && fm.terrain) h.terrain = fm.terrain;
  if (typeof fm.icon === "string" && fm.icon) h.icon = fm.icon;
  const gm = Array.isArray(fm["gm-icons"]) ? fm["gm-icons"].filter((v): v is string => typeof v === "string")
    : typeof fm["gm-icon"] === "string" ? [fm["gm-icon"]] : [];
  if (gm.length) h.gmIcons = gm;
  if (typeof fm.region === "string" && fm.region) h.region = fm.region;
  if (typeof fm["duckmage-submap"] === "string" && fm["duckmage-submap"]) h.locations = [fm["duckmage-submap"]];
  if (fm.locked === true || fm.locked === "true") h.locked = true;
  return h;
}

/** What the steps need from the map store. */
export interface MapNotesMigrationHost {
  app: App;
  manifest: { dir?: string };
  /** The store's settings owner (saved once the maps are moved). */
  plugin: { settings: unknown; saveData(data: unknown): Promise<void> };
  /** A map's hex notes (`{x}_{y}.md` in its folder). */
  hexFiles(map: string): TFile[];
  /** A note's frontmatter (from the cache, else parsed). */
  frontmatterOf(file: TFile): Promise<Record<string, unknown> | undefined>;
  /** The map's hexes are now these (it's no longer being moved). */
  adoptHexes(map: string, hexes: Map<string, HexData>): void;
  /** Convert old every-hex paths into named, anchored ones (kept for the report). */
  convertLegacy(map: MapData, legacy: MapPath[], others: MapPath[]): void;
  rebuildView(map: MapData): void;
  writeNote(map: MapData): Promise<void>;
  notePath(map: string): string;
  dataFor(map: MapData): MapNoteData;
  /** Save the map's path report next to its backup. */
  savePathReport(map: string): Promise<void>;
  get(map: string, key: string): HexData | undefined;
  set(map: string, key: string, patch: HexData): boolean;
}

/** Where today's map-note backups go. */
export function backupDir(pluginDir: string | undefined): string {
  return `${pluginDir}/backups/map-notes-${new Date().toISOString().slice(0, 10)}`;
}

/** Move each map's data out of its hex notes into a new map note. */
export async function migrateMaps(host: MapNotesMigrationHost, maps: MapData[]): Promise<void> {
  const notice = noticeBackground(`moving map data into map notes (0/${maps.length} maps)…`, 0);
  const dir = backupDir(host.manifest.dir);
  const adapter = host.app.vault.adapter;
  let done = 0;
  const failed: string[] = [];
  for (const map of maps) {
    const hexes = new Map<string, HexData>();
    for (const file of host.hexFiles(map.name)) {
      const h = hexDataFromFrontmatter(await host.frontmatterOf(file));
      if (Object.keys(h).length) hexes.set(file.basename, h);
    }
    host.adoptHexes(map.name, hexes);
    // data.json's every-hex paths become named, anchored paths (backed up below).
    const oldChains: PathChain[] = (map.pathChains ?? []).map((c) => ({ ...c, hexes: [...c.hexes] }));
    if (!map.paths) host.convertLegacy(map, legacyChainsToPaths(oldChains), []);
    host.rebuildView(map);
    // Write, then read back and compare before touching any hex note.
    await host.writeNote(map);
    const written = host.app.vault.getAbstractFileByPath(host.notePath(map.name));
    const back = written instanceof TFile ? parseMapNote(await host.app.vault.read(written)) : null;
    const expected = mapNoteKey(host.dataFor(map));
    if (!back || mapNoteKey({ ...back, settings: host.dataFor(map).settings }) !== expected) {
      failed.push(map.name);
      continue;
    }
    try {
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
      await adapter.write(`${dir}/${map.name}.json`, JSON.stringify({ map: map.name, hexes: [...hexes], pathChains: oldChains }, null, 1));
      await host.savePathReport(map.name);
    } catch (e) {
      console.error("Hexmaker: map-note backup failed", e);
      failed.push(map.name);
      continue;
    }
    await cleanHexNotes(host, [map], true);
    done++;
    notice.setMessage(backgroundText(`moving map data into map notes (${done}/${maps.length} maps)…`));
  }
  notice.hide();
  if (failed.length) {
    noticeBackground(`couldn't move map data for ${failed.join(", ")} — their hex notes were left untouched.`, 0);
  } else {
    noticeUpgrade(`map data for ${done} map${done === 1 ? "" : "s"} now lives in map notes (_<map>.md). Hex notes keep their text; a full copy of them is in ${dir}.`);
  }
  await host.plugin.saveData(host.plugin.settings);
}

/**
 * Remove map-data keys from hex notes whose data the map note already
 * holds, leaving a link to the map note. Only keys whose value matches
 * the map note are removed unless `trustNote` (fresh migration) — so a
 * hex note edited on an old device isn't silently overwritten.
 */
export async function cleanHexNotes(host: MapNotesMigrationHost, maps: MapData[], trustNote: boolean): Promise<void> {
  const { fileManager } = host.app;
  for (const map of maps) {
    const link = `[[_${map.name}]]`;
    const toClean: { file: TFile; fm: Record<string, unknown> }[] = [];
    for (const file of host.hexFiles(map.name)) {
      const fm = await host.frontmatterOf(file);
      if (fm && HEX_DATA_KEYS.some((k) => k in fm)) toClean.push({ file, fm });
    }
    if (!toClean.length) continue;
    // processFrontMatter re-serialises the whole frontmatter, so comments
    // and formatting in other keys can change. Keep the full text of every
    // note we're about to touch; if that can't be saved, touch none.
    if (!(await backupHexNotes(host, map.name, toClean.map((c) => c.file)))) continue;
    for (const { file, fm } of toClean) {
      const fromNote = hexDataFromFrontmatter(fm);
      const stored = host.get(map.name, file.basename) ?? {};
      if (!trustNote && JSON.stringify(fromNote) !== JSON.stringify(pick(stored, fromNote))) {
        // The hex note disagrees with the map note: take the hex note's
        // values (it was edited elsewhere), then clean it.
        host.set(map.name, file.basename, fromNote);
      }
      await fileManager.processFrontMatter(file, (f: Record<string, unknown>) => {
        for (const k of HEX_DATA_KEYS) delete f[k];
        // `map:` (NF1), unless the note uses `map:` for something of its own.
        const key = hexNoteMapKey(f);
        if (key === HEX_MAP_KEY) delete f[LEGACY_HEX_MAP_KEY];
        f[key] = link;
      });
    }
  }
}

/**
 * Save the full text of `files` as `<backupDir>/<map>-hex-notes.json.gz`
 * (`.json` where gzip isn't available), never overwriting an earlier one.
 * About 110 bytes per note gzipped. Returns false if it couldn't be saved.
 */
async function backupHexNotes(host: MapNotesMigrationHost, map: string, files: TFile[]): Promise<boolean> {
  const { vault } = host.app;
  const adapter = vault.adapter;
  try {
    const notes: Record<string, string> = {};
    for (const f of files) notes[f.path] = await vault.read(f);
    const json = JSON.stringify({ map, savedAt: new Date().toISOString(), notes });
    await writeJsonBackup(adapter, backupDir(host.manifest.dir), `${map}-hex-notes`, json);
    return true;
  } catch (e) {
    console.error(`Hexmap World Creator: couldn't back up hex notes for ${map}; they were left untouched`, e);
    return false;
  }
}

/** The fields of `a` that `like` has, for comparing partial hex data. */
function pick(a: HexData, like: HexData): HexData {
  const out: HexData = {};
  for (const k of Object.keys(like) as (keyof HexData)[]) (out as Record<string, unknown>)[k] = a[k];
  return out;
}

// ── the paths part: every-hex chains → named paths with anchors ──────────

/**
 * The upgrade notice for the old every-hex paths converted this session
 * (one notice for every map), or null when none were.
 */
export function conversionNoticeText(done: { map: string; report: CompactReport }[], dir: string): string | null {
  const shown = done.filter((c) => c.report.pathsIn > 0);
  if (!shown.length) return null;
  const sum = (f: (r: CompactReport) => number) => shown.reduce((n, c) => n + f(c.report), 0);
  const chains = sum((r) => r.pathsIn), paths = sum((r) => r.pathsOut), singles = sum((r) => r.singlesDropped.length);
  const merged = sum((r) => r.merged.length), inexact = sum((r) => r.inexact.length);
  return (
    `paths on ${shown.length} map${shown.length === 1 ? "" : "s"} moved to the new format: ${chains} old path${chains === 1 ? "" : "s"} became ${paths}` +
    (merged ? ` (${merged} joined from touching pieces)` : "") +
    (inexact ? `; ${inexact} kept every hex as written` : "") +
    // 1.5.x never drew a path one hex long (fresh-eyes 2026-10-13 F5):
    // say so, so this doesn't read as lost roads.
    (singles ? `. ${oneHexPiecesText(singles)}` : "") +
    `. The old notes and a report per map are in ${dir}.`
  );
}

/** Save a map's path-conversion report as a note next to its backup (never overwriting one). */
export async function writePathReport(adapter: App["vault"]["adapter"], dir: string, map: string, report: CompactReport): Promise<void> {
  if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
  let path = `${dir}/${map}-paths-report.md`;
  for (let n = 2; await adapter.exists(path); n++) path = `${dir}/${map}-paths-report-${n}.md`;
  await adapter.write(path, pathReportText(map, report));
}

/**
 * The upgrade notice's line for one-hex path pieces left out of the
 * conversion. 1.5.x never drew a path one hex long (it skipped chains
 * under two hexes), so these were never on the map: say that plainly so
 * it doesn't read as lost roads (fresh-eyes 2026-10-13 F5).
 */
export function oneHexPiecesText(n: number): string {
  return n === 1
    ? "1 path piece only one hex long was left out. Older versions never drew a path that short, so nothing on the map is gone"
    : `${n} path pieces only one hex long were left out. Older versions never drew a path that short, so nothing on the map is gone`;
}

/** A map's path-conversion report, as a note next to its backup. */
export function pathReportText(map: string, r: CompactReport): string {
  const lines = [
    `# Paths of ${map}: converted to named paths with anchors`,
    "",
    `- Old paths (every hex listed): ${r.pathsIn}`,
    `- New paths: ${r.pathsOut} (${r.branches} branches, ${r.anchors} anchors)`,
    `- Joined from pieces that touched end to end: ${r.merged.length}`,
    `- One-hex leftovers dropped (no notes): ${r.singlesDropped.length}`,
    `- Duplicate strokes dropped (every step already drawn): ${r.duplicates.length}`,
    `- Kept with every hex as an anchor (couldn't be shortened exactly): ${r.inexact.length}`,
    "",
    "Every new path draws exactly the steps of the old ones it came from. The old paths are in the backup next to this report.",
    "One-hex leftovers were never drawn: older versions skipped any path shorter than two hexes, so leaving them out changes nothing on the map.",
    "Below, old paths are named by their type and their place among the old paths of that type (Road, Road 2, Road 3…); the new paths are named the same way, so a name here may now be a different path.",
  ];
  if (r.merged.length) lines.push("", "## Joined", "", ...r.merged.map((m) => `- ${m.name}: ${m.from.join(", ")}`));
  if (r.duplicates.length) lines.push("", "## Duplicate strokes", "", ...r.duplicates.map((d) => `- ${d.name} (already drawn by ${d.into})`));
  if (r.singlesDropped.length) lines.push("", "## One-hex leftovers dropped", "", ...r.singlesDropped.map((d) => `- ${d.name} (${d.typeName}) at ${d.hex.replace("_", ", ")}`));
  if (r.inexact.length) lines.push("", "## Kept as written", "", ...r.inexact.map((n) => `- ${n}`));
  if (r.combinedText.length) lines.push("", "## Notes combined from joined pieces", "", ...r.combinedText.map((n) => `- ${n}`));
  return lines.join("\n") + "\n";
}
