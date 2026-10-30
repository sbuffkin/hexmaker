/**
 * "Show on map" for linked notes (owner call SF4, 2026-10-13): a town or
 * dungeon linked to a hex showed only as a tiny badge. When a hex's link
 * section has a link, the hex editor offers that section's icon in one
 * click (it becomes the hex's icon).
 *
 * Which icon goes with which section is a per-section option (settings →
 * Map look → Icons for linked notes), never decided by the section's name
 * in code: these defaults are data, any section can have one or none, and
 * a user's choice (including "none") always wins.
 *
 * Pure: no Obsidian imports.
 */

/** The icon each link section offers until the user picks one ("" = none). */
export const DEFAULT_LINK_SECTION_ICONS: Readonly<Record<string, string>> = {
  Towns: "place-village.svg",
  Dungeons: "place-dungeon-gate.svg",
  Features: "place-ancient-ruins.svg",
  Quests: "",
  Factions: "",
  "Encounters Table": "",
};

/** Section `section`'s icon: the user's choice (blank = none), else the default; null when none. */
export function linkSectionIcon(
  settings: { linkSectionIcons?: Partial<Record<string, string>> },
  section: string,
): string | null {
  const own = settings.linkSectionIcons?.[section];
  const icon = own !== undefined ? own : DEFAULT_LINK_SECTION_ICONS[section] ?? "";
  return icon.trim() || null;
}

/**
 * The icon to offer beside a link section: its icon when the section has
 * links, the icon exists, and the hex doesn't already show it; else null.
 */
export function showOnMapOffer(o: {
  icon: string | null;
  linkCount: number;
  hexIcon: string | null;
  available: (icon: string) => boolean;
}): string | null {
  if (!o.icon || o.linkCount <= 0) return null;
  if (o.hexIcon === o.icon) return null;
  return o.available(o.icon) ? o.icon : null;
}
