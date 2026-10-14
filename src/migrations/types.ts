/**
 * What every migration file declares about itself (see README.md here).
 * Pure: no Obsidian imports.
 */

/**
 * When in start-up a migration runs. The phases run in this order:
 * - settings: on data.json as read, before anything else (loadSettings);
 * - palettes: when the palette notes are read (PaletteStore.init);
 * - maps: when the map notes are read (MapStore.init);
 * - notes: one-time rewrites of notes, once the stores are in (runNoteMigrations);
 * - tables: the table roll ranges, last (upgradeTableRangesOnce).
 */
export type MigrationPhase = "settings" | "palettes" | "maps" | "notes" | "tables";

export const PHASE_ORDER: readonly MigrationPhase[] = ["settings", "palettes", "maps", "notes", "tables"];

export interface MigrationInfo {
  /** Stable id: the file's name without `.ts`. Never reused or renamed. */
  id: string;
  /** The version (or format) the data comes from: "1.0.26", "1.5.x", "map-note 5". */
  from: string;
  /** The version (or format) it's brought to. */
  to: string;
  phase: MigrationPhase;
  /** One short sentence for the changelog and the upgrade note: what changed in the user's files. */
  change: string;
  /**
   * How a vault knows it ran: the data.json flag it sets, or "every load"
   * for steps that are safe to repeat (they find nothing to do the second
   * time). Steps also add their id to data.json's `migrationsRun` when they
   * changed something (registry.recordMigrationRun).
   */
  recordedBy: string;
}
