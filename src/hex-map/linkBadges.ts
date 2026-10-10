import { setIcon } from "obsidian";

/**
 * Link badges: a small marker per link type (town, dungeon, feature, quest,
 * faction) at a hex's right side, drawn when that hex's note links something under
 * the matching section heading. Additive: the hex's own icon is untouched.
 *
 * Links are note content, so they're read from the metadata cache (headings +
 * links, no file reads). Only hexes with a note can have badges, so the work
 * scales with the map's notes, not its hexes.
 */

export const BADGE_SECTIONS = ["Towns", "Dungeons", "Features", "Quests", "Factions"] as const;
export type BadgeSection = typeof BADGE_SECTIONS[number];

export const BADGE_INFO: Record<BadgeSection, { icon: string; label: string; one: string; cls: string; color: string }> = {
  Towns:    { icon: "home",     label: "Towns",    one: "Town",    cls: "towns",    color: "#c0803a" },
  Dungeons: { icon: "skull",    label: "Dungeons", one: "Dungeon", cls: "dungeons", color: "#8e3b46" },
  Features: { icon: "landmark", label: "Features", one: "Feature", cls: "features", color: "#3f7f5f" },
  Quests:   { icon: "scroll",   label: "Quests",   one: "Quest",   cls: "quests",   color: "#b59a2a" },
  Factions: { icon: "flag",     label: "Factions", one: "Faction", cls: "factions", color: "#5a5fb0" },
};

/** Badges stack in one column at the hex's right side up to this many, then two. */
export const BADGES_PER_COLUMN = 3;

/** The bits of an Obsidian CachedMetadata this needs. */
export interface LinkCacheLike {
  headings?: { heading: string; level: number; position: { start: { offset: number } } }[];
  links?: { link?: string; displayText?: string; position: { start: { offset: number } } }[];
}

/**
 * Which link sections hold at least one link. A section runs from its heading
 * to the next heading of the same or a higher level. Order follows
 * BADGE_SECTIONS.
 */
export function linkSectionsFromCache(cache: LinkCacheLike | null | undefined): BadgeSection[] {
  return [...linksBySection(cache).keys()];
}

/**
 * The links under each link section, as people read them (the link's alias,
 * else its note name without folders), in BADGE_SECTIONS order; sections
 * with no links are left out.
 */
export function linksBySection(cache: LinkCacheLike | null | undefined): Map<BadgeSection, string[]> {
  const headings = cache?.headings ?? [];
  const links = cache?.links ?? [];
  const found = new Map<BadgeSection, string[]>();
  if (!headings.length || !links.length) return found;
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const name = BADGE_SECTIONS.find((s) => s.toLowerCase() === h.heading.trim().toLowerCase());
    if (!name || found.has(name)) continue;
    const start = h.position.start.offset;
    let end = Infinity;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) { end = headings[j].position.start.offset; break; }
    }
    const inside = links.filter((l) => l.position.start.offset > start && l.position.start.offset < end);
    if (inside.length) found.set(name, inside.map(linkLabel));
  }
  const out = new Map<BadgeSection, string[]>();
  for (const s of BADGE_SECTIONS) {
    const names = found.get(s);
    if (names) out.set(s, names);
  }
  return out;
}

/** "world/towns/Gullmouth" → "Gullmouth"; an alias wins. */
function linkLabel(l: { link?: string; displayText?: string }): string {
  const target = (l.link ?? "").split("#")[0];
  const base = target.slice(target.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  const alias = l.displayText?.trim();
  return alias && alias !== l.link ? alias : base || alias || "";
}

/**
 * Hover text for a hex's links (S3): "Town: Gullmouth", "Dungeons: A, B".
 * Empty when the hex links nothing.
 */
export function linkedNotesText(bySection: ReadonlyMap<BadgeSection, readonly string[]>): string {
  const parts: string[] = [];
  for (const [s, names] of bySection) {
    const shown = names.filter(Boolean);
    if (!shown.length) continue;
    parts.push(`${shown.length === 1 ? BADGE_INFO[s].one : BADGE_INFO[s].label}: ${shown.join(", ")}`);
  }
  return parts.join(" · ");
}

/** The viewport class that hides one badge type (layers menu sub-toggle). */
export function badgeHideClass(section: BadgeSection): string {
  return `duckmage-hide-badge-${BADGE_INFO[section].cls}`;
}

/**
 * Flip one badge type in a map's hidden list. Returns the list in
 * BADGE_SECTIONS order, or undefined when nothing is hidden (keeps the map
 * note free of an empty key).
 */
export function toggleHiddenBadge(hidden: readonly string[] | undefined, section: BadgeSection): string[] | undefined {
  const set = new Set(hidden ?? []);
  if (set.has(section)) set.delete(section); else set.add(section);
  const out = BADGE_SECTIONS.filter((s) => set.has(s));
  return out.length ? out : undefined;
}

/** Hex key ("x_y") from a hex note's basename, or null for other notes. */
export function hexKeyFromBasename(basename: string): string | null {
  return /^-?\d+_-?\d+$/.test(basename) ? basename : null;
}

/**
 * Draw the badges layer inside the grid. `placements` are the hex centres
 * already measured for the coordinate labels (key "x,y", grid pixels), so
 * this does no layout reads: badges sit at a % of the grid and keep
 * tracking the hexes through zoom bakes, like the coordinate labels.
 */
export function renderLinkBadgeLayer(
  grid: HTMLElement,
  placements: readonly { key: string; ox: number; oy: number }[],
  gridSize: { w: number; h: number },
  sectionsByHex: ReadonlyMap<string, BadgeSection[]>,
): void {
  grid.querySelector(".duckmage-link-badges-layer")?.remove();
  if (sectionsByHex.size === 0) return;
  const layer = grid.createDiv({ cls: "duckmage-link-badges-layer" });
  const gw = gridSize.w || 1;
  const gh = gridSize.h || 1;
  for (const p of placements) {
    const sections = sectionsByHex.get(p.key.replace(",", "_"));
    if (!sections?.length) continue;
    const group = layer.createDiv({ cls: `duckmage-link-badges${sections.length > BADGES_PER_COLUMN ? " is-two-col" : ""}` });
    group.setCssProps({
      "--duckmage-badge-x": `${((p.ox / gw) * 100).toFixed(3)}%`,
      "--duckmage-badge-y": `${((p.oy / gh) * 100).toFixed(3)}%`,
    });
    for (const s of sections) {
      const info = BADGE_INFO[s];
      const b = group.createSpan({
        cls: `duckmage-link-badge duckmage-link-badge-${info.cls}`,
        attr: { "aria-label": info.label },
      });
      setIcon(b, info.icon);
    }
  }
}
