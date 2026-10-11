/**
 * Note pickers list what they're for, never "the vault minus some system
 * folders" (owner call SP3: one focus per picker; biome notes flooded the
 * token Note picker). Each picker purpose is an ALLOW-list of content
 * folders, as data: a new kind of plugin note (biomes, world types,
 * palettes…) can't leak in, because it isn't in any purpose's list.
 *
 * A blank folder setting means that folder's usual place under the world
 * folder (`world/towns`…, what "Generate folders" fills in), never the
 * whole vault.
 *
 * Pure: no Obsidian imports.
 */

/** A content folder setting. */
export type ContentFolderKey =
  | "townsFolder"
  | "dungeonsFolder"
  | "questsFolder"
  | "featuresFolder"
  | "factionsFolder"
  | "regionsFolder"
  | "tablesFolder"
  | "workflowsFolder";

/** Where each content folder lives under the world folder when its setting is blank. */
export const CONTENT_FOLDER_DEFAULTS: Record<ContentFolderKey, string> = {
  townsFolder: "towns",
  dungeonsFolder: "dungeons",
  questsFolder: "quests",
  featuresFolder: "features",
  factionsFolder: "factions",
  regionsFolder: "regions",
  tablesFolder: "tables",
  workflowsFolder: "workflows",
};

/** Token notes made from the token form go here, under the world folder. */
export const TOKENS_SUBFOLDER = "tokens";

const trim = (p: string | undefined): string => (p ?? "").trim().replace(/^\/+|\/+$/g, "");

/** The world folder ("world" when blank). */
export function worldFolderOf(settings: { worldFolder?: string }): string {
  return trim(settings.worldFolder) || "world";
}

/** A content folder: its setting, else its usual place under the world folder. */
export function contentFolder(
  settings: Partial<Record<ContentFolderKey, string>> & { worldFolder?: string },
  key: ContentFolderKey,
): string {
  return trim(settings[key]) || `${worldFolderOf(settings)}/${CONTENT_FOLDER_DEFAULTS[key]}`;
}

/** What a picker is for, and the content folders it lists from. */
export type PickerPurpose = "token" | "table" | "workflow";

export const PICKER_FOLDERS: Record<PickerPurpose, { folders: ContentFolderKey[]; tokens?: boolean }> = {
  // Things a token stands for: characters and ships (the tokens folder),
  // factions, places (towns, dungeons, features, regions) and quests.
  token: {
    folders: ["townsFolder", "dungeonsFolder", "featuresFolder", "questsFolder", "factionsFolder", "regionsFolder"],
    tokens: true,
  },
  table: { folders: ["tablesFolder"] },
  workflow: { folders: ["workflowsFolder"] },
};

/** The folders a picker lists notes from (deduplicated). */
export function pickerFolders(
  settings: Partial<Record<ContentFolderKey, string>> & { worldFolder?: string },
  purpose: PickerPurpose,
): string[] {
  const spec = PICKER_FOLDERS[purpose];
  const out = spec.folders.map((k) => contentFolder(settings, k));
  if (spec.tokens) out.push(`${worldFolderOf(settings)}/${TOKENS_SUBFOLDER}`);
  return [...new Set(out)];
}

/** Is `path` inside one of `folders` (case-insensitive)? */
export function inAnyFolder(path: string, folders: readonly string[]): boolean {
  const p = path.toLowerCase();
  return folders.some((f) => !!f && p.startsWith(f.toLowerCase() + "/"));
}

/** Files the table editor's Import… can read: text with one entry per list item or line. */
export const IMPORT_LIST_EXTENSIONS = ["md", "txt", "csv"];
