/**
 * Map names and the map list as a tree. Pure (no Obsidian imports) so it's
 * unit-testable.
 *
 * Display names: a map's `name` is its slug (folder, map note, id in every
 * reference); `displayName` is the name as typed, shown in the UI. Maps made
 * before display names have none and show their slug.
 *
 * The tree: submaps sit under the map they were made from, and maps that
 * neighbour each other (one `world`) are grouped. A world group is keyed by
 * its world id, so a later "super map" of a world's regions can hang off it.
 */

export interface NamedMap {
  name: string;
  displayName?: string;
  parent?: { map: string; hex: string };
  world?: { id: string; cx: number; cy: number };
}

/** What to show for a map: its display name, or its slug. */
export function mapLabel(map: Pick<NamedMap, "name" | "displayName"> | undefined, fallback = ""): string {
  if (!map) return fallback;
  const d = map.displayName === undefined || map.displayName === null ? "" : String(map.displayName).trim();
  return d || map.name;
}

/** The displayName to store for a typed name: unset when it's just the slug. */
export function displayNameFor(typed: string, slug: string): string | undefined {
  const t = typed.trim().replace(/\s+/g, " ");
  return t && t !== slug ? t : undefined;
}

export type MapTreeNode =
  | { kind: "map"; name: string; label: string; children: MapTreeNode[] }
  | { kind: "world"; id: string; label: string; children: MapTreeNode[] };

/**
 * The map list as a tree. `parentOf` gives a map's parent map (or undefined
 * for a top-level map); maps whose parent is missing, or that sit in a
 * parent cycle, show at the top level. Order: the order of `maps`, except
 * that a world's members go in reading order (north to south, west to east).
 */
export function buildMapTree<T extends NamedMap>(maps: T[], parentOf: (name: string) => string | undefined = (n) => maps.find((m) => m.name === n)?.parent?.map): MapTreeNode[] {
  const byName = new Map(maps.map((m) => [m.name, m]));
  const parent = new Map<string, string | undefined>();
  for (const m of maps) {
    // Walk up: a parent that's missing or loops back makes this a root.
    let p = parentOf(m.name);
    const seen = new Set([m.name]);
    let cur = p;
    while (cur && byName.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf(cur);
    }
    if (!p || !byName.has(p) || (cur !== undefined && seen.has(cur))) p = undefined;
    parent.set(m.name, p);
  }
  const kids = new Map<string | undefined, T[]>();
  for (const m of maps) {
    const p = parent.get(m.name);
    const list = kids.get(p) ?? [];
    list.push(m);
    kids.set(p, list);
  }
  const level = (p: string | undefined): MapTreeNode[] => {
    const list = kids.get(p) ?? [];
    const out: MapTreeNode[] = [];
    const done = new Set<string>();
    for (const m of list) {
      if (done.has(m.name)) continue;
      const id = m.world?.id;
      const members = id ? list.filter((o) => o.world?.id === id) : [];
      if (id && members.length > 1) {
        members.sort((a, b) => a.world!.cy - b.world!.cy || a.world!.cx - b.world!.cx);
        for (const o of members) done.add(o.name);
        out.push({ kind: "world", id, label: worldLabel(members), children: members.map(node) });
      } else {
        done.add(m.name);
        out.push(node(m));
      }
    }
    return out;
  };
  const node = (m: T): MapTreeNode => ({ kind: "map", name: m.name, label: mapLabel(m), children: level(m.name) });
  return level(undefined);
}

/** A world group's label: its regions' names, the first few. */
export function worldLabel(members: NamedMap[]): string {
  const names = members.map((m) => mapLabel(m));
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} +${names.length - 3}` : shown;
}

/** A stable key for a node (for remembering what's collapsed). */
export const nodeKey = (n: MapTreeNode): string => (n.kind === "map" ? `map:${n.name}` : `world:${n.id}`);

/** Whether a node or anything under it is the map `name`. */
export function treeContains(n: MapTreeNode, name: string): boolean {
  if (n.kind === "map" && n.name === name) return true;
  return n.children.some((c) => treeContains(c, name));
}

/**
 * The tree cut down to maps whose display name or slug contains `query`
 * (case-insensitive), keeping the parents and groups they sit in so they
 * stay in context. An empty query keeps everything.
 */
export function filterMapTree(nodes: MapTreeNode[], query: string): MapTreeNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const out: MapTreeNode[] = [];
  for (const n of nodes) {
    const children = filterMapTree(n.children, q);
    const hit = n.kind === "map" && (n.label.toLowerCase().includes(q) || n.name.toLowerCase().includes(q));
    if (hit || children.length) out.push({ ...n, children: hit && !children.length ? [] : children });
  }
  return out;
}

/** Count the maps in a tree. */
export function countMaps(nodes: MapTreeNode[]): number {
  return nodes.reduce((sum, n) => sum + (n.kind === "map" ? 1 : 0) + countMaps(n.children), 0);
}

export type NeighbourSide = "north" | "east" | "south" | "west";
const SIDE_WORD: Record<NeighbourSide, string> = { west: "West", north: "North", south: "South", east: "East" };

/**
 * Sideways crumbs for the breadcrumb: the map on each side of `map`, west
 * first, then north, south, east. `text` names the side in words
 * ("North: Thornwood"). Round 6: arrows here ("↑ Thornwood") read like
 * "↑ parent map", so a neighbour to the north looked like a parent.
 */
export function neighbourCrumbs(
  map: NamedMap | undefined,
  maps: NamedMap[],
): { side: NeighbourSide; name: string; text: string }[] {
  if (!map?.world) return [];
  const { id, cx, cy } = map.world;
  const at = (dx: number, dy: number) => maps.find((m) => m.world?.id === id && m.world.cx === cx + dx && m.world.cy === cy + dy && m.name !== map.name);
  const sides: [NeighbourSide, number, number][] = [["west", -1, 0], ["north", 0, -1], ["south", 0, 1], ["east", 1, 0]];
  const out: { side: NeighbourSide; name: string; text: string }[] = [];
  for (const [side, dx, dy] of sides) {
    const m = at(dx, dy);
    if (!m) continue;
    const label = mapLabel(m);
    out.push({ side, name: m.name, text: `${SIDE_WORD[side]}: ${label}` });
  }
  return out;
}

/**
 * Neighbour crumbs for a map with no neighbours of its own (a submap): the
 * neighbours of its nearest ancestor that has any, so a submap reaches its
 * parent's neighbour in one click (round 6: it took two hops). `via` is that
 * ancestor. Null when the map has its own neighbours or no ancestor has any.
 */
export function ancestorNeighbourCrumbs(
  mapName: string,
  maps: NamedMap[],
  parentOf: (name: string) => string | undefined = (n) => maps.find((m) => m.name === n)?.parent?.map,
): { via: string; crumbs: { side: NeighbourSide; name: string; text: string }[] } | null {
  const byName = (n: string) => maps.find((m) => m.name === n);
  if (neighbourCrumbs(byName(mapName), maps).length > 0) return null;
  const seen = new Set([mapName]);
  let cur = parentOf(mapName);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const crumbs = neighbourCrumbs(byName(cur), maps);
    if (crumbs.length > 0) return { via: cur, crumbs };
    cur = parentOf(cur);
  }
  return null;
}
