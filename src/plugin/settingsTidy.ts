/**
 * Settings fixes applied on load, after data.json has been merged over
 * DEFAULT_SETTINGS (settingsPersistence.loadSettings). Keys missing from
 * data.json already have their defaults by then; these handle the keys
 * that are present but unusable, and drop settings nothing reads any more.
 */
import type { HexmakerPluginSettings } from "../types";

/**
 * Settings no build reads any more. Dropped from the settings on load, so
 * the next save leaves them out of data.json. Safe for 1.5.x: it never
 * read them either (it filled them from its own defaults).
 * - mySetting: left over from Obsidian's sample plugin.
 * - zoomLevel: the map's zoom is per view.
 * - hexEditorTerrainExpanded: expanding Terrain is per hex (round 6).
 */
export const RETIRED_SETTINGS_KEYS = ["mySetting", "zoomLevel", "hexEditorTerrainExpanded"] as const;

/** Fix up freshly loaded settings in place (see the module comment). */
export function tidyLoadedSettings(settings: HexmakerPluginSettings): void {
  const s = settings as unknown as Record<string, unknown>;
  for (const key of RETIRED_SETTINGS_KEYS) delete s[key];
  // A missing orientation is the default (flat). One saved but empty or
  // unknown has always been read as pointy (1.5.x and earlier), so it stays so.
  if (settings.hexOrientation !== "flat" && settings.hexOrientation !== "pointy") settings.hexOrientation = "pointy";
  if (!settings.tablesFolder) settings.tablesFolder = "world/tables";
  if (!settings.defaultTableDice) settings.defaultTableDice = 100;
  if (!Array.isArray(settings.rollTableExcludedFolders)) settings.rollTableExcludedFolders = ["terrain"];
  if (!Array.isArray(settings.encounterTableExcludedFolders)) settings.encounterTableExcludedFolders = ["terrain"];
  if (!settings.defaultMap) settings.defaultMap = settings.maps[0]?.name ?? "default";
}
