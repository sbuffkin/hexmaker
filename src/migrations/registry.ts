/**
 * Every data upgrade the plugin has, in the order a start-up runs them,
 * and the small runners for the phases that run as a list (see README.md).
 *
 * The palettes and maps phases run inside their stores (PaletteStore.attach,
 * MapStore.init), at the points their files' comments name; the settings,
 * notes and tables phases run from here. Every step keeps its own record
 * (the data.json flag in its `recordedBy`), so an older vault always has a
 * path forward from any released version: each step looks at the data, not
 * at the version that wrote it.
 */
import type { MigrationInfo } from "./types";
import { PHASE_ORDER } from "./types";
import * as regionsToMaps from "./v1.0.26-settings-regions-to-maps";
import * as dropTableRangesPrompt from "./unreleased-drop-table-ranges-prompt";
import * as roadRiverChains from "./v1.2-road-river-chains-to-path-chains";
import * as flatHexNotes from "./v1.0-flat-hex-notes-to-default-map";
import * as flatTerrainTables from "./v1.0-flat-terrain-tables-to-subfolders";
import * as pathTypesExplicit from "./v1.5-path-types-explicit";
import * as palettesToNotes from "./v1.5-palettes-to-notes";
import * as paletteColors from "./v1.5-palette-colors-as-code";
import * as palettePathTypes from "./v1.5-palette-path-types";
import * as paletteTerrainTypes from "./v1.5-palette-terrain-types";
import * as paletteData from "./v1.5-palette-data";
import * as mapNotes from "./v1.5-map-data-to-map-notes";
import { hexMapKey } from "./v1.5-hex-map-key";
import { hexBodyLines } from "./v1.5-hex-body-lines";
import { noteLinks } from "./v1.5-note-links";
import { refLinks } from "./v1.5-ref-links";
import { hexCalloutAreaLine } from "./unreleased-hex-callout-area-line";
import { hexNoteProperties } from "./unreleased-hex-note-properties";
import * as helpText from "./map-note-1-to-6-help-text";
import * as areaNames from "./map-note-5-to-6-area-names";
import * as tableRanges from "./v1.5-table-roll-ranges";
import { runNoteRewrites, runRewrite, type NoteFormatHost, type NoteRewrite, type UpgradeResult } from "./noteRewrites";

/** The note rewrites (phase "notes"), in the order they run. */
export const NOTE_REWRITES: readonly NoteRewrite[] = [hexMapKey, hexBodyLines, noteLinks, refLinks, hexCalloutAreaLine, hexNoteProperties];

/** Every migration, in start-up order (phase, then the order within it). */
export const MIGRATIONS: readonly MigrationInfo[] = [
  // settings: data.json as read
  regionsToMaps.info,
  dropTableRangesPrompt.info,
  roadRiverChains.info,
  flatHexNotes.info,
  // palettes: PaletteStore.attach
  pathTypesExplicit.info,
  palettesToNotes.info,
  paletteColors.info,
  palettePathTypes.info,
  paletteTerrainTypes.info,
  paletteData.info,
  // maps: MapStore.init
  mapNotes.info,
  helpText.info,
  areaNames.info,
  // notes: one-time rewrites, once the stores are in
  ...NOTE_REWRITES.map((s) => s.info),
  // tables
  flatTerrainTables.info,
  tableRanges.info,
];

/** The settings phase, on data.json as read (before the defaults are applied). */
export function runSettingsMigrations(data: Record<string, unknown>): string[] {
  const ran: string[] = [];
  if (regionsToMaps.migrate(data)) ran.push(regionsToMaps.info.id);
  if (dropTableRangesPrompt.migrate(data)) ran.push(dropTableRangesPrompt.info.id);
  return ran;
}

/**
 * The notes phase: the core's note rewrites, then each module's, once
 * each per vault (recorded in `settings.noteFormatUpgrades`).
 */
export function runNoteFormatUpgrades(host: NoteFormatHost, onResult?: (step: NoteRewrite, r: UpgradeResult) => void): Promise<UpgradeResult[]> {
  return runNoteRewrites(host, [...NOTE_REWRITES, ...(host.moduleNoteRewrites ?? [])], onResult);
}

/** Run a single note rewrite by its record id (tests, and re-running one by hand). */
export function noteRewrite(recordId: string): NoteRewrite | undefined {
  return NOTE_REWRITES.find((s) => s.recordId === recordId);
}

/**
 * Note in data.json's `migrationsRun` that a step changed this vault (its
 * id, once, in the order they ran). Plain ids, so the file reads as a list
 * of what was done. Returns true when it was new.
 */
export function recordMigrationRun(settings: { migrationsRun?: string[] }, id: string): boolean {
  const list = settings.migrationsRun ?? [];
  if (list.includes(id)) return false;
  settings.migrationsRun = [...list, id];
  return true;
}

/** Phases in order, with their steps (README, tests). */
export function migrationsByPhase(): { phase: string; steps: MigrationInfo[] }[] {
  return PHASE_ORDER.map((phase) => ({ phase, steps: MIGRATIONS.filter((m) => m.phase === phase) }));
}

/** Run one note rewrite by its record id ("hex-map-key"…), unrecorded. */
export function runUpgrade(host: NoteFormatHost, recordId: string, when?: Date): Promise<UpgradeResult> {
  const step = noteRewrite(recordId);
  if (!step) throw new Error(`no note rewrite "${recordId}"`);
  return runRewrite(host, step, when);
}
